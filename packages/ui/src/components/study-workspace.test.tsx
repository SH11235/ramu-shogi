import {
    applyStudyOps,
    buildStudyLayerSpec,
    type StudyDocument,
    type StudyOp,
    type StudyScore,
    studyChildNodeId,
    studyLayerId,
} from "@shogi/app-core";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { useState } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_ANALYSIS_SETTINGS, type Message } from "./shogi-match/types";
import { StudyWorkspaceView } from "./study-workspace";
import type { StudyCommentDraftChange } from "./study-workspace/StudyCommentBox";
import type { StudyWorkspaceSaveStatus } from "./study-workspace/StudySaveStatus";
import {
    cp,
    createTestStudy,
    putScoreOp,
    TEST_LAYER_ID,
} from "./study-workspace/study-test-support";
import { buildStudyViewTree, chooseStudyDisplayLayer } from "./study-workspace/studyView";
import type { StudyAnalysisController } from "./study-workspace/useStudyAnalysis";

const LOCAL_STATUS: StudyWorkspaceSaveStatus = {
    state: "local",
    reason: "anonymous",
    limit: null,
    retrying: false,
};

const createAnalysis = (
    overrides: Partial<StudyAnalysisController> = {},
): StudyAnalysisController => ({
    mode: null,
    isPreparing: false,
    progress: null,
    live: null,
    settingsLabel: "RAMU・1 秒",
    fullTargetCount: 5,
    startFull: vi.fn(async () => {}),
    resumeLayer: vi.fn(async () => {}),
    startDeep: vi.fn(async () => {}),
    cancel: vi.fn(async () => {}),
    form: {
        settings: DEFAULT_ANALYSIS_SETTINGS,
        onSettingsChange: vi.fn(),
        nnueSelection: { presetKey: "ramu", nnueId: null },
        onNnueSelectionChange: vi.fn(),
        presets: [],
        nnueList: [],
        isNnueListLoading: false,
    },
    ...overrides,
});

interface HarnessProps {
    initialDoc: StudyDocument;
    analysis?: StudyAnalysisController;
    saveStatus?: StudyWorkspaceSaveStatus;
    onOps?: (ops: StudyOp[]) => void;
    onLogin?: () => void;
    onRetrySave?: () => void;
    onDiscard?: () => void;
    fetchLegalMoves?: (sfen: string, moves: string[]) => Promise<string[]>;
    /** 保存層が操作を受け付けなかった場合の模擬（文書を変えず、理由を通知する）。 */
    rejectOps?: boolean;
    locked?: boolean;
    initialCommentDrafts?: { nodeId: string; text: string; base?: string | null }[];
    onCommentDraftChange?: (nodeId: string, change: StudyCommentDraftChange) => void;
    /**
     * 保存層の応答を手で進めるための差し込み。Promise を返した操作は、文書には反映せず、
     * その Promise を保存の結果として返す。
     */
    interceptOps?: (ops: StudyOp[]) => Promise<boolean> | undefined;
    /** 他のタブ・端末からの変更を模擬するための口（文書に操作を適用する関数を受け取る）。 */
    onExternal?: (apply: (ops: StudyOp[]) => void) => void;
    /** 文書のコメントが最新だと確かめられているか（サーバーの最新の内容を取り込めたか）。 */
    commentBaseConfirmed?: boolean;
    /** 最初に表示する解析の設定（省略時は、結果の最も多いもの）。 */
    initialDisplayLayerId?: string;
    deepLayerId?: string | null;
}

/** 呼び出し側（ページ）の代わりに、操作を文書へ適用して画面に渡し直す。 */
function Harness({
    initialDoc,
    analysis = createAnalysis(),
    saveStatus = LOCAL_STATUS,
    onOps,
    onLogin,
    onRetrySave,
    onDiscard,
    fetchLegalMoves,
    rejectOps = false,
    locked,
    initialCommentDrafts,
    onCommentDraftChange,
    interceptOps,
    onExternal,
    commentBaseConfirmed,
    initialDisplayLayerId,
    deepLayerId,
}: HarnessProps) {
    const [doc, setDoc] = useState(initialDoc);
    const [message, setMessage] = useState<Message | null>(null);
    const [preferredLayerId, setPreferredLayerId] = useState<string | null>(
        initialDisplayLayerId ?? null,
    );
    const displayLayerId = chooseStudyDisplayLayer(doc.layers, preferredLayerId);
    onExternal?.((ops) => setDoc((previous) => applyStudyOps(previous, ops)));
    const { tree } = buildStudyViewTree(doc, displayLayerId);
    return (
        <StudyWorkspaceView
            doc={doc}
            tree={tree}
            onApplyOps={(ops) => {
                onOps?.(ops);
                const intercepted = interceptOps?.(ops);
                if (intercepted) return intercepted;
                if (rejectOps) {
                    setMessage({ text: "このノートの局面の数が上限に達しました。", type: "error" });
                    return Promise.resolve(false);
                }
                setDoc((previous) => applyStudyOps(previous, ops));
                return undefined;
            }}
            saveStatus={saveStatus}
            onLogin={onLogin}
            onRetrySave={onRetrySave}
            onDiscard={onDiscard}
            fetchLegalMoves={fetchLegalMoves}
            locked={locked}
            initialCommentDrafts={initialCommentDrafts}
            onCommentDraftChange={onCommentDraftChange}
            commentBaseConfirmed={commentBaseConfirmed}
            displayLayerId={displayLayerId}
            onDisplayLayerChange={setPreferredLayerId}
            deepLayerId={deepLayerId}
            analysis={analysis}
            message={message}
            onMessageChange={setMessage}
        />
    );
}

const highlights = () => screen.getByRole("region", { name: "注目局面" });
const moveList = () => screen.getByRole("region", { name: "棋譜と変化" });
const currentMove = () =>
    within(moveList()).getAllByRole("button", { current: true })[0]?.textContent ?? "";

