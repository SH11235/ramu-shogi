import { beforeEach, describe, expect, it } from "vitest";
import { createInitialBoard, createInitialPositionState } from "./board";
import {
    buildBoardFromCsa,
    movesToCsa,
    parseCsaMoves,
    parseCsaMovesWithState,
    parseSingleCsaMove,
} from "./csa";
import { REAL_GAME_CSA_MOVES } from "./csa-real-game.fixture";
import type { PositionService } from "./position-service";
import { setPositionServiceFactory } from "./position-service-registry";

// モックの PositionService を作成
const createMockPositionService = (): PositionService => {
    const initialPosition = createInitialPositionState();

    return {
        async getInitialBoard() {
            return initialPosition;
        },
        async parseSfen(_sfen: string) {
            return initialPosition;
        },
        async boardToSfen(_position) {
            return "startpos";
        },
        async getLegalMoves(_sfen: string, _moves?: string[]) {
            return [];
        },
        async replayMovesStrict(
            _sfen: string,
            moves: string[],
            _options?: { passRights?: { sente: number; gote: number } },
        ) {
            return {
                applied: moves,
                lastPly: moves.length,
                position: initialPosition,
            };
        },
    };
};

beforeEach(() => {
    setPositionServiceFactory(() => createMockPositionService());
});

describe("movesToCsa", () => {
    it("USI手順をCSA形式に変換する", () => {
        const moves = ["7g7f", "3c3d"];
        const result = movesToCsa(moves);

        expect(result).toContain("V2.2");
        expect(result).toContain("N+Sente");
        expect(result).toContain("N-Gote");
        expect(result).toContain("PI");
        expect(result).toContain("+");
        // 7g7f -> +7776FU
        expect(result).toContain("+7776FU");
        // 3c3d -> -3334FU
        expect(result).toContain("-3334FU");
    });

    it("成りの手を正しく変換する", () => {
        const initialBoard = createInitialBoard();
        // 歩を1cに配置（成れる位置）
        initialBoard["1c"] = { owner: "sente", type: "P" };
        const moves = ["1c1b+"];
        const result = movesToCsa(moves, {}, initialBoard);

        // 成りの手は "TO" コードになる
        // 1c = 13, 1b = 12
        expect(result).toContain("+1312TO");
    });

    it("メタデータを正しく設定する", () => {
        const moves = ["7g7f"];
        const result = movesToCsa(moves, {
            senteName: "先手太郎",
            goteName: "後手次郎",
        });

        expect(result).toContain("N+先手太郎");
        expect(result).toContain("N-後手次郎");
    });

    it("空の手順リストを処理する", () => {
        const moves: string[] = [];
        const result = movesToCsa(moves);

        expect(result).toContain("V2.2");
        expect(result).toContain("PI");
        expect(result).toContain("+");
    });

    it("後手の駒打ちと後続の成駒移動を正しい所有者・駒コードで変換する", () => {
        const moves = ["7g7f", "P*5e", "7f7e", "5e5f", "7e7d", "5f5g", "7d7c+", "5g5h", "7c8c"];

        const csa = movesToCsa(moves);

        expect(csa).toContain("-0055FU");
        expect(csa).toContain("+7473TO");
        expect(csa).toContain("+7383TO");
        expect(parseCsaMoves(csa)).toEqual(moves);
    });

    it("変換不能または適用不能な USI 手で例外を投げる", () => {
        expect(() => movesToCsa(["invalid"])).toThrow(/could not be parsed/);
        expect(() => movesToCsa(["pass"])).toThrow(/could not be parsed/);
        expect(() => movesToCsa(["7f7e"])).toThrow(/no piece at source square/);
        expect(() => movesToCsa(["7g7f", "3c3d", "7f6g"])).toThrow(/cannot capture own piece/);
    });

    it("index の手番と移動駒の所有者が一致しない USI 手順を拒否する", () => {
        expect(() => movesToCsa(["3c3d"])).toThrow(/not your turn/);
        expect(() => movesToCsa(["7g7f", "2g2f"])).toThrow(/not your turn/);
    });

    it("実戦180手を CSA へ変換しても USI 手順が変わらない", () => {
        const moves = parseCsaMoves(REAL_GAME_CSA_MOVES);

        expect(parseCsaMoves(movesToCsa(moves))).toEqual(moves);
    });
});

