import type { PositionService, PositionState } from "@shogi/app-core";
import {
    createInitialPositionState,
    parseCsaGameRecord,
    parseCsaStartPosition,
    setPositionServiceFactory,
} from "@shogi/app-core";
import { act, render, screen } from "@testing-library/react";
import type { ReactElement } from "react";
import { describe, expect, it } from "vitest";
import { DEFAULT_PASS_RIGHTS_SETTINGS } from "../types";
import { formatEval } from "../utils/kifFormat";
import { csaAnnotationsToMoveData } from "../utils/kifuImport";
import { formatElapsedTime } from "../utils/timeFormat";
import { useKifuImportExport } from "./useKifuImportExport";
import { useKifuNavigation } from "./useKifuNavigation";

/**
 * 評価値つき CSA が「CSA の解析 → moveData → importSfen → 棋譜ツリー → 棋譜一覧・評価値
 * グラフの元データ」まで通ることを、モックなしの実フック (`useKifuNavigation` +
 * `useKifuImportExport`) で確認する。
 *
 * `<ShogiMatch>` 全体はエンジン・NNUE・局面サービス (Wasm) の用意が要り、テストで
 * 実物を描画した前例も無いので、棋譜まわりの実フックをつないだこの形にしている。
 * 局面サービスだけは差し替える (SFEN の解析は Wasm 側の仕事なので、CSA から組み立てた
 * 開始局面を返す)。
 */

const noop = () => {};

let importFn: ReturnType<typeof useKifuImportExport>["importSfen"] | null = null;

function Harness(): ReactElement {
    const navigation = useKifuNavigation({
        initialPosition: createInitialPositionState(),
        initialSfen: "startpos",
    });
    const { importSfen } = useKifuImportExport({
        navigation,
        passRightsSettings: DEFAULT_PASS_RIGHTS_SETTINGS,
        clearLegalCache: noop,
        resetClocks: noop,
        kifMoves: navigation.kifMoves,
        boardHistory: navigation.boardHistory,
        sides: { sente: { role: "human" }, gote: { role: "human" } },
        startSfen: "startpos",
        setLastMove: noop,
        setSelection: noop,
        setMessage: noop,
        setPositionReady: noop,
        setBasePosition: noop,
        setStartSfen: noop,
        setInitialBoard: noop,
        setLastAddedBranchInfo: noop,
        setIsEditMode: noop,
        setIsMatchRunning: noop,
    });
    importFn = importSfen;

    return (
        <div>
            <ol aria-label="棋譜">
                {navigation.kifMoves.map((move) => (
                    <li key={move.ply}>
                        {[
                            move.ply,
                            move.displayText,
                            formatEval(move.evalCp, move.evalMate, move.ply),
                            move.elapsedMs !== undefined ? formatElapsedTime(move.elapsedMs) : "",
                            (move.pv ?? []).join(" "),
                        ].join("|")}
                    </li>
                ))}
            </ol>
            <output aria-label="評価値グラフの元データ">
                {JSON.stringify(
                    navigation.evalHistory.map((entry) => [
                        entry.ply,
                        entry.mover ?? null,
                        entry.evalCp,
                        entry.evalMate === null ? null : entry.evalMate > 0 ? "+mate" : "-mate",
                    ]),
                )}
            </output>
        </div>
    );
}

const importCsa = async (csa: string): Promise<void> => {
    const start: PositionState = parseCsaStartPosition(csa).position;
    setPositionServiceFactory(
        () =>
            ({
                getInitialBoard: async () => createInitialPositionState(),
                parseSfen: async () => start,
                boardToSfen: async () => "startpos",
                getLegalMoves: async () => [],
                replayMovesStrict: async () => ({ applied: [], error: undefined }),
            }) as unknown as PositionService,
    );
    const record = parseCsaGameRecord(csa);
    render(<Harness />);
    await act(async () => {
        await importFn?.(record.startSfen, record.moves, {
            moveData: csaAnnotationsToMoveData(record.annotations),
        });
    });
};

const kifuRows = (): string[] =>
    [...screen.getByRole("list", { name: "棋譜" }).querySelectorAll("li")].map(
        (item) => item.textContent ?? "",
    );

const graphData = (): unknown =>
    JSON.parse(screen.getByLabelText("評価値グラフの元データ").textContent ?? "null");

describe("評価値つき CSA の取り込み (実フックの結合)", () => {
    it("wdoor 形式: 評価値・詰み・読み筋・消費時間が棋譜一覧とグラフの元データに出る", async () => {
        await importCsa(
            [
                "V2",
                "PI",
                "+",
                "+7776FU",
                "T3",
                "'** 30 -3334FU +2726FU",
                "-3334FU",
                "T65",
                "'** -120 +2726FU",
                "+2726FU",
                "T2",
                "-8384FU",
                "T4",
                "'** 100000",
                "%TORYO",
            ].join("\n"),
        );

        expect(kifuRows()).toEqual([
            "1|☗7六歩(77)|+0.3|3秒|3c3d 2g2f",
            "2|☖3四歩(33)|-1.2|1分5秒|2g2f",
            // コメントの無い手は評価値が空。前後の手の値を引き継がない。
            "3|☗2六歩(27)||2秒|",
            "4|☖8四歩(83)|+詰|4秒|",
        ]);
        expect(graphData()).toEqual([
            [0, null, 0, null],
            [1, "sente", 30, null],
            [2, "gote", -120, null],
            [3, "sente", null, null],
            [4, "gote", null, "+mate"],
        ]);
    });

    it("旧 csa_client 形式: 指し手の前のコメントがその指し手に付く", async () => {
        await importCsa(
            [
                "PI",
                "+",
                "'* 30 +7776FU -3334FU",
                "+7776FU",
                "T3",
                "'* -50 -3334FU +2726FU",
                "-3334FU",
                "T5",
            ].join("\n"),
        );

        expect(kifuRows()).toEqual(["1|☗7六歩(77)|+0.3|3秒|3c3d", "2|☖3四歩(33)|-0.5|5秒|2g2f"]);
    });

    it("途中局面・後手番開始: 1 手目が後手の手として並び、評価値の符号も先手視点のまま", async () => {
        await importCsa(
            [
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
                "-",
                "-0055KA,T3",
                "'** -35 +2524FU",
                "+2524FU,T4",
                "'** 60",
            ].join("\n"),
        );

        expect(kifuRows()).toEqual(["1|☖5五角打|-0.3|3秒|2e2d", "2|☗2四歩(25)|+0.6|4秒|"]);
        expect(graphData()).toEqual([
            [0, null, 0, null],
            [1, "gote", -35, null],
            [2, "sente", 60, null],
        ]);
    });
});
