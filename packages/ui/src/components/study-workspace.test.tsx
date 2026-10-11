import { applyStudyOps, type StudyDocument, type StudyOp, studyChildNodeId } from "@shogi/app-core";
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
}: HarnessProps) {
    const [doc, setDoc] = useState(initialDoc);
    const [message, setMessage] = useState<Message | null>(null);
    const displayLayerId = chooseStudyDisplayLayer(doc.layers, null);
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
            displayLayerId={displayLayerId}
            onDisplayLayerChange={() => {}}
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
