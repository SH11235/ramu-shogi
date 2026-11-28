import {
    applyStudyOps,
    createStudyDocumentFromMoves,
    type StudyAnalysisResult,
    type StudyDocument,
    type StudyOp,
    type StudyScore,
} from "@shogi/app-core";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { useEffect, useState } from "react";
import { fn, userEvent, within } from "storybook/test";
import { DEFAULT_ANALYSIS_SETTINGS, type Message } from "./shogi-match/types";
import { StudyWorkspaceView } from "./study-workspace";
import type { StudyWorkspaceSaveStatus } from "./study-workspace/StudySaveStatus";
import {
    cp,
    createTestStudy,
    putScoreOp,
    TEST_LAYER_SPEC,
} from "./study-workspace/study-test-support";
import { buildStudyViewTree, chooseStudyDisplayLayer } from "./study-workspace/studyView";
import type { StudyAnalysisController, StudyLiveSearch } from "./study-workspace/useStudyAnalysis";
import type { StudyMateController, StudyMateState } from "./study-workspace/useStudyMate";

// 研究ノートの画面を、解析・詰み探索の状態ごとに並べる。解析と詰み探索は模擬で、押しても動かない
// （押したことは Actions に出る）。

const SYNCED: StudyWorkspaceSaveStatus = {
    state: "synced",
    reason: null,
    limit: null,
    retrying: false,
};

const createAnalysis = (
    overrides: Partial<StudyAnalysisController> = {},
): StudyAnalysisController => ({
    mode: null,
    isPreparing: false,
    progress: null,
    completedRuns: 0,
    live: null,
    settingsLabel: "RAMU・1 秒",
    fullTargetCount: 5,
    startFull: fn(async () => {}),
    resumeLayer: fn(async () => {}),
    startDeep: fn(async () => {}),
    continuableDeepNodeId: null,
    continueDeep: fn(async () => {}),
    cancel: fn(async () => {}),
    form: {
        settings: DEFAULT_ANALYSIS_SETTINGS,
        onSettingsChange: fn(),
        nnueSelection: { presetKey: "ramu", nnueId: null },
        onNnueSelectionChange: fn(),
        presets: [],
        nnueList: [],
        isNnueListLoading: false,
        engines: [{ id: "wasm", label: "内蔵エンジン", kind: "internal" }],
        engineId: "wasm",
        maxParallel: null,
        maxThreads: 8,
        onEngineIdChange: fn(),
    },
    ...overrides,
});

const createMate = (overrides: Partial<StudyMateController> = {}): StudyMateController => ({
    supported: true,
    results: new Map(),
    shortestResults: new Map(),
    runningNodeId: null,
    runningKind: null,
    start: fn(),
    startShortest: fn(),
    stop: fn(),
    ...overrides,
});

/** 読んでいる途中の候補（最善手・評価値・深さ）。 */
const preview = (score: StudyScore, depth: number, pv: string[]): StudyAnalysisResult => ({
    runId: "preview",
    completion: "aborted",
    depth,
    nodes: 1_000_000,
    timeMs: 4_000,
    execution: { threads: null, hashMb: null, parallelWorkers: null },
    candidates: [{ rank: 1, score, depth, seldepth: null, pv }],
});

const live = (nodeId: string, options: Partial<StudyLiveSearch> = {}): StudyLiveSearch => ({
    nodeId,
    depth: 18,
    startedAt: Date.now() - 6_000,
    budgetMs: 30_000,
    preview: null,
    ...options,
});

const unanalyzed = createTestStudy();
/** 全体の解析を済ませたノート（各局面に、その局面で指せる手の読み筋を付ける）。 */
const analyzed = (() => {
    const base = createTestStudy();
    const scores = [cp(30), cp(45), cp(20), cp(80), cp(-150)];
    const pvs = [["2g2f"], ["3c3d"], ["2g2f"], ["8c8d"], ["2f2e"]];
    const ops: StudyOp[] = [
        { type: "ensureLayer", spec: TEST_LAYER_SPEC, display: { label: "RAMU・1 秒" } },
        ...base.ids.map((id, index) => putScoreOp(id, scores[index], { pv: pvs[index] })),
    ];
    return { doc: applyStudyOps(base.doc, ops), ids: base.ids };
})();

