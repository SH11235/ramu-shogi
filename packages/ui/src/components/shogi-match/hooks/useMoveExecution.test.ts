import {
    type BoardState,
    createEmptyHands,
    getAllSquares,
    type Piece,
    type PositionState,
    type Square,
} from "@shogi/app-core";
import { act, renderHook } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import type { Message, PromotionSelection, Selection } from "../types";
import { buildLegalCacheKey, LegalMoveCache } from "../utils/legalMoveCache";
import { useMoveExecution } from "./useMoveExecution";

/** 先手番。先手は 5九玉・2八飛・7七歩と持ち駒の歩・金、後手は 5一玉・3三歩。 */
function createPosition(): PositionState {
    const board = Object.fromEntries(getAllSquares().map((sq) => [sq, null])) as BoardState;
    const place = (square: string, piece: Piece) => {
        board[square as Square] = piece;
    };
    place("5i", { owner: "sente", type: "K" });
    place("2h", { owner: "sente", type: "R" });
    place("7g", { owner: "sente", type: "P" });
    place("5a", { owner: "gote", type: "K" });
    place("3c", { owner: "gote", type: "P" });
    const hands = createEmptyHands();
    hands.sente.P = 1;
    hands.sente.G = 1;
    return { board, hands, turn: "sente", ply: 1 };
}

/** この局面で合法とする手（テストに使う分だけ）。7 筋は二歩なので歩を打てない。 */
const LEGAL_MOVES = ["P*5e", "G*5e", "G*7e", "2h2e", "7g7f"];

type Mode = "review" | "match";

const START_SFEN = "sfen-of-test-position";

interface SetupOptions {
    /** 渡すと、キャッシュを先に埋めずに、合法手をこの関数へ取りに行く */
    fetchLegalMoves?: (sfen: string, moves: string[]) => Promise<string[]>;
}

function setup(mode: Mode, options: SetupOptions = {}) {
    const addMove = vi.fn();
    const legalCache = new LegalMoveCache();
    if (!options.fetchLegalMoves) {
        legalCache.set(buildLegalCacheKey(START_SFEN, [], {}), new Set(LEGAL_MOVES));
    }
    const position = createPosition();

    const hook = renderHook(
        ({ startSfen }: { startSfen: string }) => {
            const [selection, setSelection] = useState<Selection | null>(null);
            const [promotionSelection, setPromotionSelection] = useState<PromotionSelection | null>(
                null,
            );
            const [message, setMessage] = useState<Message | null>(null);
            const execution = useMoveExecution({
                position,
                navigation: {
                    addMove,
                    tree: { nodes: new Map(), currentNodeId: "root" } as never,
                },
                isEditMode: false,
                isReviewMode: mode === "review",
                isPaused: false,
                positionReady: true,
                startSfen,
                moves: [],
                fetchLegalMoves: options.fetchLegalMoves,
                legalCache,
                clearLegalCache: () => legalCache.clear(),
                setCanPassLegal: () => {},
                getPassRightsOption: () => ({}),
                updateClocksForNextTurn: () => {},
                turnStartTimeRef: { current: 0 },
                isEngineTurn: () => false,
                selection,
                setSelection,
                promotionSelection,
                setPromotionSelection,
                setLastMove: () => {},
                setMessage,
                setLastAddedBranchInfo: () => {},
                editFromSquare: null,
                setEditFromSquare: () => {},
                editTool: "place",
                editPieceType: null,
                editOwner: "sente",
                editPromoted: false,
                placePieceAt: () => false,
                moveProcessingRef: { current: false },
            });
            return { ...execution, selection, message };
        },
        { initialProps: { startSfen: START_SFEN } },
    );

    return {
        addMove,
        legalCache,
        /** 開始局面を読み込み直す（呼び出し側と同じく、合法手キャッシュも捨てる） */
        loadStartSfen: (startSfen: string) => {
            legalCache.clear();
            hook.rerender({ startSfen });
        },
        current: () => hook.result.current,
        selectHand: (piece: "P" | "G") => act(() => hook.result.current.handleHandSelect(piece)),
        selectSquare: (square: string) =>
            act(async () => {
                await hook.result.current.handleSquareSelect(square);
            }),
    };
}

