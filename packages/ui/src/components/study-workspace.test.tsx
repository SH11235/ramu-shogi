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
    initialCommentDrafts?: { nodeId: string; text: string }[];
    onCommentDraftChange?: (nodeId: string, text: string | null) => void;
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
    initialDisplayLayerId,
    deepLayerId,
}: HarnessProps) {
    const [doc, setDoc] = useState(initialDoc);
    const [message, setMessage] = useState<Message | null>(null);
    const [preferredLayerId, setPreferredLayerId] = useState<string | null>(
        initialDisplayLayerId ?? null,
    );
    const displayLayerId = chooseStudyDisplayLayer(doc.layers, preferredLayerId);
    const { tree } = buildStudyViewTree(doc, displayLayerId);
    return (
        <StudyWorkspaceView
            doc={doc}
            tree={tree}
            onApplyOps={(ops) => {
                onOps?.(ops);
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
        expect(onDraft).toHaveBeenLastCalledWith(ids[1], tooLong);
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
            expect(onDraft).toHaveBeenLastCalledWith(ids[0], "書きかけ");

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
            await waitFor(() => expect(onDraft).toHaveBeenLastCalledWith(ids[0], null));
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
                    initialCommentDrafts={[{ nodeId: ids[0], text: "戻ってきた下書き" }]}
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
            await waitFor(() => expect(onDraft).toHaveBeenLastCalledWith(ids[0], null));
        });

        it("保存できなかったコメントは、保存済み扱いにせず下書きとして残す", async () => {
            const { doc, ids } = createTestStudy();
            const onDraft = vi.fn();
            render(<Harness initialDoc={doc} onCommentDraftChange={onDraft} rejectOps />);

            const comment = screen.getByRole("textbox", { name: "コメント" });
            fireEvent.change(comment, { target: { value: "保存できない" } });
            fireEvent.blur(comment);

            await waitFor(() => expect(onDraft).toHaveBeenLastCalledWith(ids[0], "保存できない"));
            expect((comment as HTMLTextAreaElement).value).toBe("保存できない");
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