interface StoryHarnessProps {
    doc: StudyDocument;
    analysis?: StudyAnalysisController;
    /** 渡すと、描いた直後に解析の状態をこれに替える（終わったときの知らせなど、移り変わりで出る表示）。 */
    nextAnalysis?: StudyAnalysisController;
    mate?: StudyMateController;
    nextMate?: StudyMateController;
    message?: Message | null;
    saveStatus?: StudyWorkspaceSaveStatus;
    locked?: boolean;
    readOnly?: boolean;
    /** 最初に開く局面（本譜の手数）。 */
    initialPly?: number;
}

function StoryHarness({
    doc: initialDoc,
    analysis = createAnalysis(),
    nextAnalysis,
    mate = createMate(),
    nextMate,
    message: initialMessage = null,
    saveStatus = SYNCED,
    locked,
    readOnly,
    initialPly = 0,
}: StoryHarnessProps) {
    const [doc, setDoc] = useState(initialDoc);
    const [message, setMessage] = useState<Message | null>(initialMessage);
    const [preferredLayerId, setPreferredLayerId] = useState<string | null>(null);
    const [currentAnalysis, setCurrentAnalysis] = useState(analysis);
    const [currentMate, setCurrentMate] = useState(mate);
    useEffect(() => {
        const timer = setTimeout(() => {
            if (nextAnalysis) setCurrentAnalysis(nextAnalysis);
            if (nextMate) setCurrentMate(nextMate);
        }, 300);
        return () => clearTimeout(timer);
    }, [nextAnalysis, nextMate]);
    const displayLayerId = chooseStudyDisplayLayer(doc.layers, preferredLayerId);
    const { tree } = buildStudyViewTree(doc, displayLayerId);
    const initialNodeId = ((): string | undefined => {
        let id = tree.rootId;
        for (let ply = 0; ply < initialPly; ply++) {
            const next = tree.nodes.get(id)?.children[0];
            if (!next) break;
            id = next;
        }
        return id;
    })();
    return (
        <div className="h-dvh">
            <StudyWorkspaceView
                doc={doc}
                tree={tree}
                initialNodeId={initialNodeId}
                onApplyOps={(ops) => {
                    setDoc((previous) => applyStudyOps(previous, ops));
                    return undefined;
                }}
                saveStatus={saveStatus}
                locked={locked}
                readOnly={readOnly}
                displayLayerId={displayLayerId}
                onDisplayLayerChange={setPreferredLayerId}
                analysis={currentAnalysis}
                mate={currentMate}
                message={message}
                onMessageChange={setMessage}
                onPlayFromPosition={() => {}}
                onSaveKifuFile={() => {}}
                shareDialog={{ open: false, onOpen: () => {} }}
                newNote={{ onCreateFromNote: async () => {}, onImport: async () => {} }}
            />
        </div>
    );
}

/** 自動で読むのスイッチ（端末に保存される）を、story ごとに決める。 */
const withAutoAnalyze = (enabled: boolean) => (): void => {
    localStorage.setItem("shogi:studyAutoAnalyze", JSON.stringify(enabled));
};

const meta = {
    title: "研究ノート/画面の状態",
    component: StoryHarness,
    beforeEach: withAutoAnalyze(false),
} satisfies Meta<typeof StoryHarness>;

export default meta;
type Story = StoryObj<typeof meta>;

const ids = unanalyzed.ids;
const analyzedIds = analyzed.ids;

export const 未解析: Story = {
    args: { doc: unanalyzed.doc },
};

export const 解析結果あり: Story = {
    args: { doc: analyzed.doc, initialPly: 3 },
};

