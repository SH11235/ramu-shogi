// @vitest-environment node
// 実物の Wasm 局面サービスで、snapshot からの復元・待った・KIF 出力を確認する。
// Wasm のビルド成果物 (packages/engine-wasm/pkg) を使うので、先にビルドしておく必要がある。

import { type PositionService, setPositionServiceFactory } from "@shogi/app-core";
import type { SnapshotPayload } from "@shogi/match-client";
import {
    exportGameKif,
    type GameState,
    gameReducer,
    makeInitialGameState,
    resolveStartSfen,
    restorePosition,
} from "@shogi/ui/components/online-game-state";
import { parseKif, parseSfen } from "@shogi/ui/components/shogi-match/utils/kifParser";
import { beforeAll, describe, expect, it, vi } from "vitest";
import legacyRoomDoSource from "../../../worker/room-do.ts?raw";

// テスト設定は engine-wasm が読み込む pkg をモックに差し替えるので、実物を直接読み込んで渡す。
// pkg と node:fs を式や文字列で指すのは、pkg が無い状態でも通る型検査と、
// Node の型を持たないアプリ用の tsconfig の両方でモジュール解決をさせないため
const wasm = await vi.hoisted(async () => {
    const pkgDir = new URL("../../../../../packages/engine-wasm/pkg/", import.meta.url).pathname;
    const { readFileSync } = await vi.importActual<{
        readFileSync(path: string): Uint8Array;
    }>("node:fs");
    const glue = await import(/* @vite-ignore */ `${pkgDir}engine_wasm.js`);
    glue.initSync({ module: readFileSync(`${pkgDir}engine_wasm_bg.wasm`) });
    return glue;
});

vi.mock("@shogi/engine-wasm", () => ({
    ensureWasmModule: async () => {},
    defaultWasmModuleUrl: new URL("file:///engine_wasm_bg.wasm"),
    wasm_board_to_sfen: wasm.wasm_board_to_sfen,
    wasm_get_initial_board: wasm.wasm_get_initial_board,
    wasm_get_legal_moves: wasm.wasm_get_legal_moves,
    wasm_parse_sfen_to_board: wasm.wasm_parse_sfen_to_board,
    wasm_replay_moves_strict: wasm.wasm_replay_moves_strict,
}));

type PassRights = { sente: number; gote: number };

const CLOCK = {
    b: { remainMs: 600_000 },
    w: { remainMs: 600_000 },
    running: null,
    lastTickTs: 0,
};
const PLAYER_NAMES = { b: "Alice", w: "Bob" };

/** 手数は実装ごとに数え方が違い得るので、盤面・手番・持ち駒だけを比べる */
const withoutMoveNumber = (sfen: string): string => sfen.split(" ").slice(0, 3).join(" ");

