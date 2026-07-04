import type { KifuEval, PositionService } from "@shogi/app-core";
import { createInitialPositionState, setPositionServiceFactory } from "@shogi/app-core";
import { beforeEach, describe, expect, it } from "vitest";
import { DEFAULT_PASS_RIGHTS_SETTINGS } from "../types";
import { normalizeEvalToSentePerspective } from "../utils/branchTreeUtils";
import { useKifuImportExport } from "./useKifuImportExport";
import type { UseKifuNavigationResult } from "./useKifuNavigation";

/**
 * `useKifuImportExport` は React フックを内部で使わない factory なので、テストから
 * 直接呼び出して `importSfen` の `initialReview.moveData` スレッディングを検証する。
 *
 * ここで固定したいのは「wire (先手視点) の評価値が符号そのままで `normalized: true`
 * として addMove に渡り、奇数 ply でも偶数 ply でも符号反転しない」ことと、
 * 「詰みセンチネル ±100000 が evalCp のまま流れる」「elapsedMs が保持される」こと。
 */

// startpos を返すだけの最小 PositionService。importSfen は parseSfen のみ使う。
const setupMockPositionService = () => {
    setPositionServiceFactory(
        () =>
            ({
                getInitialBoard: async () => createInitialPositionState(),
                parseSfen: async () => createInitialPositionState(),
                boardToSfen: async () => "startpos",
                getLegalMoves: async () => [],
                replayMovesStrict: async () => ({ applied: [], error: undefined }),
            }) as unknown as PositionService,
    );
};

interface AddMoveCall {
    move: string;
    options?: { elapsedMs?: number; eval?: KifuEval };
}

const makeHarness = () => {
    const addMoveCalls: AddMoveCall[] = [];
    const noop = () => {};
    const navigation = {
        reset: noop,
        addMove: (move: string, _next: unknown, options?: AddMoveCall["options"]) => {
            addMoveCalls.push({ move, options });
        },
        goToPly: noop,
        state: { currentPly: 0, totalPly: 0 },
    } as unknown as UseKifuNavigationResult;

    const { importSfen } = useKifuImportExport({
        navigation,
        passRightsSettings: DEFAULT_PASS_RIGHTS_SETTINGS,
        clearLegalCache: noop,
        resetClocks: noop,
        kifMoves: [],
        boardHistory: [],
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

    return { importSfen, addMoveCalls };
};

describe("importSfen: initialReview.moveData スレッディング", () => {
    beforeEach(() => {
        setupMockPositionService();
    });

    it("先手視点 eval を normalized:true で addMove に渡す (奇数/偶数 ply とも符号反転しない)", async () => {
        const { importSfen, addMoveCalls } = makeHarness();
        await importSfen("startpos", ["7g7f", "3c3d"], {
            moveData: [
                { evalCp: 120, elapsedMs: 3000 }, // ply1 (奇数=先手)
                { evalCp: -80, elapsedMs: 7000 }, // ply2 (偶数=後手)
            ],
        });

        expect(addMoveCalls).toHaveLength(2);
        // 符号そのまま + normalized:true (KIF インポートと同じ扱い)
        expect(addMoveCalls[0].options).toEqual({
            elapsedMs: 3000,
            eval: { scoreCp: 120, scoreMate: undefined, normalized: true },
        });
        expect(addMoveCalls[1].options).toEqual({
            elapsedMs: 7000,
            eval: { scoreCp: -80, scoreMate: undefined, normalized: true },
        });

        // end-to-end: navigation が normalized:true をそのまま先手視点表示に流す
        // (奇数 ply でも偶数 ply でも符号が変わらないのが回帰ポイント)
        expect(normalizeEvalToSentePerspective(addMoveCalls[0].options?.eval, 1)).toEqual({
            evalCp: 120,
            evalMate: undefined,
        });
        expect(normalizeEvalToSentePerspective(addMoveCalls[1].options?.eval, 2)).toEqual({
            evalCp: -80,
            evalMate: undefined,
        });
    });

    it("詰みセンチネル (viewer 側で ±2000 に丸め済み) は evalCp のまま流し、詰み手数 (scoreMate) を捏造しない", async () => {
        // live viewer は wire の ±100000 センチネルを moveData 生成時に ±2000 へ丸める
        // (rshogi-csa-live-viewer.tsx の MATE_DISPLAY_EVAL_CP。EvalGraph の autoscale を
        // 潰さないため)。importSfen は受け取った値を符号・大きさとも変えずに素通しする。
        const { importSfen, addMoveCalls } = makeHarness();
        await importSfen("startpos", ["7g7f", "3c3d"], {
            moveData: [{ evalCp: 2000 }, { evalCp: -2000 }],
        });
        expect(addMoveCalls[0].options?.eval).toEqual({
            scoreCp: 2000,
            scoreMate: undefined,
            normalized: true,
        });
        expect(addMoveCalls[1].options?.eval).toEqual({
            scoreCp: -2000,
            scoreMate: undefined,
            normalized: true,
        });
    });

    it("moveData が undefined の手は eval なしで addMove する (後方互換)", async () => {
        const { importSfen, addMoveCalls } = makeHarness();
        await importSfen("startpos", ["7g7f", "3c3d"], {
            moveData: [undefined, { evalCp: 50 }],
        });
        // 1 手目: moveData 無し → eval/elapsedMs とも undefined
        expect(addMoveCalls[0].options).toEqual({ elapsedMs: undefined, eval: undefined });
        // 2 手目: index 対応が保たれ eval が付く
        expect(addMoveCalls[1].options?.eval).toEqual({
            scoreCp: 50,
            scoreMate: undefined,
            normalized: true,
        });
    });

    it("moveData 省略時も従来どおり eval なしで取り込む", async () => {
        const { importSfen, addMoveCalls } = makeHarness();
        await importSfen("startpos", ["7g7f"]);
        expect(addMoveCalls[0].options).toEqual({ elapsedMs: undefined, eval: undefined });
    });
});
