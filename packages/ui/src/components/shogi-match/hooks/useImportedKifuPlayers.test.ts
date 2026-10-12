import { renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useImportedKifuPlayers } from "./useImportedKifuPlayers";

const HIRATE_SFEN = "lnsgkgsnl/1r5b1/ppppppppp/9/9/9/PPPPPPPPP/1B5R1/LNSGKGSNL b - 1";
const HANDICAP_SFEN = "lnsgkgsnl/9/ppppppppp/9/9/9/PPPPPPPPP/1B5R1/LNSGKGSNL w - 1";
const MOVES = ["7g7f", "3c3d"];
const PLAYERS = { sente: "RAMU", gote: "Panda" };

const setup = () => {
    const importSfen = vi.fn(async () => {});
    const importKif = vi.fn(async () => {});
    const { result } = renderHook(() => useImportedKifuPlayers({ importSfen, importKif }));
    return { result, importSfen, importKif };
};

describe("useImportedKifuPlayers", () => {
    it("CSA を読んだあとは、その棋譜のままなら対局者名を返す", async () => {
        const { result, importSfen } = setup();
        await result.current.importSfenFromPanel("startpos", MOVES, {
            moveData: [],
            players: PLAYERS,
        });

        // 既存の取り込みには、従来どおりの引数だけを渡す。
        expect(importSfen).toHaveBeenCalledWith("startpos", MOVES, { moveData: [] });
        expect(result.current.playersFor("startpos", MOVES)).toEqual(PLAYERS);
        // 平手の表し方が違っても、同じ棋譜として扱う。
        expect(result.current.playersFor(HIRATE_SFEN, MOVES)).toEqual(PLAYERS);
    });

    it("同じ手順の別の KIF を読んだら、前の CSA の対局者名を返さない", async () => {
        const { result, importKif } = setup();
        await result.current.importSfenFromPanel("startpos", MOVES, { players: PLAYERS });

        await result.current.importKifFromPanel(MOVES, [], undefined);

        expect(importKif).toHaveBeenCalledWith(MOVES, [], undefined);
        expect(result.current.playersFor("startpos", MOVES)).toBeUndefined();
    });

    it("対局者名の無い SFEN を読んだら、前の棋譜の対局者名を返さない", async () => {
        const { result } = setup();
        await result.current.importSfenFromPanel("startpos", MOVES, { players: PLAYERS });
        await result.current.importSfenFromPanel("startpos", MOVES);
        expect(result.current.playersFor("startpos", MOVES)).toBeUndefined();
    });

    it("開始局面や本譜の手順が違えば、同じ棋譜とみなさない", async () => {
        const { result } = setup();
        await result.current.importSfenFromPanel("startpos", MOVES, { players: PLAYERS });

        expect(result.current.playersFor(HANDICAP_SFEN, MOVES)).toBeUndefined();
        expect(result.current.playersFor("startpos", ["7g7f"])).toBeUndefined();
        expect(result.current.playersFor("startpos", [...MOVES, "2g2f"])).toBeUndefined();
    });

    it("取り込みに失敗したときも、前の棋譜の対局者名を残さない", async () => {
        const importSfen = vi
            .fn<(sfen: string, moves: string[]) => Promise<void>>()
            .mockResolvedValueOnce(undefined)
            .mockRejectedValueOnce(new Error("読めない棋譜"));
        const { result } = renderHook(() =>
            useImportedKifuPlayers({ importSfen, importKif: vi.fn(async () => {}) }),
        );
        await result.current.importSfenFromPanel("startpos", MOVES, { players: PLAYERS });
        await expect(
            result.current.importSfenFromPanel("startpos", ["7g7f"], { players: PLAYERS }),
        ).rejects.toThrow("読めない棋譜");
        expect(result.current.playersFor("startpos", MOVES)).toBeUndefined();
    });
});