describe("オンライン対局の状態（実物の Wasm 局面サービス）", () => {
    let service: PositionService;

    beforeAll(async () => {
        const { createWasmPositionService } = await import("../../platform/wasm-position-service");
        service = createWasmPositionService();
        setPositionServiceFactory(() => service);
    });

    /** サーバーが保持する局面: 開始局面から指し手を厳密に再生した結果 */
    async function serverSfen(
        startSfen: string,
        moves: string[],
        passRights?: PassRights,
    ): Promise<string> {
        const replayed = await service.replayMovesStrict(
            resolveStartSfen(startSfen),
            moves,
            passRights ? { passRights } : undefined,
        );
        expect(replayed.applied).toEqual(moves);
        return service.boardToSfen(replayed.position);
    }

    async function makeSnapshot(
        startSfen: string,
        moves: string[],
        passRights?: PassRights,
    ): Promise<SnapshotPayload> {
        const sfen = await serverSfen(startSfen, moves, passRights);
        return {
            eventId: 10,
            status: "playing",
            sfen,
            moves,
            turn: sfen.split(" ")[1] === "w" ? "w" : "b",
            clock: CLOCK,
            passRights: passRights ? { b: passRights.sente, w: passRights.gote } : null,
            players: {
                b: { name: PLAYER_NAMES.b, online: true },
                w: { name: PLAYER_NAMES.w, online: true },
            },
            spectators: 0,
            settings: {
                startSfen,
                timeControl: { type: "byoyomi", initialMs: 600_000, byoyomiMs: 30_000 },
                passRights: passRights ? { initialCount: passRights.sente } : null,
                aiSupport: null,
                takeback: true,
            },
        };
    }

    async function restore(snapshot: SnapshotPayload): Promise<GameState> {
        return gameReducer(makeInitialGameState(snapshot, null), {
            type: "init",
            ...(await restorePosition(snapshot)),
        });
    }

    const CASES: Array<{
        name: string;
        startSfen: string;
        moves: string[];
        passRights?: PassRights;
        kifHandicap: string;
    }> = [
        {
            name: "平手で駒取り・成り・駒打ちを含む",
            startSfen: "startpos",
            moves: ["7g7f", "3c3d", "8h2b+", "3a2b", "B*5e"],
            kifHandicap: "平手",
        },
        {
            name: "持ち駒のある後手番の SFEN から始まる",
            startSfen: "4k4/9/9/9/9/9/9/9/4K4 w 2Pb 1",
            moves: ["5a5b", "P*5e", "B*5d", "5i5h"],
            kifHandicap: "その他",
        },
        {
            name: "手数を省いた SFEN から始まる",
            startSfen: "lnsgkgsnl/1r5b1/ppppppppp/9/9/9/PPPPPPPP1/1B5R1/LNSGKGSNL b -",
            moves: ["7g7f", "3c3d"],
            kifHandicap: "その他",
        },
        {
            name: "駒落ちプリセット（角落ち）",
            startSfen: "handicap:bishop",
            moves: ["3c3d", "7g7f", "8b3b", "8h2b+"],
            kifHandicap: "角落ち",
        },
        {
            name: "パスを含む",
            startSfen: "startpos",
            moves: ["7g7f", "pass", "2g2f", "3c3d"],
            passRights: { sente: 1, gote: 1 },
            kifHandicap: "平手",
        },
    ];

    describe.each(CASES)("$name", ({ startSfen, moves, passRights, kifHandicap }) => {
        it("snapshot から各手の局面・手番・記録を復元する", async () => {
            const snapshot = await makeSnapshot(startSfen, moves, passRights);
            const state = await restore(snapshot);

            expect(state.usiMoveLog.map((entry) => entry.usi)).toEqual(moves);
            expect(state.positionHistory).toHaveLength(moves.length + 1);
            expect(state.turn).toBe(snapshot.turn);
            for (let ply = 0; ply <= moves.length; ply++) {
                expect(
                    withoutMoveNumber(await service.boardToSfen(state.positionHistory[ply])),
                ).toBe(
                    withoutMoveNumber(await serverSfen(startSfen, moves.slice(0, ply), passRights)),
                );
            }
            expect(state.position).toBe(state.positionHistory[moves.length]);
        });

        it("復元後に指した手を待ったで取り消すと、復元直後と同じ局面・記録に戻る", async () => {
            const snapshot = await makeSnapshot(startSfen, moves.slice(0, -1), passRights);
            const restored = await restore(snapshot);
            const lastMove = moves[moves.length - 1];
            const moved = gameReducer(restored, {
                type: "move",
                usi: lastMove,
                turn: snapshot.turn === "b" ? "w" : "b",
                clock: CLOCK,
                passRights: snapshot.passRights,
            });
            expect(
                withoutMoveNumber(await service.boardToSfen(moved.positionHistory[moves.length])),
            ).toBe(withoutMoveNumber(await serverSfen(startSfen, moves, passRights)));

            const state = gameReducer(moved, {
                type: "takeback_accepted",
                position: await service.parseSfen(snapshot.sfen),
                turn: snapshot.turn,
                clock: CLOCK,
                passRights: snapshot.passRights,
            });

            expect(state.usiMoveLog.map((entry) => entry.usi)).toEqual(moves.slice(0, -1));
            expect(state.positionHistory).toHaveLength(moves.length);
            expect(state.turn).toBe(snapshot.turn);
            expect(
                await Promise.all(state.positionHistory.map((p) => service.boardToSfen(p))),
            ).toEqual(
                await Promise.all(restored.positionHistory.map((p) => service.boardToSfen(p))),
            );
        });

        it("KIF に開始局面と全ての指し手を出力する", async () => {
            const state = await restore(await makeSnapshot(startSfen, moves, passRights));

            const kif = exportGameKif(state, startSfen, PLAYER_NAMES);

            expect(kif).toContain(`手合割：${kifHandicap}`);
            expect(kif.split("\n").filter((line) => /^ +\d+ /.test(line))).toHaveLength(
                moves.length,
            );
            const resolved = resolveStartSfen(startSfen);
            // 平手は開始局面行を書かず、読み込み側は手合割から平手と解釈する
            const exportedStart = resolved === "startpos" ? null : parseSfen(resolved).sfen;
            if (exportedStart) {
                expect(kif).toContain(`開始局面：${exportedStart}`);
            } else {
                expect(kif).not.toContain("開始局面：");
            }
            // KIF の読み込みはパスに対応していないので、往復はパスを含まない棋譜で確かめる
            if (!moves.includes("pass")) {
                const parsed = parseKif(kif);
                expect(parsed.moves).toEqual(moves);
                expect(parsed.startSfen).toBe(exportedStart ?? "startpos");
            }
        });
    });

    const PRESETS = ["handicap:bishop", "handicap:rook", "handicap:rook-bishop"];

    it("駒落ちプリセットは名前のままでは解析できない", async () => {
        for (const preset of PRESETS) {
            await expect(service.getLegalMoves(preset, [])).rejects.toBeDefined();
            await expect(service.parseSfen(preset)).rejects.toBeDefined();
        }
    });

    it.each(PRESETS)("%s は展開した局面から上手（後手）が指し始められる", async (preset) => {
        const resolved = resolveStartSfen(preset);

        expect((await service.parseSfen(resolved)).turn).toBe("gote");
        expect(await service.getLegalMoves(resolved, [])).toContain("3c3d");
        const state = await restore(await makeSnapshot(preset, ["3c3d", "7g7f"]));
        expect(state.usiMoveLog).toHaveLength(2);
        expect(state.positionHistory).toHaveLength(3);
    });

    it.each(PRESETS)("%s の展開先は Worker の RoomDO の定義と一致する", (preset) => {
        expect(legacyRoomDoSource).toContain(`"${preset}": "${resolveStartSfen(preset)}"`);
    });
});