export const 全体の解析中: Story = {
    args: {
        doc: unanalyzed.doc,
        analysis: createAnalysis({ mode: "full", progress: { completed: 2, total: 5 } }),
    },
};

export const 全体の解析が終わった: Story = {
    args: {
        doc: analyzed.doc,
        analysis: createAnalysis({ mode: "full", progress: { completed: 4, total: 5 } }),
        nextAnalysis: createAnalysis({ completedRuns: 1 }),
    },
};

export const 自動で読む_読み始め: Story = {
    beforeEach: withAutoAnalyze(true),
    args: {
        doc: unanalyzed.doc,
        analysis: createAnalysis({ mode: "deep", live: live(ids[0], { depth: null }) }),
    },
};

export const 自動で読む_読んでいる: Story = {
    beforeEach: withAutoAnalyze(true),
    args: {
        doc: unanalyzed.doc,
        initialPly: 2,
        analysis: createAnalysis({
            mode: "deep",
            live: live(ids[2], { preview: preview(cp(120), 22, ["2g2f", "8c8d", "2f2e"]) }),
        }),
    },
};

export const 自動で読む_記録より浅い読み直し: Story = {
    beforeEach: withAutoAnalyze(true),
    args: {
        doc: analyzed.doc,
        analysis: createAnalysis({
            mode: "deep",
            live: live(analyzedIds[0], { preview: preview(cp(12), 8, ["2g2f", "8c8d"]) }),
        }),
    },
};

export const 自動で読む_読み終えた: Story = {
    beforeEach: withAutoAnalyze(true),
    args: {
        doc: analyzed.doc,
        analysis: createAnalysis({ mode: "deep", live: live(analyzedIds[0]) }),
        nextAnalysis: createAnalysis(),
    },
};

export const 自動で読む_準備中: Story = {
    beforeEach: withAutoAnalyze(true),
    args: { doc: unanalyzed.doc, analysis: createAnalysis({ isPreparing: true }) },
};

export const 自動で読むを切って全体を解析: Story = {
    args: {
        doc: unanalyzed.doc,
        analysis: createAnalysis({ mode: "full", progress: { completed: 0, total: 5 } }),
        message: { text: "自動で読むを切りました（読んだ分は残っています）。", type: "warning" },
    },
};

export const 別の局面を深く解析中: Story = {
    args: {
        doc: analyzed.doc,
        analysis: createAnalysis({ mode: "deep", live: live(analyzedIds[3]) }),
    },
};

export const 別の局面の深く解析が終わった: Story = {
    args: {
        doc: analyzed.doc,
        analysis: createAnalysis({ mode: "deep", live: live(analyzedIds[3]) }),
        nextAnalysis: createAnalysis(),
    },
};

const mateRunning: StudyMateState = {
    status: "running",
    phase: "mate",
    nodes: 120_000,
    elapsedMs: 4_200,
};

export const 別の局面で詰みを調べている: Story = {
    args: {
        doc: analyzed.doc,
        mate: createMate({
            runningNodeId: analyzedIds[3],
            results: new Map([[analyzedIds[3], mateRunning]]),
        }),
    },
};

/** 後手番で、先手に金を打たれると詰む局面（☗5二金打までの詰めろ）。 */
const threatened = createStudyDocumentFromMoves({
    id: "22222222-2222-4222-8222-222222222222",
    title: "詰めろの見本",
    origin: { kind: "paste", ref: null },
    startSfen: "4k4/9/4G4/9/9/9/9/9/4K4 w G 1",
    moves: [],
    meta: { blackName: "先手", whiteName: "後手" },
});

export const 詰めろの結果: Story = {
    args: {
        doc: threatened,
        mate: createMate({
            results: new Map<string, StudyMateState>([
                [
                    threatened.tree.rootId,
                    {
                        status: "done",
                        mate: { kind: "noMate" },
                        mateMs: 500,
                        threat: { kind: "mate", pv: ["G*5b"] },
                        threatMs: 500,
                    },
                ],
            ]),
        }),
    },
};

