import type { GameRecordDetail } from "@shogi/api-contract";
import { describe, expect, test, vi } from "vitest";
import { resolveMoves } from "./PublicGamePage";

function makeGame(overrides: Partial<GameRecordDetail> = {}): GameRecordDetail {
    return {
        id: "test-id",
        roomId: null,
        source: "online_room",
        visibility: "public",
        publicId: null,
        status: "finished",
        result: null,
        participants: [],
        createdAt: "2026-01-01T00:00:00Z",
        finishedAt: null,
        initialSfen: "startpos",
        metadata: null,
        moves: [],
        kifuText: "",
        startedAt: null,
        ...overrides,
    };
}

describe("resolveMoves", () => {
    test("既存 moves があればそのまま返す", () => {
        const moves = ["7g7f", "3c3d"];
        expect(resolveMoves(makeGame({ moves }))).toBe(moves);
    });

    test("source が csa_relay 以外なら moves (空配列) を返す", () => {
        expect(resolveMoves(makeGame({ source: "online_room", moves: [] }))).toEqual([]);
    });

    test("csa_relay でも kifuText が空なら moves を返す", () => {
        const game = makeGame({ source: "csa_relay", kifuText: "" });
        expect(resolveMoves(game)).toEqual([]);
    });

    test("csa_relay + 通常手で USI moves に変換", () => {
        const csa = `V2.2\nN+Sente\nN-Gote\nPI\n+\n+7776FU\n-3334FU`;
        const moves = resolveMoves(makeGame({ source: "csa_relay", kifuText: csa }));
        expect(moves).toEqual(["7g7f", "3c3d"]);
    });

    test("csa_relay + 駒打ちを USI drop 形式に変換", () => {
        const csa = `V2.2\nPI\n+\n+0055FU`;
        const moves = resolveMoves(makeGame({ source: "csa_relay", kifuText: csa }));
        expect(moves).toContain("P*5e");
    });

    test("不正な kifuText でも例外が漏れずフォールバックで [] を返す", () => {
        const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
        // `parseCsaMoves` の throw 経路は app-core 側 test でカバー済。ここでは
        // `resolveMoves` が parse 失敗・無効入力で空配列フォールバックする挙動のみ確認する。
        const moves = resolveMoves(makeGame({ source: "csa_relay", kifuText: "garbage" }));
        expect(moves).toEqual([]);
        errorSpy.mockRestore();
    });
});
