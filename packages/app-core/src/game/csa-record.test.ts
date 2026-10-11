import { describe, expect, it } from "vitest";
import { parseCsaEvalComment, parseCsaGameRecord } from "./csa-record";

const HIRATE_POSITION = [
    "P1-KY-KE-GI-KI-OU-KI-GI-KE-KY",
    "P2 * -HI *  *  *  *  * -KA * ",
    "P3-FU-FU-FU-FU-FU-FU-FU-FU-FU",
    "P4 *  *  *  *  *  *  *  *  * ",
    "P5 *  *  *  *  *  *  *  *  * ",
    "P6 *  *  *  *  *  *  *  *  * ",
    "P7+FU+FU+FU+FU+FU+FU+FU+FU+FU",
    "P8 * +KA *  *  *  *  * +HI * ",
    "P9+KY+KE+GI+KI+OU+KI+GI+KE+KY",
];

// 角換わりの途中局面: 双方が角を 1 枚ずつ持ち、後手番。
const MIDGAME_POSITION = [
    "P1-KY-KE * -KI-OU * -GI-KE-KY",
    "P2 * -HI *  *  *  * -KI *  * ",
    "P3-FU * -FU-FU-FU-FU-GI-FU-FU",
    "P4 *  *  *  *  *  * -FU *  * ",
    "P5 * -FU *  *  *  *  * +FU * ",
    "P6 *  * +FU *  *  *  *  *  * ",
    "P7+FU+FU+GI+FU+FU+FU+FU * +FU",
    "P8 *  * +KI *  *  *  * +HI * ",
    "P9+KY+KE *  * +OU+KI+GI+KE+KY",
    "P+00KA",
    "P-00KA",
];

const WDOOR_CSA = [
    "V2",
    "N+RAMU",
    "N-Panda",
    "'black_rate:RAMU+0123abcd:3456.0",
    "'white_rate:Panda+ffee0011:3300.5",
    "$EVENT:wdoor+floodgate-300-10F+RAMU+Panda+20261009000001",
    "$START_TIME:2026/10/09 00:00:01",
    ...HIRATE_POSITION,
    "+",
    "+7776FU",
    "T3",
    "'** 30 -3334FU +2726FU",
    "-3334FU",
    "T5",
    "'** 20 +2726FU -8384FU",
    "+2726FU",
    "T0",
    "-8384FU",
    "T4",
    "'** -100000",
    "%TORYO",
    "T2",
    "'summary:toryo:RAMU win:Panda lose",
    "'$END_TIME:2026/10/09 00:20:00",
].join("\n");

describe("parseCsaEvalComment", () => {
    it("`'** ` と `'* ` の両方から評価値と読み筋を取り出す", () => {
        expect(parseCsaEvalComment("'** 123 +7776FU -3334FU")).toEqual({
            raw: "** 123 +7776FU -3334FU",
            evalCp: 123,
            pv: ["+7776FU", "-3334FU"],
        });
        expect(parseCsaEvalComment("'* -250")).toEqual({ raw: "* -250", evalCp: -250 });
    });

    it("評価値が整数でないコメントや通常のコメントは raw だけを返す", () => {
        expect(parseCsaEvalComment("'** abc +7776FU")).toEqual({ raw: "** abc +7776FU" });
        expect(parseCsaEvalComment("'summary:toryo:A win:B lose")).toEqual({
            raw: "summary:toryo:A win:B lose",
        });
        expect(parseCsaEvalComment("'**")).toEqual({ raw: "**" });
    });
});

