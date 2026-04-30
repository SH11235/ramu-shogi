/**
 * CsaBoardDisplay のテスト。
 *
 * `setPositionServiceFactory` で fake `PositionService` を差し込み、
 * SFEN 解析の loading / 成功 / エラーパス、初期局面フォールバック、
 * SFEN 切替時の挙動、後手視点反転、最終手導出を検証する。
 */
import {
    createEmptyHands,
    createInitialBoard,
    type PositionService,
    type PositionState,
    setPositionServiceFactory,
} from "@shogi/app-core";
import { render, screen, waitFor } from "@testing-library/react";
import type { ReactElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ShogiBoard / HandPiecesDisplay は実 DOM 描画ではなく props 検証のため軽量モックする
const shogiBoardMock = vi.hoisted(() => vi.fn());
const handPiecesDisplayMock = vi.hoisted(() => vi.fn());

vi.mock("@shogi/ui", () => ({
    boardToGrid: vi.fn(() => [[{ id: "1a", piece: null }]]),
    ShogiBoard: (props: Record<string, unknown>): ReactElement => {
        shogiBoardMock(props);
        return <div data-testid="shogi-board" />;
    },
    HandPiecesDisplay: (props: Record<string, unknown>): ReactElement => {
        handPiecesDisplayMock(props);
        return <div data-testid={`hand-${props.owner as string}`} />;
    },
}));

import { CsaBoardDisplay } from "./CsaBoardDisplay";

const STARTPOS_SFEN = "lnsgkgsnl/1r5b1/ppppppppp/9/9/9/PPPPPPPPP/1B5R1/LNSGKGSNL b - 1";

function makeInitialPosition(): PositionState {
    return {
        board: createInitialBoard(),
        hands: createEmptyHands(),
        turn: "sente",
        ply: 1,
    };
}

interface FakeServiceOptions {
    parseSfen?: (sfen: string) => Promise<PositionState>;
}

function makeFakeService(options: FakeServiceOptions = {}): {
    service: PositionService;
    parseSfen: ReturnType<typeof vi.fn>;
} {
    const parseSfen = vi.fn(
        options.parseSfen ?? ((_sfen: string) => Promise.resolve(makeInitialPosition())),
    );
    const service: PositionService = {
        getInitialBoard: () => Promise.resolve(makeInitialPosition()),
        parseSfen: (sfen: string) => parseSfen(sfen),
        boardToSfen: () => Promise.resolve("startpos"),
        getLegalMoves: () => Promise.resolve([]),
        replayMovesStrict: (_sfen, moves) =>
            Promise.resolve({
                applied: moves,
                lastPly: moves.length,
                position: makeInitialPosition(),
            }),
    };
    return { service, parseSfen };
}

function installFakeService(options: FakeServiceOptions = {}): {
    parseSfen: ReturnType<typeof vi.fn>;
} {
    const { service, parseSfen } = makeFakeService(options);
    setPositionServiceFactory(() => service);
    return { parseSfen };
}

describe("CsaBoardDisplay", () => {
    beforeEach(() => {
        shogiBoardMock.mockClear();
        handPiecesDisplayMock.mockClear();
    });

    afterEach(() => {
        vi.clearAllMocks();
    });

    it("renders_loading_state_initially: parseSfen pending 中は読込中表示", () => {
        // never resolve → loading 状態のまま
        installFakeService({ parseSfen: () => new Promise<PositionState>(() => {}) });
        render(<CsaBoardDisplay sfen={STARTPOS_SFEN} lastMoveUsi={null} myColor="black" />);

        expect(screen.getByText("局面読込中...")).toBeTruthy();
        expect(screen.queryByTestId("shogi-board")).toBeNull();
    });

    it("renders_board_after_parse_sfen_resolves: parseSfen resolve 後に ShogiBoard を描画", async () => {
        installFakeService();
        render(<CsaBoardDisplay sfen={STARTPOS_SFEN} lastMoveUsi={null} myColor="black" />);

        await waitFor(() => {
            expect(screen.getByTestId("shogi-board")).toBeTruthy();
        });
        expect(screen.queryByText("局面読込中...")).toBeNull();
    });

    it("renders_error_state_when_parse_sfen_rejects: reject 時はエラー表示", async () => {
        installFakeService({ parseSfen: () => Promise.reject(new Error("invalid sfen")) });
        render(<CsaBoardDisplay sfen="garbage" lastMoveUsi={null} myColor="black" />);

        await waitFor(() => {
            expect(screen.getByText(/SFEN 解析エラー/)).toBeTruthy();
        });
        expect(screen.queryByTestId("shogi-board")).toBeNull();
    });

    it("falls_back_to_startpos_when_sfen_null: sfen=null で STARTPOS_SFEN を渡す", async () => {
        const { parseSfen } = installFakeService();
        render(<CsaBoardDisplay sfen={null} lastMoveUsi={null} myColor="black" />);

        await waitFor(() => {
            expect(parseSfen).toHaveBeenCalledWith(STARTPOS_SFEN);
        });
    });

    it("keeps_previous_position_when_sfen_changes: SFEN 切替中もロードフラッシュなし", async () => {
        // 1 回目: 即時 resolve、2 回目: 制御可能な promise で保留
        type ResolveFn = (p: PositionState) => void;
        const resolveSecondRef: { current: ResolveFn | null } = { current: null };
        const parseSfenImpl = vi
            .fn<(sfen: string) => Promise<PositionState>>()
            .mockImplementationOnce(() => Promise.resolve(makeInitialPosition()))
            .mockImplementationOnce(
                () =>
                    new Promise<PositionState>((resolve) => {
                        resolveSecondRef.current = resolve;
                    }),
            );
        installFakeService({ parseSfen: parseSfenImpl });

        const { rerender } = render(
            <CsaBoardDisplay sfen={STARTPOS_SFEN} lastMoveUsi={null} myColor="black" />,
        );
        await waitFor(() => expect(screen.getByTestId("shogi-board")).toBeTruthy());

        // 別 SFEN に切替
        rerender(
            <CsaBoardDisplay
                sfen="lnsgkgsnl/1r5b1/ppppppppp/9/9/9/PPPPPPPPP/1B5R1/LNSGKGSNL w - 2"
                lastMoveUsi="7g7f"
                myColor="black"
            />,
        );

        // 2 回目の parseSfen が pending 中でも、旧 position がそのまま残り loading に戻らない
        expect(screen.queryByText("局面読込中...")).toBeNull();
        expect(screen.getByTestId("shogi-board")).toBeTruthy();

        // 後始末: pending promise を resolve し、state 反映を待つ
        // (act warning 回避のため waitFor で state 更新を呑み込む)
        resolveSecondRef.current?.(makeInitialPosition());
        await waitFor(() => expect(parseSfenImpl).toHaveBeenCalledTimes(2));
    });

    it("flips_board_for_white_player: myColor='white' で flipBoard=true", async () => {
        installFakeService();
        render(<CsaBoardDisplay sfen={STARTPOS_SFEN} lastMoveUsi={null} myColor="white" />);

        await waitFor(() => expect(shogiBoardMock).toHaveBeenCalled());
        const lastCallProps = shogiBoardMock.mock.calls.at(-1)?.[0] as { flipBoard?: boolean };
        expect(lastCallProps.flipBoard).toBe(true);
    });

    it("derives_last_move_from_usi: lastMoveUsi='7g7f' で from/to を導出", async () => {
        installFakeService();
        render(<CsaBoardDisplay sfen={STARTPOS_SFEN} lastMoveUsi="7g7f" myColor="black" />);

        await waitFor(() => expect(shogiBoardMock).toHaveBeenCalled());
        const lastCallProps = shogiBoardMock.mock.calls.at(-1)?.[0] as {
            lastMove?: { from?: string; to?: string };
        };
        expect(lastCallProps.lastMove).toEqual({ from: "7g", to: "7f" });
    });
});