describe("StudyWorkspaceView", () => {
    beforeEach(() => {
        localStorage.clear();
    });

    it("未解析のノートでは「全体を解析」が主操作として出る", () => {
        const analysis = createAnalysis();
        render(<Harness initialDoc={createTestStudy().doc} analysis={analysis} />);

        expect(
            within(highlights()).getByText("全体を解析すると、見直すべき手がここに並びます。"),
        ).toBeTruthy();
        expect(within(highlights()).getByText("RAMU・1 秒で 5 局面を解析します。")).toBeTruthy();
        fireEvent.click(within(highlights()).getByRole("button", { name: "全体を解析" }));
        expect(analysis.startFull).toHaveBeenCalledTimes(1);
        // 候補手はまだ無い。
        expect(screen.getByText("この局面はまだ解析していません。")).toBeTruthy();
    });

    it("いまの設定の解析が済んでいるのに別の設定の結果を表示しているときは、「0 局面を解析します」と出さない", () => {
        // 表示しているのは、1 局面だけ深く解析した結果（全体の半分に満たない）。
        const { doc } = createTestStudy([cp(0), null, null, null, null]);
        const analysis = createAnalysis({
            settingsLabel: "簡易AI（駒得）・1 秒",
            fullTargetCount: 0,
        });
        render(<Harness initialDoc={doc} analysis={analysis} />);

        expect(highlights().textContent).not.toContain("0 局面を解析します");
        expect(
            within(highlights()).getByText(/簡易AI（駒得）・1 秒の解析は全局面で済んでいます/),
        ).toBeTruthy();
        fireEvent.click(within(highlights()).getByRole("button", { name: "解析済みの結果を表示" }));
        expect(analysis.startFull).toHaveBeenCalledTimes(1);
    });

    it("解析中は進み具合と中止を出し、全体を解析は出さない", () => {
        const analysis = createAnalysis({ mode: "full", progress: { completed: 2, total: 5 } });
        render(
            <Harness
                initialDoc={createTestStudy([cp(0), cp(10), null, null, null]).doc}
                analysis={analysis}
            />,
        );

        expect(within(highlights()).getByText("解析中 2 / 5 局面")).toBeTruthy();
        expect(within(highlights()).queryByRole("button", { name: "全体を解析" })).toBeNull();
        fireEvent.click(within(highlights()).getByRole("button", { name: "中止" }));
        expect(analysis.cancel).toHaveBeenCalledTimes(1);
        // 解析中は「この局面を深く解析」を押せない。
        expect(
            (screen.getByRole("button", { name: "この局面を深く解析" }) as HTMLButtonElement)
                .disabled,
        ).toBe(true);
    });

    it("解析後は悪手・疑問手が並び、押すとその局面へ移る", () => {
        // 3 手目（☗2六歩）で先手が大きく損をした、という評価値。
        const { doc } = createTestStudy([cp(30), cp(40), cp(20), cp(-900), cp(-880)]);
        render(<Harness initialDoc={doc} />);

        expect(within(highlights()).getByText("悪手・疑問手 1 手")).toBeTruthy();
        const item = within(highlights()).getByRole("button", { name: /3手目 ☗2六歩\(27\)/ });
        expect(item.textContent).toContain("悪手");
        expect(item.textContent).toContain("+0.2 → -9.0");
        expect(currentMove()).toContain("開始局面");

        fireEvent.click(item);

        expect(currentMove()).toContain("☗2六歩(27)");
        expect(screen.getByText("3手目 ☗2六歩(27)", { selector: "output span" })).toBeTruthy();
        // その局面の候補手（表示中の解析の結果）が出る。
        expect(screen.getByText("RAMU・1 秒・深さ 15")).toBeTruthy();
        // 棋譜にも悪手の印が付く。
        expect(within(moveList()).getByRole("img", { name: "悪手" })).toBeTruthy();
    });

    it("盤上で駒を動かすと変化ができ、操作が保存層へ流れる", async () => {
        const { doc, ids } = createTestStudy();
        const onOps = vi.fn();
        const fetchLegalMoves = vi.fn(async () => ["7g7f", "2g2f", "5g5f"]);
        render(<Harness initialDoc={doc} onOps={onOps} fetchLegalMoves={fetchLegalMoves} />);

        // 開始局面で、本譜（☗7六歩）と違う手（☗5六歩）を指す。
        fireEvent.click(screen.getByRole("button", { name: /^5g 先手の歩/ }));
        await act(async () => {
            fireEvent.click(screen.getByRole("button", { name: /^5f 空マス/ }));
        });

        await waitFor(() =>
            expect(onOps).toHaveBeenCalledWith([
                { type: "addMoves", parentId: ids[0], moves: ["5g5f"] },
            ]),
        );
        expect(currentMove()).toContain("☗5六歩(57)");
        expect(within(moveList()).getByText("変化を表示中")).toBeTruthy();

        // 本譜に戻ると、足した変化が枝として見える。
        fireEvent.click(within(moveList()).getByRole("button", { name: "本譜に戻る" }));
        expect(within(moveList()).queryByText("変化を表示中")).toBeNull();
        expect(
            within(moveList()).getByRole("button", { name: /変化\s*☗5六歩\(57\)\s*1 手/ }),
        ).toBeTruthy();
    });

    it("既にある手を指したときは、手を足さずにその手へ移る", async () => {
        const { doc } = createTestStudy();
        const onOps = vi.fn();
        render(<Harness initialDoc={doc} onOps={onOps} fetchLegalMoves={async () => ["7g7f"]} />);

        fireEvent.click(screen.getByRole("button", { name: /^7g 先手の歩/ }));
        await act(async () => {
            fireEvent.click(screen.getByRole("button", { name: /^7f 空マス/ }));
        });

        await waitFor(() => expect(currentMove()).toContain("☗7六歩(77)"));
        expect(onOps).not.toHaveBeenCalled();
    });

    it("しおり・コメント・表題の編集が操作として流れる", async () => {
        const { doc, ids } = createTestStudy();
        const onOps = vi.fn();
        render(<Harness initialDoc={doc} onOps={onOps} />);

        fireEvent.click(screen.getByRole("button", { name: "1 手進む（→）" }));
        fireEvent.click(screen.getByRole("button", { name: "この手にしおりを付ける" }));
        expect(onOps).toHaveBeenLastCalledWith([
            { type: "setBookmark", nodeId: ids[1], value: true },
        ]);
        expect(screen.getByRole("button", { name: "しおりを外す" })).toBeTruthy();
        // しおりを付けた手は、解析していなくても注目局面に並ぶ。
        expect(
            within(highlights()).getByRole("button", { name: /1手目 ☗7六歩\(77\)/ }),
        ).toBeTruthy();

        const comment = screen.getByRole("textbox", { name: "コメント" });
        fireEvent.change(comment, { target: { value: "角道を開ける" } });
        fireEvent.blur(comment);
        expect(onOps).toHaveBeenLastCalledWith([
            { type: "setComment", nodeId: ids[1], value: "角道を開ける" },
        ]);

        const title = screen.getByRole("textbox", { name: "研究ノートの表題" });
        fireEvent.change(title, { target: { value: "  振り返り  " } });
        fireEvent.blur(title);
        expect(onOps).toHaveBeenLastCalledWith([{ type: "setTitle", value: "振り返り" }]);
    });

    it("キーボードの ← → で手を移動する", () => {
        render(<Harness initialDoc={createTestStudy().doc} />);

        fireEvent.keyDown(document, { key: "ArrowRight" });
        fireEvent.keyDown(document, { key: "ArrowRight" });
        expect(currentMove()).toContain("☖3四歩(33)");
        fireEvent.keyDown(document, { key: "ArrowLeft" });
        expect(currentMove()).toContain("☗7六歩(77)");
        fireEvent.keyDown(document, { key: "End" });
        expect(currentMove()).toContain("☖8四歩(83)");
    });

    it("変化は確認してから削除する", async () => {
        const { doc, ids } = createTestStudy();
        const branchId = studyChildNodeId(ids[0], "5g5f");
        const withBranch = applyStudyOps(doc, [
            { type: "addMoves", parentId: ids[0], moves: ["5g5f"] },
        ]);
        const onOps = vi.fn();
        render(<Harness initialDoc={withBranch} onOps={onOps} />);

        fireEvent.click(within(moveList()).getByRole("button", { name: "変化 ☗5六歩(57) を削除" }));
        expect(onOps).not.toHaveBeenCalled();
        fireEvent.click(await screen.findByRole("button", { name: "削除する" }));

        expect(onOps).toHaveBeenCalledWith([{ type: "deleteSubtree", nodeId: branchId }]);
        await waitFor(() =>
            expect(
                within(moveList()).queryByRole("button", { name: /変化\s*☗5六歩\(57\)\s*1 手/ }),
            ).toBeNull(),
        );
    });

    it("読み筋を変化として追加できる", () => {
        const { doc, ids } = createTestStudy();
        // 開始局面の候補手に、本譜と違う読み筋を入れる。
        const analyzed = applyStudyOps(createTestStudy([cp(30), null, null, null, null]).doc, [
            {
                type: "putAnalysis",
                layerId: TEST_LAYER_ID,
                nodeId: ids[0],
                result: {
                    runId: "run-2",
                    completion: "completed",
                    depth: 20,
                    nodes: null,
                    timeMs: null,
                    execution: { threads: null, hashMb: null, parallelWorkers: null },
                    candidates: [
                        {
                            rank: 1,
                            score: cp(60),
                            depth: 20,
                            seldepth: null,
                            pv: ["2g2f", "8c8d"],
                        },
                    ],
                },
            },
        ]);
        expect(doc.id).toBe(analyzed.id);
        const onOps = vi.fn();
        render(<Harness initialDoc={analyzed} onOps={onOps} />);

        fireEvent.click(screen.getByRole("button", { name: "候補 1 の読み筋を変化として追加" }));

        expect(onOps).toHaveBeenCalledWith([
            { type: "addMoves", parentId: ids[0], moves: ["2g2f", "8c8d"] },
        ]);
        expect(currentMove()).toContain("☗2六歩(27)");
        expect(screen.getByText("読み筋を変化として追加しました（2 手）")).toBeTruthy();
    });

    it("「この局面を深く解析」は、いま見ている局面を解析する", () => {
        const { doc, ids } = createTestStudy();
        const analysis = createAnalysis();
        render(<Harness initialDoc={doc} analysis={analysis} />);

        fireEvent.click(screen.getByRole("button", { name: "1 手進む（→）" }));
        fireEvent.click(screen.getByRole("button", { name: "この局面を深く解析" }));
        expect(analysis.startDeep).toHaveBeenCalledWith(ids[1]);
    });

    it("悪手には代わりの最善手を添え、押すと「この手の代わりに」の候補手が先に出る", () => {
        const { doc, ids } = createTestStudy([cp(30), cp(40), cp(20), cp(-900), cp(-880)]);
        // 3 手目（☗2六歩）の 1 手前の局面の最善は ☗6六歩、という結果にする。
        const withBest = applyStudyOps(doc, [
            putScoreOp(ids[2], cp(25), { depth: 18, pv: ["6g6f", "8c8d"] }),
        ]);
        render(<Harness initialDoc={withBest} />);

        const item = within(highlights()).getByRole("button", { name: /3手目 ☗2六歩\(27\)/ });
        expect(item.textContent).toContain("最善 ☗6六歩(67)");

        fireEvent.click(item);

        const candidates = screen.getByRole("region", { name: "候補手" });
        expect(
            within(candidates).getByRole("heading", {
                name: "この手の代わりに（1 手前の局面の候補）",
            }),
        ).toBeTruthy();
        expect(within(candidates).getByText(/指した手 ☗2六歩\(27\)（悪手）/)).toBeTruthy();
        expect(within(candidates).getByText("☗6六歩(67)")).toBeTruthy();
        expect(within(candidates).getByRole("heading", { name: "この局面の候補手" })).toBeTruthy();
        // 代わりの読み筋は、1 手前の局面からの変化として足せる。
        const before = within(moveList()).queryByText("変化を表示中");
        expect(before).toBeNull();
        fireEvent.click(
            within(candidates).getByRole("button", {
                name: "代わりの候補 1 の読み筋を変化として追加",
            }),
        );
        expect(currentMove()).toContain("☗6六歩(67)");
    });

    describe("同じ AI で設定の違う解析結果が 2 つあるとき", () => {
        // 表示中の設定（0.5 秒・候補 2）と、同じ AI で時間の長い設定（1 秒・候補 1）。
        const FAST_SPEC = buildStudyLayerSpec({
            engine: { kind: "wasm", name: "rshogi", version: "0.8.1" },
            appVersion: "0.0.0",
            nnue: { sha256: "a".repeat(64), fvScale: 24 },
            limits: { timeMs: 500, depth: 15 },
            multiPv: 2,
        });
        const FAST_ID = studyLayerId(FAST_SPEC);
        const candidate = (rank: number, score: StudyScore, pv: string[]) => ({
            rank,
            score,
            depth: 9,
            seldepth: null,
            pv,
        });
        /** 0.5 秒の設定の結果（候補 2 つ）を入れる操作。 */
        const putFast = (
            nodeId: string,
            first: [StudyScore, string[]],
            second: [StudyScore, string[]],
        ): StudyOp => ({
            type: "putAnalysis",
            layerId: FAST_ID,
            nodeId,
            result: {
                runId: "run-fast",
                completion: "completed",
                depth: 9,
                nodes: null,
                timeMs: null,
                execution: { threads: null, hashMb: null, parallelWorkers: null },
                candidates: [candidate(1, ...first), candidate(2, ...second)],
            },
        });
        /**
         * 1 秒の設定（候補 1）で全体を解析したあと、0.5 秒の設定（候補 2）で全体を解析した文書。
         * 2 つの設定で、各局面の最善手と評価値が違う。
         */
        const createTwoLayerStudy = () => {
            // 1 秒の設定: 3 手目の 1 手前の局面の最善は ☗5六歩、という結果。
            const { doc, ids } = createTestStudy([cp(30), cp(40), cp(20), cp(-900), cp(-880)]);
            const withSlowPv = applyStudyOps(doc, [
                putScoreOp(ids[1], cp(45), { depth: 20, pv: ["8c8d"] }),
                putScoreOp(ids[2], cp(-20), { depth: 20, pv: ["5g5f", "8c8d"] }),
                putScoreOp(ids[3], cp(-700), { depth: 20, pv: ["4c4d"] }),
            ]);
            // 0.5 秒の設定: 同じ局面の最善は ☗6六歩（次点 ☗4六歩）。
            const twoLayers = applyStudyOps(withSlowPv, [
                { type: "ensureLayer", spec: FAST_SPEC, display: { label: "RAMU・0.5 秒" } },
                putFast(ids[0], [cp(35), ["7g7f"]], [cp(10), ["2g2f"]]),
                putFast(ids[1], [cp(50), ["3c3d"]], [cp(60), ["8c8d"]]),
                putFast(ids[2], [cp(240), ["6g6f", "8c8d"]], [cp(120), ["4g4f"]]),
                putFast(ids[3], [cp(-800), ["8c8d"]], [cp(-600), ["4c4d"]]),
                putFast(ids[4], [cp(-810), ["2f2e"]], [cp(-900), ["6g6f"]]),
            ]);
            return { doc: twoLayers, ids };
        };

        it("注目局面の行の「最善」と、候補手の「この手の代わりに」の 1 位が、全行で一致する", () => {
            const { doc } = createTwoLayerStudy();
            render(<Harness initialDoc={doc} initialDisplayLayerId={FAST_ID} />);

            const rows = within(highlights())
                .getAllByRole("button")
                .filter((row) => /手目/.test(row.textContent ?? ""));
            expect(rows.length).toBeGreaterThan(0);
            let compared = 0;
            for (const row of rows) {
                const best = /最善\s*(\S+)/.exec(row.textContent ?? "")?.[1];
                if (best === undefined) continue;
                fireEvent.click(row);
                const candidates = screen.getByRole("region", { name: "候補手" });
                const heading = within(candidates).getByRole("heading", {
                    name: "この手の代わりに（1 手前の局面の候補）",
                });
                const group = heading.closest("div")?.parentElement as HTMLElement;
                const items = within(group).getAllByRole("listitem");
                // 1 位が行の「最善」と同じ手で、候補の数は表示中の設定（候補 2）どおり。
                expect(items[0].textContent).toContain(best);
                expect(items).toHaveLength(2);
                // どの設定の結果かは、表示中の設定の名前で出す（別の設定の名前を出さない）。
                expect(group.textContent).toContain("RAMU・0.5 秒");
                expect(group.textContent).not.toContain("RAMU・1 秒");
                compared++;
            }
            expect(compared).toBeGreaterThan(0);
        });

        it("この局面の候補手は表示中の設定の結果で、より深い結果は別の段に添える", () => {
            const { doc } = createTwoLayerStudy();
            render(<Harness initialDoc={doc} initialDisplayLayerId={FAST_ID} />);
            fireEvent.click(screen.getByRole("button", { name: "1 手進む（→）" }));
            fireEvent.click(screen.getByRole("button", { name: "1 手進む（→）" }));

            const candidates = screen.getByRole("region", { name: "候補手" });
            // 表示中の設定（0.5 秒・候補 2）の候補手が 2 つ。
            expect(within(candidates).getByText("☗6六歩(67)")).toBeTruthy();
            expect(within(candidates).getByText("☗4六歩(47)")).toBeTruthy();
            expect(candidates.textContent).not.toContain("深く解析した結果");
            // 1 秒の設定の結果は、差し替えずに「より深い解析」として 1 行で添える。
            const deeper = within(candidates).getByRole("button", { name: /より深い解析/ });
            expect(deeper.textContent).toContain("RAMU・1 秒");
            expect(deeper.textContent).toContain("☗5六歩(57)");
            expect(deeper.getAttribute("aria-expanded")).toBe("false");
            // 開くと読み筋を見られ、その設定に表示を切り替えられる。
            fireEvent.click(deeper);
            expect(
                within(candidates).getByRole("button", {
                    name: "深い解析の候補 1 の読み筋を盤で見る",
                }),
            ).toBeTruthy();
            fireEvent.click(
                within(candidates).getByRole("button", {
                    name: "表示を「RAMU・1 秒」の結果に切り替える",
                }),
            );
            // 切り替えたあとは、1 秒の設定の結果が「この局面の候補手」になる。
            expect(within(candidates).queryByRole("button", { name: /より深い解析/ })).toBeNull();
            expect(within(candidates).getByText("☗5六歩(57)")).toBeTruthy();
            expect(within(candidates).queryByText("☗4六歩(47)")).toBeNull();
        });

        it("いま「この局面を深く解析」で得た結果は、その局面を見ている間、開いた状態で目立たせる", () => {
            const { doc } = createTwoLayerStudy();
            const analysis = createAnalysis();
            render(
                <Harness initialDoc={doc} analysis={analysis} initialDisplayLayerId={FAST_ID} />,
            );
            fireEvent.click(screen.getByRole("button", { name: "1 手進む（→）" }));
            fireEvent.click(screen.getByRole("button", { name: "この局面を深く解析" }));

            const candidates = screen.getByRole("region", { name: "候補手" });
            const fresh = within(candidates).getByRole("button", { name: /深く解析した結果/ });
            expect(fresh.getAttribute("aria-expanded")).toBe("true");
            expect(fresh.textContent).toContain("RAMU・1 秒");
            // 候補手そのものは、表示中の設定のまま。
            expect(within(candidates).getByText("☖3四歩(33)")).toBeTruthy();

            // 別の局面へ移って戻ると、ふだんの「より深い解析」（畳んだ状態）に戻る。
            fireEvent.click(screen.getByRole("button", { name: "1 手進む（→）" }));
            fireEvent.click(screen.getByRole("button", { name: "1 手戻る（←）" }));
            const folded = within(candidates).getByRole("button", { name: /より深い解析/ });
            expect(folded.getAttribute("aria-expanded")).toBe("false");
        });

        it("別の AI で深く解析した結果も、押した局面では必ず出す", () => {
            const { doc, ids } = createTestStudy([cp(30), cp(40), cp(20), cp(-900), cp(-880)]);
            const OTHER_SPEC = buildStudyLayerSpec({
                engine: { kind: "wasm", name: "rshogi", version: "0.8.1" },
                appVersion: "0.0.0",
                nnue: null,
                limits: { timeMs: 10_000, depth: 64 },
                multiPv: 3,
            });
            const otherId = studyLayerId(OTHER_SPEC);
            const withOther = applyStudyOps(doc, [
                {
                    type: "ensureLayer",
                    spec: OTHER_SPEC,
                    display: { label: "簡易AI（駒得）・10 秒" },
                },
                putScoreOp(ids[0], cp(5), { layerId: otherId, depth: 30, pv: ["2g2f"] }),
            ]);
            render(<Harness initialDoc={withOther} deepLayerId={otherId} />);

            const candidates = screen.getByRole("region", { name: "候補手" });
            // 押す前は、別の AI の結果は出さない。
            expect(within(candidates).queryByRole("button", { name: /解析（|結果（/ })).toBeNull();
            fireEvent.click(screen.getByRole("button", { name: "この局面を深く解析" }));
            const fresh = within(candidates).getByRole("button", { name: /深く解析した結果/ });
            expect(fresh.textContent).toContain("簡易AI（駒得）・10 秒");
            expect(fresh.textContent).toContain("☗2六歩(27)");
        });
    });

    it("同じ AI のより時間の長い結果でも、深さが表示中の結果を超えなければ「より深い解析」に出さない", () => {
        const { doc, ids } = createTestStudy([cp(30), cp(40), cp(20), null, null]);
        const LONGER_SPEC = buildStudyLayerSpec({
            engine: { kind: "wasm", name: "rshogi", version: "0.8.1" },
            appVersion: "0.0.0",
            nnue: { sha256: "a".repeat(64), fvScale: 24 },
            limits: { timeMs: 10_000, depth: 64 },
            multiPv: 1,
        });
        const longerId = studyLayerId(LONGER_SPEC);
        // 表示中の結果の深さは 15。開始局面は同じ深さ、1 手目はより深い結果がある。
        const withLonger = applyStudyOps(doc, [
            { type: "ensureLayer", spec: LONGER_SPEC, display: { label: "RAMU・10 秒" } },
            putScoreOp(ids[0], cp(35), { layerId: longerId, depth: 15, pv: ["2g2f"] }),
            putScoreOp(ids[1], cp(45), { layerId: longerId, depth: 16, pv: ["8c8d"] }),
        ]);
        render(<Harness initialDoc={withLonger} />);
        const candidates = screen.getByRole("region", { name: "候補手" });

        expect(within(candidates).queryByRole("button", { name: /より深い解析/ })).toBeNull();
        fireEvent.click(screen.getByRole("button", { name: "1 手進む（→）" }));
        expect(within(candidates).getByRole("button", { name: /より深い解析/ })).toBeTruthy();
    });

    describe("見ている局面が文書から消えたとき", () => {
        /** 本譜の 2 手目から枝分かれする変化（3 手）を持つ文書。 */
        const createBranched = () => {
            const { doc, ids } = createTestStudy();
            const head = studyChildNodeId(ids[2], "6g6f");
            const second = studyChildNodeId(head, "8c8d");
            const third = studyChildNodeId(second, "6f6e");
            const branched = applyStudyOps(doc, [
                { type: "addMoves", parentId: ids[2], moves: ["6g6f", "8c8d", "6f6e"] },
            ]);
            return { doc: branched, ids, head, third };
        };

        it("別の画面が変化を削除したら、残っている最も近い祖先（分岐点）へ移り、知らせる", () => {
            const { doc, head } = createBranched();
            let external: (ops: StudyOp[]) => void = () => {};
            render(
                <Harness
                    initialDoc={doc}
                    onExternal={(apply) => {
                        external = apply;
                    }}
                />,
            );
            // 本譜の最後（4 手目）を見てから、変化の最初の手へ直接移る（直前に見ていたのは本譜の最後）。
            fireEvent.click(screen.getByRole("button", { name: "最後の局面へ" }));
            expect(currentMove()).toContain("☖8四歩(83)");
            fireEvent.click(
                within(moveList()).getAllByRole("button", { name: /変化.*☗6六歩\(67\)/ })[0],
            );
            expect(currentMove()).toContain("☗6六歩(67)");

            // 別の画面が、見ている変化を削除した。
            act(() => external([{ type: "deleteSubtree", nodeId: head }]));

            // 分岐点（本譜の 2 手目）に移る。直前に見ていた本譜の最後（4 手目）へは飛ばない。
            expect(currentMove()).toContain("☖3四歩(33)");
            expect(screen.getByText("2 / 4")).toBeTruthy();
            expect(screen.getByText(/見ていた変化は別の画面で削除されました/)).toBeTruthy();
        });

        it("この画面で足して保存層に拒否された手は、「別の画面で削除された」とは知らせない", async () => {
            const { doc } = createTestStudy();
            const pending: Array<(saved: boolean) => void> = [];
            let external: (ops: StudyOp[]) => void = () => {};
            render(
                <Harness
                    initialDoc={doc}
                    fetchLegalMoves={async () => ["7g7f", "5g5f"]}
                    onExternal={(apply) => {
                        external = apply;
                    }}
                    interceptOps={(ops) => {
                        if (!ops.some((op) => op.type === "addMoves")) return undefined;
                        // 画面には先に反映し、保存の結果はあとで返す（ページと同じ）。
                        external(ops);
                        return new Promise<boolean>((resolve) => pending.push(resolve));
                    }}
                />,
            );
            // 開始局面で、本譜とは別の手（☗5六歩）を指す。
            fireEvent.click(screen.getByRole("button", { name: /^5g 先手の歩/ }));
            await act(async () => {
                fireEvent.click(screen.getByRole("button", { name: /^5f 空マス/ }));
            });
            await waitFor(() => expect(pending).toHaveLength(1));
            expect(currentMove()).toContain("☗5六歩(57)");
            const added = studyChildNodeId(doc.tree.rootId, "5g5f");

            // 保存層が拒否し、画面に先に反映していた手が取り消された。
            await act(async () => {
                external([{ type: "deleteSubtree", nodeId: added }]);
                pending[0](false);
            });

            expect(screen.getByText("0 / 4")).toBeTruthy();
            expect(screen.queryByText(/別の画面で削除されました/)).toBeNull();
        });
    });

    it("指した手が 1 手前の局面の 1 位の候補と同じなら、「この手の代わりに」は出さない", () => {
        const { doc, ids } = createTestStudy([cp(30), cp(40), cp(20), cp(-900), cp(-880)]);
        // 3 手目（☗2六歩）は、1 手前の局面の解析でも 1 位の手。
        const playedBest = applyStudyOps(doc, [
            putScoreOp(ids[2], cp(25), { depth: 18, pv: ["2g2f", "8c8d"] }),
        ]);
        render(<Harness initialDoc={playedBest} />);

        const item = within(highlights()).getByRole("button", { name: /3手目 ☗2六歩\(27\)/ });
        // 行には、代わりの最善手も、指した手を最善と呼ぶ文言も出さない。
        expect(item.textContent).not.toContain("最善");
        fireEvent.click(item);

        const candidates = screen.getByRole("region", { name: "候補手" });
        expect(within(candidates).queryByRole("heading", { name: /この手の代わりに/ })).toBeNull();
        expect(within(candidates).queryByRole("heading", { name: "この局面の候補手" })).toBeNull();
        expect(
            within(candidates).getByText(/指した手 ☗2六歩\(27\) は、1 手前の局面の候補の 1/),
        ).toBeTruthy();
    });

    it("「残りを解析」は、表示中の設定の未解析分を、その設定で解析する", () => {
        const { doc } = createTestStudy([cp(0), cp(10), cp(20), null, null]);
        // 設定の画面には、表示中とは別の設定（簡易AI・0.5 秒）が残っている。
        const analysis = createAnalysis({ settingsLabel: "簡易AI（駒得）・0.5 秒" });
        render(<Harness initialDoc={doc} analysis={analysis} />);

        // 文言の設定名と局面数は、表示中の設定のもの。
        expect(
            within(highlights()).getByText(/RAMU・1 秒で未解析の局面が 2\s*あります。/),
        ).toBeTruthy();
        expect(highlights().textContent).not.toContain("簡易AI");
        fireEvent.click(within(highlights()).getByRole("button", { name: "残りを解析" }));

        expect(analysis.resumeLayer).toHaveBeenCalledWith(TEST_LAYER_ID);
        expect(analysis.startFull).not.toHaveBeenCalled();
    });

    it("長すぎて保存できないコメントを残して手を移ると、知らせて、その手に下書きと印を残す", () => {
        const { doc, ids } = createTestStudy();
        const onOps = vi.fn();
        const onDraft = vi.fn();
        render(<Harness initialDoc={doc} onOps={onOps} onCommentDraftChange={onDraft} />);
        const comment = () =>
            screen.getByRole("textbox", { name: "コメント" }) as HTMLTextAreaElement;
        const tooLong = "あ".repeat(2000);

        fireEvent.click(screen.getByRole("button", { name: "1 手進む（→）" }));
        fireEvent.change(comment(), { target: { value: tooLong } });
        fireEvent.click(screen.getByRole("button", { name: "1 手進む（→）" }));

        // 捨てずに知らせる。保存はしていない。
        expect(screen.getByText(/1手目のコメントは長すぎるため、保存されていません/)).toBeTruthy();
        expect(onOps).not.toHaveBeenCalled();
        expect(onDraft).toHaveBeenLastCalledWith(ids[1], {
            type: "set",
            text: tooLong,
            base: "",
        });
        expect(comment().value).toBe("");
        // 棋譜のその手に印が付く。
        expect(
            within(moveList()).getByRole("img", { name: "コメントが長すぎて保存されていません" }),
        ).toBeTruthy();

        // その手へ戻ると、入力が残っている。短くすると保存され、印が消える。
        fireEvent.click(screen.getByRole("button", { name: "1 手戻る（←）" }));
        expect(comment().value).toBe(tooLong);
        fireEvent.change(comment(), { target: { value: "短くした" } });
        fireEvent.blur(comment());
        expect(onOps).toHaveBeenCalledWith([
            { type: "setComment", nodeId: ids[1], value: "短くした" },
        ]);
        expect(
            within(moveList()).queryByRole("img", { name: "コメントが長すぎて保存されていません" }),
        ).toBeNull();
    });

    it("注目局面は手数順が既定で、大きい順に切り替えられる", () => {
        // 1 手目が疑問手、3 手目が悪手（落差は 3 手目の方が大きい）。
        const { doc } = createTestStudy([cp(400), cp(0), cp(0), cp(-900), cp(-880)]);
        render(<Harness initialDoc={doc} />);

        const titles = () =>
            within(highlights())
                .getAllByRole("listitem")
                .map((item) => item.textContent ?? "");
        expect(titles()[0]).toContain("1手目");
        expect(titles()[1]).toContain("3手目");

        fireEvent.click(within(highlights()).getByRole("button", { name: "大きい順" }));
        expect(titles()[0]).toContain("3手目");
        expect(titles()[1]).toContain("1手目");
    });

    it("局面を移っても、ページ全体をスクロールさせない", () => {
        const scrollIntoView = vi.fn();
        Element.prototype.scrollIntoView = scrollIntoView;
        render(<Harness initialDoc={createTestStudy().doc} />);

        fireEvent.keyDown(document, { key: "ArrowRight" });
        fireEvent.keyDown(document, { key: "End" });

        expect(currentMove()).toContain("☖8四歩(83)");
        expect(scrollIntoView).not.toHaveBeenCalled();
    });

    it("変化の中の枝分かれは、どの枝も「変化」として個別に消せる（本譜とは呼ばない）", async () => {
        const { doc, ids } = createTestStudy();
        // 開始局面からの変化 ☗5六歩 の先で、☖3四歩 と ☖8四歩 に枝分かれする。
        const head = studyChildNodeId(ids[0], "5g5f");
        const first = studyChildNodeId(head, "3c3d");
        const second = studyChildNodeId(head, "8c8d");
        const nested = applyStudyOps(doc, [
            { type: "addMoves", parentId: ids[0], moves: ["5g5f", "3c3d", "2g2f"] },
            { type: "addMoves", parentId: head, moves: ["8c8d"] },
        ]);
        const onOps = vi.fn();
        render(<Harness initialDoc={nested} onOps={onOps} />);

        // 変化の中の 2 つ目の枝（☖8四歩）を見る。
        fireEvent.click(
            within(moveList()).getByRole("button", { name: /変化\s*☗5六歩\(57\)\s*3 手/ }),
        );
        fireEvent.keyDown(document, { key: "ArrowRight" });
        expect(currentMove()).toContain("☖3四歩(33)");
        // もう一方の枝は「変化」と表示され、消せる（「本譜」とは出ない）。
        const sibling = within(moveList()).getByRole("button", {
            name: /変化\s*☖8四歩\(83\)\s*1 手/,
        });
        expect(sibling.textContent).not.toContain("本譜");
        expect(
            within(moveList()).getByRole("button", { name: "変化 ☖8四歩(83) を削除" }),
        ).toBeTruthy();

        // ヘッダーのごみ箱は、いま見ている枝（直近の分岐点から先）だけを対象にする。
        fireEvent.click(within(moveList()).getByRole("button", { name: "いま見ている変化を削除" }));
        const dialog = await screen.findByRole("alertdialog");
        expect(dialog.textContent).toContain("2手目 ☖3四歩(33) から先の 2 手");
        fireEvent.click(within(dialog).getByRole("button", { name: "削除する" }));

        expect(onOps).toHaveBeenCalledWith([{ type: "deleteSubtree", nodeId: first }]);
        // 変化の残り（☗5六歩 → ☖8四歩）は消えない。
        await waitFor(() => expect(currentMove()).toContain("☗5六歩(57)"));
        fireEvent.keyDown(document, { key: "ArrowRight" });
        expect(currentMove()).toContain("☖8四歩(83)");
        expect(second).not.toBe(first);
    });

    it("上限などで手を足せないときの通知は、次の操作で消えずに残る", async () => {
        const { doc } = createTestStudy();
        render(
            <Harness initialDoc={doc} fetchLegalMoves={async () => ["7g7f", "5g5f"]} rejectOps />,
        );

        fireEvent.click(screen.getByRole("button", { name: /^5g 先手の歩/ }));
        await act(async () => {
            fireEvent.click(screen.getByRole("button", { name: /^5f 空マス/ }));
        });

        // 呼び出し側が拒否して文書を変えなかった → 元の局面に戻り、理由が出ている。
        await waitFor(() => expect(currentMove()).toContain("開始局面"));
        expect(screen.getByRole("alert").textContent).toContain("局面の数が上限に達しました");
        // 続けて別の操作をしても、通知は残る。
        fireEvent.keyDown(document, { key: "ArrowRight" });
        expect(screen.getByRole("alert").textContent).toContain("局面の数が上限に達しました");
    });

    it("打った分をすぐ消して保存済みに戻したら、途中の書きかけを残さない", () => {
        const { doc, ids } = createTestStudy();
        const onDraft = vi.fn();
        render(<Harness initialDoc={doc} onOps={vi.fn()} onCommentDraftChange={onDraft} />);
        const comment = () => screen.getByRole("textbox", { name: "コメント" });
        // 「けす」→「け」→「」（保存済みと同じ）と、自動保存の前に打って消す。
        fireEvent.change(comment(), { target: { value: "けす" } });
        fireEvent.change(comment(), { target: { value: "け" } });
        expect(onDraft).toHaveBeenLastCalledWith(ids[0], { type: "set", text: "け", base: "" });
        fireEvent.change(comment(), { target: { value: "" } });
        // 途中で置いた「け」は内容が違うので、内容に関わらず消す通知でないと残ってしまう。
        expect(onDraft).toHaveBeenLastCalledWith(ids[0], { type: "clear", savedText: null });
    });

    describe("ログインが切れて編集できないとき", () => {
        it("画面を残して操作を止め、ログインし直す案内を出す。書きかけのコメントは保存せずに残す", async () => {
            const { doc, ids } = createTestStudy();
            const onOps = vi.fn();
            const onLogin = vi.fn();
            const onDraft = vi.fn();
            const view = render(
                <Harness initialDoc={doc} onOps={onOps} onCommentDraftChange={onDraft} />,
            );
            const comment = () => screen.getByRole("textbox", { name: "コメント" });
            fireEvent.change(comment(), { target: { value: "書きかけ" } });
            expect(onDraft).toHaveBeenLastCalledWith(ids[0], {
                type: "set",
                text: "書きかけ",
                base: "",
            });

            // 自動保存の前にログインが切れた。
            view.rerender(
                <Harness
                    initialDoc={doc}
                    onOps={onOps}
                    onLogin={onLogin}
                    onCommentDraftChange={onDraft}
                    locked
                />,
            );
            fireEvent.blur(comment());
            await act(async () => {
                await new Promise((resolve) => setTimeout(resolve, 800));
            });

            expect(onOps).not.toHaveBeenCalled();
            expect((comment() as HTMLTextAreaElement).value).toBe("書きかけ");
            const alert = screen.getByRole("alert");
            expect(alert.textContent).toContain("ログインし直すと、続きから編集できます");
            fireEvent.click(within(alert).getByRole("button", { name: "ログインし直す" }));
            expect(onLogin).toHaveBeenCalledTimes(1);
            // 盤や棋譜は残っているが、操作できない。
            expect(moveList().closest("[inert]")).toBeTruthy();

            // 編集できるようになったら、残っていた入力を保存する。
            view.rerender(
                <Harness initialDoc={doc} onOps={onOps} onCommentDraftChange={onDraft} />,
            );
            await waitFor(
                () =>
                    expect(onOps).toHaveBeenCalledWith([
                        { type: "setComment", nodeId: ids[0], value: "書きかけ" },
                    ]),
                { timeout: 2000 },
            );
            await waitFor(() =>
                expect(onDraft).toHaveBeenLastCalledWith(ids[0], {
                    type: "clear",
                    savedText: "書きかけ",
                }),
            );
        });

        it("編集と解析のすべての入口を止め、開いていた設定も閉じる", () => {
            const { doc } = createTestStudy([cp(0), cp(10), cp(20), null, null]);
            const onOps = vi.fn();
            const onRetrySave = vi.fn();
            const analysis = createAnalysis();
            const props = {
                initialDoc: doc,
                onOps,
                analysis,
                onRetrySave,
                onLogin: vi.fn(),
                saveStatus: {
                    state: "limit_exceeded",
                    reason: null,
                    limit: "nodesPerStudy",
                    retrying: false,
                } as StudyWorkspaceSaveStatus,
            };
            const view = render(<Harness {...props} />);
            expect(screen.getByRole("button", { name: "もう一度保存する" })).toBeTruthy();
            // 設定を開いた状態で、ログインが切れる。
            fireEvent.click(screen.getByRole("button", { name: /解析の設定/ }));
            expect(screen.getByRole("dialog", { name: "解析の設定" })).toBeTruthy();

            view.rerender(<Harness {...props} locked />);

            // 開いていた設定は閉じ、設定のボタンも押せない。
            expect(screen.queryByRole("dialog", { name: "解析の設定" })).toBeNull();
            const settingsButton = screen.getByRole("button", { name: /解析の設定/ });
            expect((settingsButton as HTMLButtonElement).disabled).toBe(true);
            fireEvent.click(settingsButton);
            expect(screen.queryByRole("dialog", { name: "解析の設定" })).toBeNull();
            // 表題は編集できない。
            const title = screen.getByRole("textbox", { name: "研究ノートの表題" });
            expect((title as HTMLInputElement).readOnly).toBe(true);
            fireEvent.change(title, { target: { value: "書き換え" } });
            fireEvent.blur(title);
            // 再送の操作も出さない。
            expect(screen.queryByRole("button", { name: "もう一度保存する" })).toBeNull();
            // 深く解析・残りを解析・しおり・コメントは、操作できない領域（inert）の中にある。
            for (const name of ["この局面を深く解析", "残りを解析", "この手にしおりを付ける"]) {
                expect(screen.getByRole("button", { name }).closest("[inert]")).toBeTruthy();
            }
            expect(
                screen.getByRole("textbox", { name: "コメント" }).closest("[inert]"),
            ).toBeTruthy();
            // キーボードでも動かない。
            const before = currentMove();
            fireEvent.keyDown(window, { key: "ArrowRight" });
            expect(currentMove()).toBe(before);

            expect(onOps).not.toHaveBeenCalled();
            expect(analysis.startFull).not.toHaveBeenCalled();
            expect(analysis.resumeLayer).not.toHaveBeenCalled();
            expect(analysis.startDeep).not.toHaveBeenCalled();
            // 残すのは「ログインし直す」の案内。
            expect(screen.getByRole("button", { name: "ログインし直す" })).toBeTruthy();
        });

        it("前回の下書きを、その手のコメント欄に戻して保存する", async () => {
            const { doc, ids } = createTestStudy();
            const onOps = vi.fn();
            const onDraft = vi.fn();
            render(
                <Harness
                    initialDoc={doc}
                    onOps={onOps}
                    onCommentDraftChange={onDraft}
                    initialCommentDrafts={[{ nodeId: ids[0], text: "戻ってきた下書き", base: "" }]}
                />,
            );

            expect(
                (screen.getByRole("textbox", { name: "コメント" }) as HTMLTextAreaElement).value,
            ).toBe("戻ってきた下書き");
            await waitFor(
                () =>
                    expect(onOps).toHaveBeenCalledWith([
                        { type: "setComment", nodeId: ids[0], value: "戻ってきた下書き" },
                    ]),
                { timeout: 2000 },
            );
            await waitFor(() =>
                expect(onDraft).toHaveBeenLastCalledWith(ids[0], {
                    type: "clear",
                    savedText: "戻ってきた下書き",
                }),
            );
        });

        it("保存できなかったコメントは、保存済み扱いにせず下書きとして残す", async () => {
            const { doc, ids } = createTestStudy();
            const onDraft = vi.fn();
            render(<Harness initialDoc={doc} onCommentDraftChange={onDraft} rejectOps />);

            const comment = screen.getByRole("textbox", { name: "コメント" });
            fireEvent.change(comment, { target: { value: "保存できない" } });
            fireEvent.blur(comment);

            await waitFor(() =>
                expect(onDraft).toHaveBeenLastCalledWith(ids[0], {
                    type: "set",
                    text: "保存できない",
                    base: "",
                }),
            );
            expect((comment as HTMLTextAreaElement).value).toBe("保存できない");
        });
    });

    describe("コメントの下書きと、あとから届く保存の結果・他の端末の変更", () => {
        const comment = () =>
            screen.getByRole("textbox", { name: "コメント" }) as HTMLTextAreaElement;
        const next = () => fireEvent.click(screen.getByRole("button", { name: "1 手進む（→）" }));
        const back = () => fireEvent.click(screen.getByRole("button", { name: "1 手戻る（←）" }));
        const wait = (ms: number) =>
            act(async () => {
                await new Promise((resolve) => setTimeout(resolve, ms));
            });

        /** 入力 A を残して別の手へ移り（保存は応答待ち）、戻って B を入力した状態を作る。 */
        const setUpStaleSave = () => {
            const { doc, ids } = createTestStudy();
            const pending: Array<(saved: boolean) => void> = [];
            const drafts = new Map<string, string>();
            // 呼び出し側（ページ）と同じ規則で下書きを持つ。
            const onDraft = vi.fn((nodeId: string, change: StudyCommentDraftChange) => {
                if (change.type === "set") drafts.set(nodeId, change.text);
                else if (change.savedText === null || drafts.get(nodeId) === change.savedText) {
                    drafts.delete(nodeId);
                }
            });
            render(
                <Harness
                    initialDoc={doc}
                    onCommentDraftChange={onDraft}
                    interceptOps={(ops) =>
                        ops.some((op) => op.type === "setComment")
                            ? new Promise<boolean>((resolve) => pending.push(resolve))
                            : undefined
                    }
                />,
            );
            next();
            fireEvent.change(comment(), { target: { value: "入力 A" } });
            // 別の手へ移る（前のコメント欄が A を保存し始める。応答はまだ）。
            next();
            expect(pending).toHaveLength(1);
            // 応答の前に同じ手へ戻り、B を入力する。
            back();
            expect(comment().value).toBe("入力 A");
            fireEvent.change(comment(), { target: { value: "入力 B" } });
            return { ids, pending, drafts };
        };

        it("前のコメント欄の保存が成功で終わっても、そのあとに書いた下書きを消さない", async () => {
            const { ids, pending, drafts } = setUpStaleSave();

            await act(async () => {
                pending[0](true);
            });

            expect(comment().value).toBe("入力 B");
            expect(drafts.get(ids[1])).toBe("入力 B");
            // 画面が持っている下書きも B のまま（移って戻ると B が戻る）。
            next();
            back();
            expect(comment().value).toBe("入力 B");
        });

        it("前のコメント欄の保存が失敗で終わっても、そのあとに書いた下書きを古い内容で上書きしない", async () => {
            const { ids, pending, drafts } = setUpStaleSave();

            await act(async () => {
                pending[0](false);
            });

            expect(comment().value).toBe("入力 B");
            expect(drafts.get(ids[1])).toBe("入力 B");
            next();
            back();
            expect(comment().value).toBe("入力 B");
        });

        it("保存済みと同じ下書きは消すだけにし、あとから取り込んだコメントを上書きしない", async () => {
            const { doc, ids } = createTestStudy();
            const saved = applyStudyOps(doc, [
                { type: "setComment", nodeId: ids[0], value: "コメント A" },
            ]);
            const onOps = vi.fn();
            const onDraft = vi.fn();
            let external: (ops: StudyOp[]) => void = () => {};
            render(
                <Harness
                    initialDoc={saved}
                    onOps={onOps}
                    onCommentDraftChange={onDraft}
                    initialCommentDrafts={[{ nodeId: ids[0], text: "コメント A", base: "" }]}
                    onExternal={(apply) => {
                        external = apply;
                    }}
                />,
            );

            // 下書きは保存済みと同じなので、保存し直さずに消す。
            expect(onDraft).toHaveBeenLastCalledWith(ids[0], {
                type: "clear",
                savedText: "コメント A",
            });
            // 他のタブでコメントが B になった。
            act(() => external([{ type: "setComment", nodeId: ids[0], value: "コメント B" }]));
            expect(comment().value).toBe("コメント B");
            await wait(900);

            // 古い下書き A で B を上書きしていない。
            expect(onOps).not.toHaveBeenCalled();
            expect(comment().value).toBe("コメント B");
            expect(
                onDraft.mock.calls.some(
                    ([, change]) => (change as { type: string }).type === "set",
                ),
            ).toBe(false);
        });

        const prompt = () => screen.getByRole("group", { name: "書きかけの扱い" });
        const queryPrompt = () => screen.queryByRole("group", { name: "書きかけの扱い" });
        const unsavedMark = () =>
            within(moveList()).queryByRole("img", {
                name: "コメントの書きかけがあります（保存されていません）",
            });

        it("書き始めたあとにコメントが変わっていた書きかけは、自動では保存せず、利用者に選ばせる", async () => {
            const { doc, ids } = createTestStudy();
            // 書きかけ A は、コメントが空のときに書き始めた。そのあと B が保存されている。
            const saved = applyStudyOps(doc, [
                { type: "setComment", nodeId: ids[0], value: "コメント B" },
            ]);
            const onOps = vi.fn();
            const onDraft = vi.fn();
            render(
                <Harness
                    initialDoc={saved}
                    onOps={onOps}
                    onCommentDraftChange={onDraft}
                    initialCommentDrafts={[{ nodeId: ids[0], text: "書きかけ A", base: "" }]}
                />,
            );

            // 書きかけは入力欄に残り、保存されているコメントは帯で読める。
            expect(prompt().textContent).toContain("以前の書きかけがあります");
            expect(prompt().textContent).toContain("コメント B");
            expect(comment().value).toBe("書きかけ A");
            // 棋譜のその手に印が付く。
            expect(unsavedMark()).toBeTruthy();
            await wait(900);
            fireEvent.blur(comment());
            // 何もしなければ、保存もしないし、書きかけも消さない。
            expect(onOps).not.toHaveBeenCalled();
            expect(
                onDraft.mock.calls.some(
                    ([, change]) => (change as { type: string }).type === "clear",
                ),
            ).toBe(false);

            fireEvent.click(within(prompt()).getByRole("button", { name: "書きかけを使う" }));
            expect(queryPrompt()).toBeNull();
            expect(unsavedMark()).toBeNull();
            expect(onOps).toHaveBeenCalledWith([
                { type: "setComment", nodeId: ids[0], value: "書きかけ A" },
            ]);
        });

        it("書きかけを捨てると、保存済みのコメントに戻り、書きかけだけが消える", () => {
            const { doc, ids } = createTestStudy();
            const saved = applyStudyOps(doc, [
                { type: "setComment", nodeId: ids[0], value: "コメント B" },
            ]);
            const onOps = vi.fn();
            const onDraft = vi.fn();
            render(
                <Harness
                    initialDoc={saved}
                    onOps={onOps}
                    onCommentDraftChange={onDraft}
                    // 書き始めたときのコメントが分からない書きかけ（以前の形）も、選んでもらう。
                    initialCommentDrafts={[{ nodeId: ids[0], text: "書きかけ A" }]}
                />,
            );

            fireEvent.click(within(prompt()).getByRole("button", { name: "捨てる" }));

            expect(comment().value).toBe("コメント B");
            expect(queryPrompt()).toBeNull();
            expect(onDraft).toHaveBeenLastCalledWith(ids[0], { type: "clear", savedText: null });
            expect(onOps).not.toHaveBeenCalled();
        });

        /** 開始局面のコメント欄と、別の画面からの変更を入れる口を用意する。 */
        const setUpTwoScreens = () => {
            const { doc, ids } = createTestStudy();
            const onOps = vi.fn();
            const onDraft = vi.fn();
            let external: (ops: StudyOp[]) => void = () => {};
            render(
                <Harness
                    initialDoc={doc}
                    onOps={onOps}
                    onCommentDraftChange={onDraft}
                    onExternal={(apply) => {
                        external = apply;
                    }}
                />,
            );
            const saveElsewhere = (value: string) =>
                act(() => external([{ type: "setComment", nodeId: ids[0], value }]));
            const cleared = () =>
                onDraft.mock.calls.some(
                    ([, change]) => (change as { type: string }).type === "clear",
                );
            return { ids, onOps, onDraft, saveElsewhere, cleared };
        };

        it("入力中でない書きかけ（長すぎて保存できていない）がある手を別の画面が保存しても、書きかけも印も消さず、選ばせる", async () => {
            const { onOps, saveElsewhere, cleared } = setUpTwoScreens();
            const tooLong = "あ".repeat(1400);
            fireEvent.change(comment(), { target: { value: tooLong } });
            fireEvent.blur(comment());
            onOps.mockClear();

            saveElsewhere("別の画面のコメント");

            // 書きかけは入力欄に残り、別の画面のコメントは帯で読める。どちらも消えない。
            expect(comment().value).toBe(tooLong);
            expect(prompt().textContent).toContain("このコメントは別の画面で変更されました");
            expect(prompt().textContent).toContain("別の画面のコメント");
            expect(cleared()).toBe(false);
            expect(unsavedMark()).toBeTruthy();
            await wait(900);
            expect(onOps).not.toHaveBeenCalled();
            // 長すぎる間は「書きかけを使う」を押せない（短くすれば押せる）。
            const use = within(prompt()).getByRole("button", { name: "書きかけを使う" });
            expect((use as HTMLButtonElement).disabled).toBe(true);

            fireEvent.click(within(prompt()).getByRole("button", { name: "捨てる" }));
            expect(comment().value).toBe("別の画面のコメント");
            expect(unsavedMark()).toBeNull();
            expect(onOps).not.toHaveBeenCalled();
        });

        it("入力中に別の画面が同じ手を保存したら、入力を妨げず、次の自動保存の前に選ばせる（黙って上書きしない）", async () => {
            const { ids, onOps, saveElsewhere } = setUpTwoScreens();
            fireEvent.focus(comment());
            fireEvent.change(comment(), { target: { value: "入力中" } });

            // 自動保存（700 ms）より前に、別の画面の保存が届く。
            saveElsewhere("別の画面のコメント");
            expect(comment().value).toBe("入力中");
            expect(prompt().textContent).toContain("別の画面のコメント");

            // 打鍵は続けられる。選ぶまで、自動保存もフォーカスを外したときの保存もしない。
            fireEvent.change(comment(), { target: { value: "入力中の続き" } });
            expect(comment().value).toBe("入力中の続き");
            await wait(900);
            fireEvent.blur(comment());
            expect(onOps).not.toHaveBeenCalled();
            expect(queryPrompt()).toBeTruthy();

            fireEvent.click(within(prompt()).getByRole("button", { name: "書きかけを使う" }));
            expect(onOps).toHaveBeenCalledWith([
                { type: "setComment", nodeId: ids[0], value: "入力中の続き" },
            ]);
            expect(queryPrompt()).toBeNull();
        });

        it("自動保存のあとに別の画面の保存が届いた場合は、書きかけが無いので、そのまま取り込む", async () => {
            const { ids, onOps, saveElsewhere } = setUpTwoScreens();
            fireEvent.focus(comment());
            fireEvent.change(comment(), { target: { value: "入力" } });
            await wait(900);
            expect(onOps).toHaveBeenCalledWith([
                { type: "setComment", nodeId: ids[0], value: "入力" },
            ]);

            saveElsewhere("別の画面のコメント");

            expect(comment().value).toBe("別の画面のコメント");
            expect(queryPrompt()).toBeNull();
        });

        it("書きかけと同じ内容を別の画面が保存したら、書きかけを消すだけで、帯は出さない", () => {
            const { ids, onOps, onDraft, saveElsewhere } = setUpTwoScreens();
            fireEvent.focus(comment());
            fireEvent.change(comment(), { target: { value: "同じ内容" } });

            saveElsewhere("同じ内容");

            expect(comment().value).toBe("同じ内容");
            expect(queryPrompt()).toBeNull();
            expect(onDraft).toHaveBeenLastCalledWith(ids[0], {
                type: "clear",
                savedText: "同じ内容",
            });
            fireEvent.blur(comment());
            expect(onOps).not.toHaveBeenCalled();
        });

        it("選択待ちの手から離れても、棋譜の印は残り、戻ると帯がまた出る", () => {
            const { saveElsewhere } = setUpTwoScreens();
            fireEvent.focus(comment());
            fireEvent.change(comment(), { target: { value: "書きかけ" } });
            saveElsewhere("別の画面のコメント");
            expect(queryPrompt()).toBeTruthy();

            next();
            expect(queryPrompt()).toBeNull();
            expect(unsavedMark()).toBeTruthy();
            back();
            expect(comment().value).toBe("書きかけ");
            expect(prompt().textContent).toContain("別の画面のコメント");
        });
    });

    describe("開いた直後（サーバーの最新のコメントを取り込む前）の書きかけ", () => {
        const comment = () =>
            screen.getByRole("textbox", { name: "コメント" }) as HTMLTextAreaElement;
        const prompt = () => screen.getByRole("group", { name: "書きかけの扱い" });
        const queryPrompt = () => screen.queryByRole("group", { name: "書きかけの扱い" });
        const wait = (ms: number) =>
            act(async () => {
                await new Promise((resolve) => setTimeout(resolve, ms));
            });

        /**
         * このブラウザに残っているコメントは A。書きかけは「A のときに書き始めた B」。
         * 最新の内容はまだ取り込めていない。`locked` は、ログインが切れて編集を止めている状態。
         */
        const setUp = (options: { locked?: boolean } = {}) => {
            const { doc, ids } = createTestStudy();
            const cached = applyStudyOps(doc, [
                { type: "setComment", nodeId: ids[0], value: "コメント A" },
            ]);
            const onOps = vi.fn();
            const onDraft = vi.fn();
            let external: (ops: StudyOp[]) => void = () => {};
            const props: HarnessProps = {
                initialDoc: cached,
                onOps,
                onCommentDraftChange: onDraft,
                initialCommentDrafts: [{ nodeId: ids[0], text: "書きかけ B", base: "コメント A" }],
                onExternal: (apply) => {
                    external = apply;
                },
            };
            const view = render(
                <Harness {...props} commentBaseConfirmed={false} locked={options.locked} />,
            );
            return {
                ids,
                onOps,
                onDraft,
                applyExternal: (ops: StudyOp[]) => act(() => external(ops)),
                /** 編集できる状態で、最新の内容を取り込めた・まだ取り込めていない、を切り替える。 */
                rerender: (confirmed: boolean) =>
                    view.rerender(<Harness {...props} commentBaseConfirmed={confirmed} />),
            };
        };
        const cleared = (onDraft: ReturnType<typeof vi.fn>) =>
            onDraft.mock.calls.some(([, change]) => (change as { type: string }).type === "clear");

        it("取得が遅い場合: 取り込みが済むまで自動では保存せず、別の端末のコメント C を取り込んだら、上書きせず選ばせる", async () => {
            const { ids, onOps, onDraft, applyExternal, rerender } = setUp();

            // 書きかけは欄に戻るが、取り込みが済むまで保存しない（自動保存のタイマーが先に来る）。
            expect(comment().value).toBe("書きかけ B");
            expect(screen.getByText(/最新のコメントを確認しています/)).toBeTruthy();
            await wait(900);
            fireEvent.blur(comment());
            expect(onOps).not.toHaveBeenCalled();

            // 最新の内容（別の端末のコメント C）を取り込めた。
            applyExternal([{ type: "setComment", nodeId: ids[0], value: "コメント C" }]);
            rerender(true);

            // C を B で上書きしない。B も消さない。
            expect(comment().value).toBe("書きかけ B");
            expect(prompt().textContent).toContain("以前の書きかけがあります");
            expect(prompt().textContent).toContain("コメント C");
            expect(cleared(onDraft)).toBe(false);
            await wait(900);
            expect(onOps).not.toHaveBeenCalled();

            fireEvent.click(within(prompt()).getByRole("button", { name: "書きかけを使う" }));
            expect(onOps).toHaveBeenCalledWith([
                { type: "setComment", nodeId: ids[0], value: "書きかけ B" },
            ]);
        });

        it("取得がすぐ返る場合: 取り込みと「確かめられた」が自動保存より先に同時に届いても、書きかけを黙って捨てず、選ばせる", async () => {
            const { ids, onOps, onDraft, applyExternal, rerender } = setUp();

            await act(async () => {
                applyExternal([{ type: "setComment", nodeId: ids[0], value: "コメント C" }]);
                rerender(true);
            });

            expect(comment().value).toBe("書きかけ B");
            expect(prompt().textContent).toContain("コメント C");
            expect(cleared(onDraft)).toBe(false);
            await wait(900);
            expect(onOps).not.toHaveBeenCalled();

            fireEvent.click(within(prompt()).getByRole("button", { name: "捨てる" }));
            expect(comment().value).toBe("コメント C");
            expect(onDraft).toHaveBeenLastCalledWith(ids[0], { type: "clear", savedText: null });
            expect(onOps).not.toHaveBeenCalled();
        });

        it("ロックからの復帰（その場）: 復帰と取り込みがどの順で届いても、別の端末のコメントと書きかけの両方を残して選ばせる", async () => {
            // ログインが切れている間（編集を止めている）に、別の端末がコメント C を保存した。
            const { ids, onOps, onDraft, applyExternal, rerender } = setUp({ locked: true });
            expect(comment().value).toBe("書きかけ B");

            // 復帰した（まだ取り込めていない）。自動保存のタイマーが先に来ても、保存しない。
            rerender(false);
            await wait(900);
            expect(onOps).not.toHaveBeenCalled();

            applyExternal([{ type: "setComment", nodeId: ids[0], value: "コメント C" }]);
            rerender(true);

            expect(comment().value).toBe("書きかけ B");
            expect(prompt().textContent).toContain("コメント C");
            expect(cleared(onDraft)).toBe(false);
            await wait(900);
            expect(onOps).not.toHaveBeenCalled();
        });

        it("取り込みが済み、コメントが書き始めたときのままなら、これまでどおり自動で保存する", async () => {
            const { ids, onOps, rerender } = setUp();
            await wait(900);
            expect(onOps).not.toHaveBeenCalled();

            rerender(true);

            expect(comment().value).toBe("書きかけ B");
            expect(screen.queryByText(/最新のコメントを確認しています/)).toBeNull();
            expect(queryPrompt()).toBeNull();
            await waitFor(
                () =>
                    expect(onOps).toHaveBeenCalledWith([
                        { type: "setComment", nodeId: ids[0], value: "書きかけ B" },
                    ]),
                { timeout: 2000 },
            );
        });

        it("取り込めないままのときは保留し、利用者が「書きかけを使う」を選べば保存する", async () => {
            const { ids, onOps } = setUp();
            await wait(900);
            expect(onOps).not.toHaveBeenCalled();
            expect(comment().value).toBe("書きかけ B");

            fireEvent.click(screen.getByRole("button", { name: "書きかけを使う" }));

            expect(onOps).toHaveBeenCalledWith([
                { type: "setComment", nodeId: ids[0], value: "書きかけ B" },
            ]);
        });

        it("取り込みの前に書き始めた入力も、最初の保存の前に、書き始めたときのコメントとの照合を通す", async () => {
            const { doc, ids } = createTestStudy();
            const cached = applyStudyOps(doc, [
                { type: "setComment", nodeId: ids[0], value: "コメント A" },
            ]);
            const onOps = vi.fn();
            let external: (ops: StudyOp[]) => void = () => {};
            const props: HarnessProps = {
                initialDoc: cached,
                onOps,
                onExternal: (apply) => {
                    external = apply;
                },
            };
            const view = render(<Harness {...props} commentBaseConfirmed={false} />);
            fireEvent.change(comment(), { target: { value: "コメント A に書き足し" } });
            fireEvent.blur(comment());
            await wait(900);
            expect(onOps).not.toHaveBeenCalled();

            act(() => external([{ type: "setComment", nodeId: ids[0], value: "コメント C" }]));
            view.rerender(<Harness {...props} commentBaseConfirmed />);

            expect(comment().value).toBe("コメント A に書き足し");
            expect(prompt().textContent).toContain("このコメントは別の画面で変更されました");
            expect(prompt().textContent).toContain("コメント C");
            await wait(900);
            expect(onOps).not.toHaveBeenCalled();
        });
    });

    describe("保存の状態", () => {
        const renderWith = (
            saveStatus: StudyWorkspaceSaveStatus,
            extra: Partial<HarnessProps> = {},
        ) =>
            render(
                <Harness initialDoc={createTestStudy().doc} saveStatus={saveStatus} {...extra} />,
            );

        it("未ログインでは「ログインするとクラウドにも保存できます」を出し、押すとログインへ進む", () => {
            const onLogin = vi.fn();
            renderWith(LOCAL_STATUS, { onLogin });

            expect(screen.getByText("このブラウザに保存済み")).toBeTruthy();
            fireEvent.click(
                screen.getByRole("button", { name: "ログインするとクラウドにも保存できます" }),
            );
            expect(onLogin).toHaveBeenCalledTimes(1);
            // 問題ではないので、帯は出さない。
            expect(screen.queryByRole("alert")).toBeNull();
        });

        it("クラウドに保存済み・送信待ちは控えめに出す", () => {
            const view = renderWith({
                state: "synced",
                reason: null,
                limit: null,
                retrying: false,
            });
            expect(screen.getByText("クラウドに保存済み")).toBeTruthy();
            expect(screen.queryByText("ログインするとクラウドにも保存できます")).toBeNull();
            view.unmount();

            renderWith({ state: "pending", reason: null, limit: null, retrying: true });
            expect(screen.getByText("クラウドへ再送待ち")).toBeTruthy();
            expect(screen.queryByRole("alert")).toBeNull();
        });

        it("上限超過は帯で知らせ、もう一度保存できる", () => {
            const onRetrySave = vi.fn();
            renderWith(
                { state: "limit_exceeded", reason: null, limit: "nodesPerStudy", retrying: false },
                { onRetrySave },
            );

            expect(screen.getByText(/局面の数がクラウドの上限を超えたため/)).toBeTruthy();
            fireEvent.click(screen.getByRole("button", { name: "もう一度保存する" }));
            expect(onRetrySave).toHaveBeenCalledTimes(1);
        });

        it("保存に失敗したときは、黙って失わないよう警告する", () => {
            renderWith({ state: "error", reason: "storage_quota", limit: null, retrying: false });
            expect(screen.getByRole("alert").textContent).toContain(
                "ブラウザの保存容量が足りず、変更を保存できませんでした",
            );
        });

        it("他の端末で削除されたノートは、このブラウザからも消せる", () => {
            const onDiscard = vi.fn();
            renderWith(
                { state: "error", reason: "deleted_remotely", limit: null, retrying: false },
                { onDiscard },
            );

            expect(screen.getByRole("alert").textContent).toContain(
                "このノートは他の端末で削除されました",
            );
            fireEvent.click(screen.getByRole("button", { name: "このブラウザからも消す" }));
            expect(onDiscard).toHaveBeenCalledTimes(1);
        });
    });
});