describe("parseCsaGameRecord", () => {
    it("wdoor 形式から指し手・消費時間・評価値・読み筋・レートを取り出す", () => {
        const record = parseCsaGameRecord(WDOOR_CSA);
        expect(record.moves).toEqual(["7g7f", "3c3d", "2g2f", "8c8d"]);
        expect(record.senteName).toBe("RAMU");
        expect(record.goteName).toBe("Panda");
        expect(record.senteRate).toBe(3456);
        expect(record.goteRate).toBe(3300.5);
        expect(record.annotations).toEqual([
            { elapsedMs: 3000, evalCp: 30, pv: ["3c3d", "2g2f"] },
            { elapsedMs: 5000, evalCp: 20, pv: ["2g2f", "8c8d"] },
            // コメントの無い指し手は評価値を持たない (前の手の値を引き継がない)。
            { elapsedMs: 0 },
            { elapsedMs: 4000, mateWinner: "gote" },
        ]);
    });

    it("終局コマンドの後ろの T 行やコメントを最終手に付けない", () => {
        const record = parseCsaGameRecord(
            ["PI", "+", "+7776FU", "%TORYO", "T9", "'** 500"].join("\n"),
        );
        expect(record.moves).toEqual(["7g7f"]);
        expect(record.annotations).toEqual([undefined]);
    });

    it("rshogi サーバー形式 (`<指し手>,T<秒>`) を読む", () => {
        const record = parseCsaGameRecord(
            [
                "V2.2",
                "N+A",
                "N-B",
                "PI",
                "+",
                "+7776FU,T4",
                "'** 45 -3334FU",
                "-3334FU,T7",
                "'* 100000",
                "+2726FU,T1",
                "%TORYO",
            ].join("\r\n"),
        );
        expect(record.moves).toEqual(["7g7f", "3c3d", "2g2f"]);
        expect(record.annotations).toEqual([
            { elapsedMs: 4000, evalCp: 45, pv: ["3c3d"] },
            { elapsedMs: 7000, mateWinner: "sente" },
            { elapsedMs: 1000 },
        ]);
    });

    it("消費時間もコメントも無い指し手は undefined にする", () => {
        const record = parseCsaGameRecord(["PI", "+", "+7776FU", "-3334FU", "T2"].join("\n"));
        expect(record.annotations).toEqual([undefined, { elapsedMs: 2000 }]);
    });

    it("評価値が整数でないコメントは無視する", () => {
        const record = parseCsaGameRecord(
            ["PI", "+", "+7776FU", "T1", "'** abc", "'ただのコメント"].join("\n"),
        );
        expect(record.annotations).toEqual([{ elapsedMs: 1000 }]);
    });

    it("読み筋を指した後の局面から USI に直す (成り・駒打ちを含む)", () => {
        const record = parseCsaGameRecord(
            ["PI", "+", "+7776FU", "-3334FU", "+8822UM", "'** 200 -3122GI +0055KA -2233GI"].join(
                "\n",
            ),
        );
        expect(record.moves).toEqual(["7g7f", "3c3d", "8h2b+"]);
        expect(record.annotations[2]).toEqual({
            evalCp: 200,
            pv: ["3a2b", "B*5e", "2b3c"],
        });
    });

    it("読み筋は「相手の応手から始まる」ものと「指した手から始まる」ものが混在してよい", () => {
        // wdoor の実物には両方がある。先頭が指した側の手番記号なら、その 1 手 (指した手) を落とす。
        const record = parseCsaGameRecord(
            [
                "PI",
                "+",
                "+7776FU",
                "T1",
                "'** 30 -3334FU +2726FU",
                "-3334FU",
                "T1",
                "'** 20 -3334FU +2726FU -8384FU",
                "+2726FU",
                "T1",
                "'** 45 +2726FU -8384FU +2625FU",
                "-8384FU",
                "T1",
                "'** 15 +2625FU -8485FU",
            ].join("\n"),
        );
        expect(record.annotations.map((annotation) => annotation?.pv)).toEqual([
            ["3c3d", "2g2f"],
            ["2g2f", "8c8d"],
            ["8c8d", "2f2e"],
            ["2f2e", "8d8e"],
        ]);
    });

    it("読み筋が指した手から始まっていればその 1 手を落とす", () => {
        const record = parseCsaGameRecord(
            ["PI", "+", "+7776FU", "'** 10 +7776FU -3334FU"].join("\n"),
        );
        expect(record.annotations[0]).toEqual({ evalCp: 10, pv: ["3c3d"] });
    });

    it("読み筋の途中に適用できない手があればそこまでにする", () => {
        const record = parseCsaGameRecord(
            ["PI", "+", "+7776FU", "'** 10 -3334FU +9999FU -8384FU"].join("\n"),
        );
        expect(record.annotations[0]).toEqual({ evalCp: 10, pv: ["3c3d"] });

        const otherLine = parseCsaGameRecord(
            ["PI", "+", "+7776FU", "'** 10 +2726FU -3334FU"].join("\n"),
        );
        expect(otherLine.annotations[0]).toEqual({ evalCp: 10 });
    });

    it("複数局が入っていれば最初の 1 局だけを読む", () => {
        const record = parseCsaGameRecord(
            ["PI", "+", "+7776FU", "%TORYO", "/", "PI", "+", "+2726FU", "-3334FU"].join("\n"),
        );
        expect(record.moves).toEqual(["7g7f"]);
    });

    it("指し手の無い棋譜は空の結果を返す", () => {
        expect(parseCsaGameRecord("V2\nN+A\nN-B\nPI\n+\n%CHUDAN")).toEqual({
            startSfen: "startpos",
            moves: [],
            annotations: [],
            senteName: "A",
            goteName: "B",
        });
    });

    it("平手は PI でも P1〜P9 でも startpos から始まる", () => {
        expect(parseCsaGameRecord("PI\n+\n+7776FU").startSfen).toBe("startpos");
        const fromRows = parseCsaGameRecord([...HIRATE_POSITION, "+", "+7776FU"].join("\n"));
        expect(fromRows.startSfen).toBe("startpos");
        expect(fromRows.moves).toEqual(["7g7f"]);
        // 行末の空白が落ちていてもよい。局面の行が無ければ平手とみなす。
        const trimmed = HIRATE_POSITION.map((row) => row.trimEnd());
        expect(parseCsaGameRecord([...trimmed, "+", "+7776FU"].join("\n")).startSfen).toBe(
            "startpos",
        );
        expect(parseCsaGameRecord("+\n+7776FU").startSfen).toBe("startpos");
    });

    it("駒落ち (後手番開始) を開始局面の SFEN つきで読む", () => {
        const record = parseCsaGameRecord(
            ["PI82HI22KA", "-", "-3334FU", "T2", "'** -900 +7776FU", "+7776FU", "T1"].join("\n"),
        );
        expect(record.startSfen).toBe(
            "lnsgkgsnl/9/ppppppppp/9/9/9/PPPPPPPPP/1B5R1/LNSGKGSNL w - 1",
        );
        expect(record.moves).toEqual(["3c3d", "7g7f"]);
        // 後手番開始でも、付随情報は指し手と同じ index に付く (評価値は先手視点のまま)。
        expect(record.annotations).toEqual([
            { elapsedMs: 2000, evalCp: -900, pv: ["7g7f"] },
            { elapsedMs: 1000 },
        ]);
    });

    it("途中局面・持ち駒あり・後手番開始の棋譜を読む (持ち駒を打つ手を含む)", () => {
        const record = parseCsaGameRecord(
            [
                "V2.2",
                "N+SelfPlay-A",
                "N-SelfPlay-B",
                ...MIDGAME_POSITION,
                "-",
                "-0055KA,T3",
                "'** -35 +2524FU -2324FU",
                "+2524FU,T4",
                "'** 60 -2324FU +2824HI",
                "-2324FU,T1",
                "+2824HI,T2",
                "'** 100000",
                "%TORYO",
            ].join("\n"),
        );
        expect(record.startSfen).toBe(
            "ln1gk1snl/1r4g2/p1ppppspp/6p2/1p5P1/2P6/PPSPPPP1P/2G4R1/LN2KGSNL w Bb 1",
        );
        expect(record.moves).toEqual(["B*5e", "2e2d", "2c2d", "2h2d"]);
        expect(record.annotations).toEqual([
            { elapsedMs: 3000, evalCp: -35, pv: ["2e2d", "2c2d"] },
            { elapsedMs: 4000, evalCp: 60, pv: ["2c2d", "2h2d"] },
            { elapsedMs: 1000 },
            { elapsedMs: 2000, mateWinner: "sente" },
        ]);
    });

    it("開始局面に無い持ち駒は打てない (局面を平手と取り違えない)", () => {
        expect(() =>
            parseCsaGameRecord([...MIDGAME_POSITION.slice(0, 9), "-", "-0055KA"].join("\n")),
        ).toThrow();
        // 手番行と最初の指し手の手番が合わなければ例外。
        expect(() => parseCsaGameRecord("PI\n-\n+7776FU")).toThrow();
    });

    it("解釈できない局面記述は例外にする", () => {
        expect(() => parseCsaGameRecord("P-51OU\nP+53FU\nP-00AL\n+\n+5352FU")).toThrow(
            /CSA の開始局面を解釈できません/,
        );
        expect(() =>
            parseCsaGameRecord([...HIRATE_POSITION.slice(0, 8), "+", "+7776FU"].join("\n")),
        ).toThrow(/CSA の開始局面を解釈できません/);
        // 指し手が無くても局面記述が壊れていれば例外。
        expect(() => parseCsaGameRecord("PI55HI\n+")).toThrow(/CSA の開始局面を解釈できません/);
    });

    it("不正な指し手は例外にする", () => {
        // 手番違い
        expect(() => parseCsaGameRecord("PI\n+\n-3334FU")).toThrow();
        // 駒の無いマスから動かす
        expect(() => parseCsaGameRecord("PI\n+\n+5544FU")).toThrow();
        // マスとして解釈できない
        expect(() => parseCsaGameRecord("PI\n+\n+7x7yFU")).toThrow(/解釈できません/);
        // 途中の不正手も例外 (途中までの再生を返さない)
        expect(() => parseCsaGameRecord("PI\n+\n+7776FU\n-3334FU\n+7775FU\n+7774FU")).toThrow();
    });
});
