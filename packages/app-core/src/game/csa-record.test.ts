import { describe, expect, it } from "vitest";
import { parseCsaMoves } from "./csa";
import { REAL_GAME_CSA_MOVES } from "./csa-real-game.fixture";
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
                "'** 100000",
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
        expect(() => parseCsaGameRecord("P-51OU\nP+5XFU\n+\n+5352FU")).toThrow(
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

// 本番 (rshogi-csa-server) に保存されている旧サーバー形式の棋譜の先頭 10 手。
// 指し手行は `<指し手>,T<秒>`、評価値は指し手の「後ろ」に独立行の星 1 つで入っている。
const OLD_SERVER_CSA = [
    "V2.2",
    "N+rs-baseline",
    "N-rs-threat1536",
    "$GAME_ID:be-p0011-1783711724-1783711732531",
    "$START_TIME:2026/07/10 19:28:52",
    "$END_TIME:2026/07/10 19:50:07",
    "BEGIN Time",
    "Time_Unit:1sec",
    "Total_Time:600",
    "Byoyomi:10",
    "Least_Time_Per_Move:0",
    "END Time",
    "BEGIN Position",
    "P1-KY-KE-GI-KI-OU-KI-GI-KE-KY",
    "P2 * -HI *  *  *  *  * -KA * ",
    "P3-FU-FU-FU-FU-FU-FU-FU-FU-FU",
    "P4 *  *  *  *  *  *  *  *  * ",
    "P5 *  *  *  *  *  *  *  *  * ",
    "P6 *  *  *  *  *  *  *  *  * ",
    "P7+FU+FU+FU+FU+FU+FU+FU+FU+FU",
    "P8 * +KA *  *  *  *  * +HI * ",
    "P9+KY+KE+GI+KI+OU+KI+GI+KE+KY",
    "+",
    "END Position",
    "+2726FU,T2",
    "-8384FU,T0",
    "+2625FU,T0",
    "'* -55",
    "-4132KI,T0",
    "'* -55",
    "+6978KI,T0",
    "-8485FU,T0",
    "+3938GI,T0",
    "'* -33",
    "-7172GI,T0",
    "'* -15",
    "+9796FU,T0",
    "'* -27",
    "-5152OU,T0",
    "'* -46",
    "%TIME_UP",
    "",
].join("\n");

describe("parseCsaGameRecord: コメントがどの指し手のものか", () => {
    it("旧 csa_client 形式: 指し手の前の独立行 `'*` は次の指し手のコメント", () => {
        const record = parseCsaGameRecord(
            [
                "V2.2",
                "N+RAMU",
                "N-Opponent",
                "PI",
                "+",
                "'* 30 +7776FU -3334FU",
                "+7776FU",
                "T3",
                "'* 20 -3334FU +2726FU",
                "-3334FU",
                "T5",
                "+2726FU",
                "T2",
                "'* -100000 -8384FU",
                "-8384FU",
                "T4",
                "%TORYO",
            ].join("\n"),
        );
        expect(record.moves).toEqual(["7g7f", "3c3d", "2g2f", "8c8d"]);
        // 旧形式の読み筋は実際の指し手から始まるので、先頭の 1 手を落として渡す。
        expect(record.annotations).toEqual([
            { elapsedMs: 3000, evalCp: 30, pv: ["3c3d"] },
            { elapsedMs: 5000, evalCp: 20, pv: ["2g2f"] },
            // コメントの無い手に、前後の手のコメントを付けない。
            { elapsedMs: 2000 },
            { elapsedMs: 4000, mateWinner: "gote" },
        ]);
    });

    it("旧サーバー形式: `<指し手>,T<秒>` の次の独立行 `'*` は直前の指し手のコメント", () => {
        // 本番に保存されている 2026-07 以前の棋譜 (be-p0011-1783711724-1783711732531) の
        // 先頭 10 手をそのまま切り出し、実物と同じく終局コマンドで終えたもの。
        const record = parseCsaGameRecord(OLD_SERVER_CSA);
        expect(record.moves).toEqual([
            "2g2f",
            "8c8d",
            "2f2e",
            "4a3b",
            "6i7h",
            "8d8e",
            "3i3h",
            "7a7b",
            "9g9f",
            "5a5b",
        ]);
        expect(record.annotations).toEqual([
            { elapsedMs: 2000 },
            { elapsedMs: 0 },
            // 3 手目の直後のコメントは 3 手目のもの (4 手目に回さない)。
            { elapsedMs: 0, evalCp: -55 },
            { elapsedMs: 0, evalCp: -55 },
            { elapsedMs: 0 },
            { elapsedMs: 0 },
            { elapsedMs: 0, evalCp: -33 },
            { elapsedMs: 0, evalCp: -15 },
            { elapsedMs: 0, evalCp: -27 },
            // 終局コマンド直前の最後のコメントは最終手のもの (捨てない)。
            { elapsedMs: 0, evalCp: -46 },
        ]);
    });

    it("旧サーバー形式の読み筋は指した手から始まるので、先頭の 1 手を落とす", () => {
        const record = parseCsaGameRecord(
            [
                "PI",
                "+",
                "+2726FU,T2",
                "'* 30 +2726FU -8384FU +2625FU",
                "-8384FU,T0",
                "'* 20 -8384FU",
            ].join("\n"),
        );
        expect(record.annotations).toEqual([
            { elapsedMs: 2000, evalCp: 30, pv: ["8c8d", "2f2e"] },
            { elapsedMs: 0, evalCp: 20 },
        ]);
    });

    it("`'*` の前に別のコメント行が挟まっても、その前の行が何だったかで決める", () => {
        // サーバー形式の指し手行 → 無関係なコメント → `'*`: 直前の指し手のもの。
        const server = parseCsaGameRecord(
            ["PI", "+", "+7776FU,T3", "'rating:A+1:B+2", "'memo", "'* 30", "-3334FU,T1"].join("\n"),
        );
        expect(server.annotations).toEqual([{ elapsedMs: 3000, evalCp: 30 }, { elapsedMs: 1000 }]);

        // 独立した T 行 (旧 csa_client 形式) → 無関係なコメント → `'*`: 次の指し手のもの。
        const client = parseCsaGameRecord(
            ["PI", "+", "+7776FU", "T3", "'rating:A+1:B+2", "'* 30 -3334FU", "-3334FU", "T1"].join(
                "\n",
            ),
        );
        expect(client.annotations).toEqual([{ elapsedMs: 3000 }, { elapsedMs: 1000, evalCp: 30 }]);

        // 1 手に `'*` が 2 行続いたら最初の 1 行だけを使い、次の手に回さない。
        const doubled = parseCsaGameRecord(
            ["PI", "+", "+7776FU,T3", "'* 30", "'* 99", "-3334FU,T1"].join("\n"),
        );
        expect(doubled.annotations).toEqual([{ elapsedMs: 3000, evalCp: 30 }, { elapsedMs: 1000 }]);
    });

    it("T の付かない指し手行の次の `'*` は次の指し手のもの (サーバー形式とみなさない)", () => {
        const record = parseCsaGameRecord(
            ["PI", "+", "'* 10 +7776FU", "+7776FU", "'* 20 -3334FU", "-3334FU"].join("\n"),
        );
        expect(record.annotations).toEqual([{ evalCp: 10 }, { evalCp: 20 }]);
    });

    it("最後の指し手の後ろに残った `'*` はどの手にも付けない", () => {
        const record = parseCsaGameRecord(
            ["PI", "+", "+7776FU", "T1", "'* 500 -3334FU", "%TORYO"].join("\n"),
        );
        expect(record.annotations).toEqual([{ elapsedMs: 1000 }]);
    });

    it("wdoor 形式 (`'**` は直前) とサーバー形式 (`,T` 連結 + `'**`) を取り違えない", () => {
        const wdoor = parseCsaGameRecord(
            ["PI", "+", "+7776FU", "T3", "'** 30 -3334FU", "-3334FU", "T5", "'** 20"].join("\n"),
        );
        expect(wdoor.annotations).toEqual([
            { elapsedMs: 3000, evalCp: 30, pv: ["3c3d"] },
            { elapsedMs: 5000, evalCp: 20 },
        ]);
        const server = parseCsaGameRecord(
            ["PI", "+", "+7776FU,T3", "'** 30 -3334FU", "-3334FU,T5", "'** 20"].join("\n"),
        );
        expect(server.annotations).toEqual(wdoor.annotations);
    });

    it("指し手行に `,'*` で連結されたコメントはその指し手のもの", () => {
        const record = parseCsaGameRecord(
            ["PI", "+", "+7776FU,T3,'* 30 -3334FU", "-3334FU,'* 20 +2726FU"].join("\n"),
        );
        expect(record.annotations).toEqual([
            { elapsedMs: 3000, evalCp: 30, pv: ["3c3d"] },
            { evalCp: 20, pv: ["2g2f"] },
        ]);
    });

    it("1 ファイルに混在していても行ごとの規則どおりに付ける", () => {
        const record = parseCsaGameRecord(
            [
                "PI",
                "+",
                "'* 10 +7776FU", // 次の手 (1 手目)
                "+7776FU",
                "'** 99", // 直前の手 (1 手目) だが、すでにコメントがあるので使わない
                "-3334FU,'* 20", // 連結 → 2 手目
                "+2726FU",
                "T1",
                "'** 30 -8384FU", // 直前の手 (3 手目)
                "'* 40 -8384FU", // 次の手 (4 手目)
                "-8384FU",
                "'* 50", // 次の手が無いので捨てる
                "%TORYO",
            ].join("\n"),
        );
        expect(record.annotations.map((annotation) => annotation?.evalCp)).toEqual([
            10, 20, 30, 40,
        ]);
        expect(record.annotations[2]).toEqual({ elapsedMs: 1000, evalCp: 30, pv: ["8c8d"] });
    });

    it("'ILLEGAL_MOVE(...) や 'summary: の後ろのコメントを直前の手に付けない", () => {
        const illegal = parseCsaGameRecord(
            ["PI", "+", "+7776FU", "T1", "'ILLEGAL_MOVE(-3335FU)", "'** 500 -3334FU"].join("\n"),
        );
        expect(illegal.annotations).toEqual([{ elapsedMs: 1000 }]);

        const summary = parseCsaGameRecord(
            [
                "PI",
                "+",
                "+7776FU",
                "T1",
                "'summary:abnormal:A win:B lose",
                "'** 500",
                "'* 300",
                "T9",
            ].join("\n"),
        );
        expect(summary.annotations).toEqual([{ elapsedMs: 1000 }]);
    });
});

describe("parseCsaGameRecord: 指せない手を取り込まない", () => {
    const expectRejected = (lines: string[], pattern: RegExp) =>
        expect(() => parseCsaGameRecord(lines.join("\n"))).toThrow(pattern);

    it("駒コードが移動元の駒と一致しない手を弾き、行番号を示す", () => {
        expectRejected(
            ["PI", "+", "+7776HI"],
            /3 行目の指し手を適用できません: \+7776HI .*駒コード/,
        );
        // 空行や CRLF があっても元のファイルの行番号で示す。
        expect(() => parseCsaGameRecord("V2\r\n\r\nPI\r\n+\r\n+7776FU\r\n-3334KA\r\n")).toThrow(
            /6 行目の指し手を適用できません: -3334KA/,
        );
    });

    it("駒の動きとして不可能な手 (飛び越えを含む) を弾く", () => {
        // 歩が 5 マス進む
        expectRejected(["PI", "+", "+7771FU"], /動けません/);
        // 飛車が自分の歩を飛び越える
        expectRejected(["PI", "+", "+2822HI"], /動けません/);
        // 角が自分の歩を飛び越える
        expectRejected(["PI", "+", "+8833KA"], /動けません/);
        // 香が横に動く
        expectRejected(["PI", "+", "+9989KY"], /動けません|自分の駒/);
        // 銀が横に動く
        expectRejected(
            ["PI", "+", "+7776FU", "-3334FU", "+7978GI", "-8384FU", "+7868GI"],
            /動けません/,
        );
    });

    it("桂は駒を飛び越えられる", () => {
        const record = parseCsaGameRecord(["PI", "+", "+7776FU", "-3334FU", "+8977KE"].join("\n"));
        expect(record.moves).toEqual(["7g7f", "3c3d", "8i7g"]);
    });

    it("移動元に駒が無い・相手の駒を動かす・自分の駒を取る手を弾く", () => {
        expectRejected(["PI", "+", "+5544FU"], /移動元に駒がありません/);
        expectRejected(["PI", "+", "+3334FU"], /相手の駒/);
        expectRejected(["PI", "+", "+8877KA"], /自分の駒/);
        expectRejected(["PI", "+", "-3334FU"], /手番が違います/);
    });

    it("成りと不成を駒コードで区別し、成れない場所での成りを弾く", () => {
        const promote = parseCsaGameRecord(["PI", "+", "+7776FU", "-3334FU", "+8822UM"].join("\n"));
        expect(promote.moves[2]).toBe("8h2b+");
        const stay = parseCsaGameRecord(["PI", "+", "+7776FU", "-3334FU", "+8822KA"].join("\n"));
        expect(stay.moves[2]).toBe("8h2b");
        // 成った駒はその後も成り駒のコードで動く (もう一度「成る」ことはない)。
        const moved = parseCsaGameRecord(
            ["PI", "+", "+7776FU", "-3334FU", "+8822UM", "-8384FU", "+2221UM"].join("\n"),
        );
        expect(moved.moves[4]).toBe("2b2a");
        // 敵陣に出入りしない成り
        expectRejected(["PI", "+", "+7776TO"], /成れません/);
        // 成り駒を元の駒のコードで動かす
        expectRejected(
            ["PI", "+", "+7776FU", "-3334FU", "+8822UM", "-4142OU", "+2221KA"],
            /駒コード/,
        );
        // 金は成れない
        expectRejected(["P+53KI59OU", "P-11OU", "+", "+5352NG"], /駒コード/);
    });

    it("行き所のない駒になる不成を弾き、成れば受け付ける", () => {
        expectRejected(["P+12FU59OU", "P-51OU", "+", "+1211FU"], /行き所のない駒/);
        expect(
            parseCsaGameRecord(["P+12FU59OU", "P-51OU", "+", "+1211TO"].join("\n")).moves,
        ).toEqual(["1b1a+"]);
        expectRejected(["P+14KE59OU", "P-51OU", "+", "+1422KE"], /行き所のない駒/);
    });

    it("駒打ちは持ち駒にあり、空いたマスで、二歩・行き所のない駒でないこと", () => {
        const opening = ["PI", "+", "+7776FU", "-3334FU", "+8822UM", "-3122GI"];
        expect(parseCsaGameRecord([...opening, "+0055KA"].join("\n")).moves[4]).toBe("B*5e");
        expectRejected([...opening, "+0055HI"], /持ち駒にありません/);
        expectRejected([...opening, "+0076KA"], /駒のあるマス/);
        expectRejected([...opening, "+0055UM"], /打てない駒/);
        expectRejected(["P+59OU57FU00FU", "P-51OU", "+", "+0055FU"], /二歩/);
        expectRejected(["P+59OU00KE", "P-51OU", "+", "+0052KE"], /行き所のない駒/);
        expectRejected(["PI", "+", "+0055FU"], /持ち駒にありません/);
    });

    it("相手の玉を取る手を弾く", () => {
        expectRejected(["P+59OU52HI", "P-51OU", "+", "+5251HI"], /玉は取れません/);
        expectRejected(["P+59OU52HI", "P-51OU", "+", "+5251RY"], /玉は取れません/);
    });

    it("王手を放置する手を弾く", () => {
        const position = ["P+59OU58KI", "P-51HI11OU", "+"];
        expectRejected([...position, "+5848KI"], /王手を放置/);
        // 同じ筋で受け続ける手は指せる。
        expect(parseCsaGameRecord([...position, "+5857KI"].join("\n")).moves).toEqual(["5h5g"]);
    });

    it("読み筋の中の指せない手はそこで打ち切る (棋譜全体は読む)", () => {
        const record = parseCsaGameRecord(
            ["PI", "+", "+7776FU", "'** 10 -3334FU +7771FU -8384FU"].join("\n"),
        );
        expect(record.annotations[0]).toEqual({ evalCp: 10, pv: ["3c3d"] });
    });

    it("実戦の棋譜 (180 手) は 1 手も弾かずに読める", () => {
        const record = parseCsaGameRecord(`PI\n${REAL_GAME_CSA_MOVES}`);
        expect(record.moves).toHaveLength(180);
        expect(record.moves).toEqual(parseCsaMoves(REAL_GAME_CSA_MOVES));
    });
});