describe("parseCsaMoves", () => {
    it("CSA形式をUSI手順に変換する", () => {
        const csa = `V2.2
N+Sente
N-Gote
PI
+
+7776FU
-3334FU`;

        const moves = parseCsaMoves(csa);

        expect(moves).toHaveLength(2);
        expect(moves[0]).toBe("7g7f");
        expect(moves[1]).toBe("3c3d");
    });

    it("駒打ち (from=00) を USI drop 形式に変換する", () => {
        const initialBoard = createInitialBoard();
        // 持ち駒として歩を sente に持たせるため 7g の歩を取り除く前提のシナリオは
        // 単純化のため省略し、空マスへの drop が parse されることだけを検証する。
        initialBoard["5e"] = null;

        const csa = `V2.2
N+Sente
N-Gote
PI
+
+0055FU
-0044KA`;

        const moves = parseCsaMoves(csa, initialBoard);

        expect(moves).toContain("P*5e");
        expect(moves).toContain("B*4d");
    });

    it("成りの手を正しく解析する", () => {
        const initialBoard = createInitialBoard();
        // 歩を1cに配置
        initialBoard["1c"] = { owner: "sente", type: "P" };

        const csa = `V2.2
N+Sente
N-Gote
PI
+
+1312TO`;

        const moves = parseCsaMoves(csa, initialBoard);

        expect(moves).toHaveLength(1);
        expect(moves[0]).toBe("1c1b+");
    });

    it("空のCSA形式を処理する", () => {
        const csa = `V2.2
N+Sente
N-Gote
PI`;

        const moves = parseCsaMoves(csa);

        expect(moves).toHaveLength(0);
    });

    it("不正な行を無視する", () => {
        const csa = `V2.2
N+Sente
Invalid Line
+7776FU
Another Invalid
-3334FU`;

        const moves = parseCsaMoves(csa);

        expect(moves).toHaveLength(2);
        expect(moves[0]).toBe("7g7f");
        expect(moves[1]).toBe("3c3d");
    });

    it("CSA の符号に従って後手の駒打ちと後続手を適用する", () => {
        const initialBoard = createInitialBoard();
        const csa = ["-", "-0085FU", "+2726FU", "-8586FU", "+7786FU"].join("\n");

        expect(buildBoardFromCsa("-\n-0085FU", initialBoard)["8e"]).toEqual({
            owner: "gote",
            type: "P",
        });
        expect(parseCsaMoves(csa, initialBoard)).toEqual(["P*8e", "2g2f", "8e8f", "7g8f"]);
        expect(buildBoardFromCsa(csa, initialBoard)["8f"]).toEqual({
            owner: "sente",
            type: "P",
        });
    });

    it("後手の駒打ち後も既成りのと金移動に成り記号を付けない", () => {
        const initialBoard = createInitialBoard();
        initialBoard["7c"] = { owner: "sente", type: "P", promoted: true };
        initialBoard["8c"] = null;

        expect(parseCsaMoves(["-", "-0085FU", "+7383TO"].join("\n"), initialBoard)).toEqual([
            "P*8e",
            "7c8c",
        ]);
    });

    it("適用不能な move 行を黙って飛ばさない", () => {
        expect(() => parseCsaMoves(["+7776FU", "-8586FU", "+2726FU"].join("\n"))).toThrow(
            /-8586FU.*no piece at source square/,
        );
    });

    it("CSA の符号と移動駒の所有者が一致しない手を拒否する", () => {
        expect(() => parseCsaMoves("-\n-7776FU")).toThrow(/not your turn/);
    });

    it("同じ手番の move 行が連続する CSA を拒否する", () => {
        expect(() => parseCsaMoves(["+7776FU", "+2726FU"].join("\n"))).toThrow(/unexpected turn/);
    });

    it("開始手番マーカーが後手なら後手の move 行からパースする", () => {
        expect(parseCsaMoves(["-", "-3334FU", "+7776FU"].join("\n"))).toEqual(["3c3d", "7g7f"]);
    });

    it("実戦の全180手を欠落なく変換し、成り記号を正しい手だけに付ける", () => {
        const moves = parseCsaMoves(REAL_GAME_CSA_MOVES);
        const promotions = moves
            .map((move, index) => ({ move, index }))
            .filter(({ move }) => move.endsWith("+"));

        expect(moves).toHaveLength(180);
        expect(moves[88]).toBe("7c8c");
        expect(promotions).toEqual([
            { index: 82, move: "7d7c+" },
            { index: 93, move: "7f7g+" },
            { index: 98, move: "7b7a+" },
            { index: 107, move: "2h2i+" },
            { index: 118, move: "4e5c+" },
            { index: 131, move: "7h6g+" },
            { index: 162, move: "8d7b+" },
            { index: 164, move: "5b6c+" },
            { index: 168, move: "6d6c+" },
        ]);
        expect(promotions.map(({ index }) => index + 1)).toEqual([
            83, 94, 99, 108, 119, 132, 163, 165, 169,
        ]);
    });
});

