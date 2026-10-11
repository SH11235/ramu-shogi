import { applyStudyOps, type StudyDocument, type StudyOp, studyChildNodeId } from "@shogi/app-core";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { useState } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_ANALYSIS_SETTINGS, type Message } from "./shogi-match/types";
import { StudyWorkspaceView } from "./study-workspace";
import type { StudyWorkspaceSaveStatus } from "./study-workspace/StudySaveStatus";
import { cp, createTestStudy, TEST_LAYER_ID } from "./study-workspace/study-test-support";
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
                setDoc((previous) => applyStudyOps(previous, ops));
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

    describe("保存の状態", () => {
        const renderWith = (
            saveStatus: StudyWorkspaceSaveStatus,
            extra: Partial<HarnessProps> = {},
        ) =>
            render(
                <Harness initialDoc={createTestStudy().doc} saveStatus={saveStatus} {...extra} />,
            );

        it("未ログインでは「ログインすると保存できます」を出し、押すとログインへ進む", () => {
            const onLogin = vi.fn();
            renderWith(LOCAL_STATUS, { onLogin });

            expect(screen.getByText("このブラウザに保存済み")).toBeTruthy();
            fireEvent.click(screen.getByRole("button", { name: "ログインすると保存できます" }));
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
            expect(screen.queryByText("ログインすると保存できます")).toBeNull();
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