describe.each<Mode>(["review", "match"])("useMoveExecution: 持ち駒の選択（%s）", (mode) => {
    it("選択中の持ち駒をもう一度押すと、選択が外れる", () => {
        const t = setup(mode);
        t.selectHand("P");
        expect(t.current().selection).toEqual({ kind: "hand", piece: "P" });

        t.selectHand("P");
        expect(t.current().selection).toBeNull();
    });

    it("別の持ち駒を押すと、そちらに選択が移る", () => {
        const t = setup(mode);
        t.selectHand("P");
        t.selectHand("G");
        expect(t.current().selection).toEqual({ kind: "hand", piece: "G" });
    });

    it("持ち駒を選んだまま自分の盤上の駒を押すと、その駒に選択が移る", async () => {
        const t = setup(mode);
        t.selectHand("P");
        await t.selectSquare("2h");

        expect(t.current().selection).toEqual({ kind: "square", square: "2h" });
        expect(t.current().message).toBeNull();
        expect(t.addMove).not.toHaveBeenCalled();

        // 選び直した駒はそのまま動かせる。
        await t.selectSquare("2e");
        expect(t.addMove).toHaveBeenCalledTimes(1);
        expect(t.addMove.mock.calls[0]?.[0]).toBe("2h2e");
        expect(t.current().selection).toBeNull();
    });

    it("盤上の駒を選んだまま持ち駒を押すと、持ち駒に選択が移る", async () => {
        const t = setup(mode);
        await t.selectSquare("2h");
        t.selectHand("G");
        expect(t.current().selection).toEqual({ kind: "hand", piece: "G" });
    });

    it("盤上の駒を選んだまま自分の別の駒を押すと、その駒に選択が移る", async () => {
        const t = setup(mode);
        await t.selectSquare("2h");
        await t.selectSquare("7g");

        expect(t.current().selection).toEqual({ kind: "square", square: "7g" });
        expect(t.current().message).toBeNull();
        expect(t.addMove).not.toHaveBeenCalled();
    });

    it("打てないマスを押すと、打たずにその旨を出し、選択は残る（盤上の駒と同じ）", async () => {
        const t = setup(mode);
        // 二歩になるマス
        t.selectHand("P");
        await t.selectSquare("7e");
        expect(t.addMove).not.toHaveBeenCalled();
        expect(t.current().message).toEqual({ text: "合法手ではありません", type: "error" });
        expect(t.current().selection).toEqual({ kind: "hand", piece: "P" });

        // 相手の駒があるマス
        t.selectHand("G");
        await t.selectSquare("3c");
        expect(t.addMove).not.toHaveBeenCalled();
        expect(t.current().selection).toEqual({ kind: "hand", piece: "G" });

        // 残った選択は、もう一度押せば外れる。
        t.selectHand("G");
        expect(t.current().selection).toBeNull();
    });

    it("盤上の駒を選んだまま動かせないマスを押すと、その旨を出し、選択は残る", async () => {
        const t = setup(mode);
        await t.selectSquare("2h");
        await t.selectSquare("9a");
        expect(t.addMove).not.toHaveBeenCalled();
        expect(t.current().message).toEqual({ text: "合法手ではありません", type: "error" });
        expect(t.current().selection).toEqual({ kind: "square", square: "2h" });

        await t.selectSquare("2h");
        expect(t.current().selection).toBeNull();
    });

    it("打てるマスを押すと、持ち駒を打って選択が外れる", async () => {
        const t = setup(mode);
        t.selectHand("P");
        await t.selectSquare("5e");

        expect(t.addMove).toHaveBeenCalledTimes(1);
        expect(t.addMove.mock.calls[0]?.[0]).toBe("P*5e");
        expect(t.current().selection).toBeNull();
    });
});

describe("useMoveExecution: 合法手キャッシュと局面の入れ替え", () => {
    it("取得中に別の開始局面へ入れ替えたら、後から届いた前の局面の合法手を使わない", async () => {
        const pending = new Map<string, (moves: string[]) => void>();
        const fetchLegalMoves = vi.fn(
            (sfen: string) =>
                new Promise<string[]>((resolve) => {
                    pending.set(sfen, resolve);
                }),
        );
        const t = setup("review", { fetchLegalMoves });

        // 局面 A の合法手を取りに行き、応答が届く前に局面 B を読み込む。
        const legalOfA = t.current().getLegalSet();
        t.loadStartSfen("sfen-of-position-b");
        // A の応答が後から届く。
        await act(async () => {
            pending.get(START_SFEN)?.(["7g7f"]);
            await legalOfA;
        });

        // B で駒を選ぶと、A の応答ではなく B の合法手を取りに行く。
        const legalOfB = t.current().getLegalSet();
        await act(async () => {
            pending.get("sfen-of-position-b")?.(["2h2e"]);
            await legalOfB;
        });

        expect(fetchLegalMoves).toHaveBeenCalledTimes(2);
        expect([...((await legalOfB) ?? [])]).toEqual(["2h2e"]);
        // B の合法手はキャッシュに残り、3 回目は取りに行かない。
        expect([...((await t.current().getLegalSet()) ?? [])]).toEqual(["2h2e"]);
        expect(fetchLegalMoves).toHaveBeenCalledTimes(2);
    });
});