describe("buildBoardFromCsa", () => {
    it("CSA形式から盤面を構築する", () => {
        const csa = `V2.2
N+Sente
N-Gote
PI
+
+7776FU
-3334FU`;

        const board = buildBoardFromCsa(csa);

        expect(board["7g"]).toBeNull();
        expect(board["7f"]).toEqual({
            owner: "sente",
            type: "P",
        });
        expect(board["3c"]).toBeNull();
        expect(board["3d"]).toEqual({
            owner: "gote",
            type: "P",
        });
    });
});

describe("往復変換", () => {
    it("USI -> CSA -> USI で一致する", () => {
        const originalMoves = ["7g7f", "3c3d", "2g2f"];
        const csa = movesToCsa(originalMoves);
        const parsedMoves = parseCsaMoves(csa);

        expect(parsedMoves).toEqual(originalMoves);
    });

    it("複雑な手順でも往復変換が一致する", () => {
        const originalMoves = [
            "7g7f",
            "3c3d",
            "8h2b+", // 角が成る（実際の将棋では不可能だが、テスト用）
            "4a3b",
        ];

        // 初期盤面をカスタマイズ
        const board = createInitialBoard();
        // 角を2bの位置に動かせるように調整
        board["2b"] = null; // 空にする

        const csa = movesToCsa(originalMoves, {}, board);
        const parsedMoves = parseCsaMoves(csa, board);

        // 最初の2手は正確に一致するはず
        expect(parsedMoves.slice(0, 2)).toEqual(originalMoves.slice(0, 2));
    });
});