export const 解析エンジンが変わって止めた: Story = {
    args: {
        doc: analyzed.doc,
        message: { text: "解析エンジンが変わったため、解析を止めました。", type: "error" },
    },
};

export const 解析に失敗した局面がある: Story = {
    args: {
        doc: analyzed.doc,
        message: {
            text: "解析に失敗した局面があります。ページを読み込み直してから、もう一度お試しください。",
            type: "error",
        },
    },
};

export const 残りを解析で簡易AIに切り替えた: Story = {
    args: {
        doc: analyzed.doc,
        message: {
            text: "簡易 AI に切り替えました。「RAMU・1 秒」の続きは同じ AI でないと解析できないため、解析は始めていません。",
            type: "warning",
        },
    },
};

export const 編集できない: Story = {
    args: { doc: analyzed.doc, locked: true },
};

export const 保存を待っている: Story = {
    args: {
        doc: analyzed.doc,
        saveStatus: { state: "pending", reason: null, limit: null, retrying: false },
    },
};

/** パスを含む手順（CSA にできないので、形式の切り替えで CSA を選べない）。 */
export const CSAにできない手順: Story = {
    args: {
        doc: createStudyDocumentFromMoves({
            id: "77777777-7777-4777-8777-777777777777",
            title: "パス権の研究",
            origin: { kind: "paste", ref: null },
            startSfen: "startpos",
            moves: ["7g7f", "pass", "2g2f"],
            meta: {},
        }),
        initialPly: 2,
    },
};

export const 閲覧のみ: Story = {
    args: { doc: analyzed.doc, readOnly: true, initialPly: 3 },
};

/** 対局情報のあるノート（畳んだ「対局情報」は出典と同じ行に置き、盤の高さを変えない）。 */
export const 対局情報つき: Story = {
    args: {
        doc: {
            ...analyzed.doc,
            meta: { ...analyzed.doc.meta, event: "テスト棋戦", timeControl: "10分" },
        },
        initialPly: 3,
    },
};

/** 本譜 4 手に、1 手目から分かれる変化と、3 手目のあとで分かれる変化を足したノート。 */
const withVariations = applyStudyOps(analyzed.doc, [
    { type: "addMoves", parentId: analyzedIds[1], moves: ["8c8d", "2g2f"] },
    { type: "addMoves", parentId: analyzedIds[3], moves: ["4c4d"] },
]);

// モーダルとメニューは body に描かれるので、中の操作は文書全体から探す。
const inDialog = () => within(document.body);
/** PC は表題の行の「新しいノート」、スマートフォンは「メニュー」の中の「新しいノート」から開く。 */
const openNewNote = async ({ canvasElement }: { canvasElement: HTMLElement }) => {
    const canvas = within(canvasElement);
    const header = canvas.queryByRole("button", { name: "新しいノート" });
    if (header) {
        await userEvent.click(header);
        return;
    }
    await userEvent.click(canvas.getByRole("button", { name: "メニュー" }));
    await userEvent.click(await inDialog().findByRole("button", { name: "新しいノート" }));
};

export const 新しいノート_いまのノートから: Story = {
    args: { doc: withVariations, initialPly: 2 },
    play: openNewNote,
};

export const 新しいノート_ノートまるごと: Story = {
    args: { doc: withVariations, initialPly: 2 },
    play: async (context) => {
        await openNewNote(context);
        await userEvent.click(inDialog().getByRole("radio", { name: /ノートまるごと/ }));
    },
};

export const 新しいノート_この局面だけ: Story = {
    args: { doc: withVariations, initialPly: 2 },
    play: async (context) => {
        await openNewNote(context);
        await userEvent.click(inDialog().getByRole("radio", { name: /この局面だけ/ }));
    },
};

export const 新しいノート_棋譜を読む: Story = {
    args: { doc: withVariations, initialPly: 2 },
    play: async (context) => {
        await openNewNote(context);
        await userEvent.click(inDialog().getByRole("tab", { name: "棋譜・局面を読む" }));
    },
};