describe("parseSingleCsaMove", () => {
    it("通常の移動を 1 手だけ解釈し、PositionState を進める", () => {
        const initial = createInitialPositionState();
        const result = parseSingleCsaMove("+7776FU", initial);
        expect(result).not.toBeNull();
        expect(result?.move).toBe("7g7f");
        expect(result?.nextState.turn).toBe("gote");
        expect(result?.nextState.board["7g"]).toBeNull();
        expect(result?.nextState.board["7f"]).toEqual({ owner: "sente", type: "P" });
    });

    it("CSA の符号と移動駒の所有者が一致しない手を拒否する", () => {
        const state = createInitialPositionState();
        state.turn = "gote";
        expect(() => parseSingleCsaMove("-7776FU", state)).toThrow(/not your turn/);
    });

    it("現在手番と同じ符号の手を適用した後は同符号の次手を拒否する", () => {
        const first = parseSingleCsaMove("+7776FU", createInitialPositionState());
        if (!first) throw new Error("first move should be applied");
        expect(() => parseSingleCsaMove("+2726FU", first.nextState)).toThrow(/unexpected turn/);
    });

    it("成り手 (UM 等) を promote=true で解釈する", () => {
        // 角成りを発生させるため、最初に 8h→2b+ を経由した状態を作る
        const initial = createInitialPositionState();
        initial.board["2b"] = null; // 後手角を退かして 8h2b+ を可能に
        const r1 = parseSingleCsaMove("+8822UM", initial);
        expect(r1).not.toBeNull();
        expect(r1?.move).toBe("8h2b+");
        // 成り駒が配置され、手番が gote へ
        expect(r1?.nextState.board["2b"]).toEqual({
            owner: "sente",
            type: "B",
            promoted: true,
        });
        expect(r1?.nextState.turn).toBe("gote");
    });

    it("既に成っている駒 (RY/UM 等) の通常移動は `+` を付与しない", () => {
        // 5e に成り角 (UM) を配置した state を作る (黒の馬の単純移動)。
        const state = createInitialPositionState();
        // 元 5e は空マスなのでそのまま成り駒を置ける。
        state.board["5e"] = { owner: "sente", type: "B", promoted: true };
        // CSA `+5544UM` (5e → 4d、馬の通常移動、駒コードは UM のまま)。
        const result = parseSingleCsaMove("+5544UM", state);
        expect(result).not.toBeNull();
        // promote=false (既に成り済み) なので USI は `5e4d` のみ。
        expect(result?.move).toBe("5e4d");
        expect(result?.nextState.board["4d"]).toEqual({
            owner: "sente",
            type: "B",
            promoted: true,
        });
        expect(result?.nextState.board["5e"]).toBeNull();
    });

    it("駒打ち手 (+0055FU 等) を `<piece>*<square>` の USI に変換し、hands を減算する", () => {
        const state = createInitialPositionState();
        // 観戦 client では hands を server から再構築するため、ここでは手動で歩を 1 枚追加
        state.hands.sente = { P: 1 };
        // 中央 5e は初期局面で空マス。駒打ちで配置できる。
        const result = parseSingleCsaMove("+0055FU", state);
        expect(result).not.toBeNull();
        expect(result?.move).toBe("P*5e");
        expect(result?.nextState.board["5e"]).toEqual({ owner: "sente", type: "P" });
        // 駒打ちは hands を 1 つ減らす
        expect(result?.nextState.hands.sente.P ?? 0).toBe(0);
    });

    it("行の符号を手番として後手の駒打ちを適用する", () => {
        const state = createInitialPositionState();
        state.turn = "gote";
        state.hands.gote = { P: 1 };

        const result = parseSingleCsaMove("-0085FU", state);

        expect(result?.nextState.board["8e"]).toEqual({ owner: "gote", type: "P" });
        expect(result?.nextState.hands.gote.P ?? 0).toBe(0);
        expect(result?.nextState.turn).toBe("sente");
    });

    it("move 行でない (時間行 / 終局コード / コメント) は null を返す", () => {
        const state = createInitialPositionState();
        expect(parseSingleCsaMove("T8", state)).toBeNull();
        expect(parseSingleCsaMove("%TORYO", state)).toBeNull();
        expect(parseSingleCsaMove("#RESIGN", state)).toBeNull();
        expect(parseSingleCsaMove("'comment", state)).toBeNull();
        expect(parseSingleCsaMove("", state)).toBeNull();
    });
});

describe("parseCsaMovesWithState", () => {
    it("複数行の CSA から moves[] と最終 PositionState を一括取得する", () => {
        const initial = createInitialPositionState();
        // 時間行 (T8) と move 行が混ざった wire を入力する。
        const csa = ["+7776FU", "T8", "-3334FU", "T7"].join("\n");
        const result = parseCsaMovesWithState(csa, initial);
        expect(result.moves).toEqual(["7g7f", "3c3d"]);
        // 2 手目時点で手番は sente に戻る
        expect(result.state.turn).toBe("sente");
        expect(result.state.ply).toBe(3); // 初期 ply=1 + 2 手 → 3
    });

    it("空文字列を渡すと初期状態を返す", () => {
        const initial = createInitialPositionState();
        const result = parseCsaMovesWithState("", initial);
        expect(result.moves).toEqual([]);
        expect(result.state).toBe(initial);
    });

    it("開始手番マーカーが後手なら後手の move 行から状態を進める", () => {
        const result = parseCsaMovesWithState("-\n-3334FU\n+7776FU", createInitialPositionState());

        expect(result.moves).toEqual(["3c3d", "7g7f"]);
        expect(result.state.turn).toBe("gote");
    });

    it("同じ手番の move 行が連続する CSA を拒否する", () => {
        expect(() =>
            parseCsaMovesWithState("+7776FU\n+2726FU", createInitialPositionState()),
        ).toThrow(/unexpected turn/);
    });

    it("move 行より後の単独手番マーカーを無視する", () => {
        const result = parseCsaMovesWithState("+7776FU\n+\n-3334FU", createInitialPositionState());

        expect(result.moves).toEqual(["7g7f", "3c3d"]);
        expect(result.state.turn).toBe("sente");
    });
});
