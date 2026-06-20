import type {
    AnalysisSnapshotDetail,
    AnalysisSnapshotSummary,
    CreateAnalysisSnapshotRequest,
    CreateAnalysisSnapshotResponse,
    GameRecordDetail,
    GetAnalysisSnapshotResponse,
    JsonValue,
} from "@shogi/api-contract";
import { createWasmEngineClient } from "@shogi/engine-wasm";
import type { AnalysisSettings, AnalysisSnapshotDraft, EngineOption } from "@shogi/ui";
import { ShogiMatch } from "@shogi/ui";
import { getRouteApi, useParams } from "@tanstack/react-router";
import type { ReactElement } from "react";
import { useState } from "react";
import { HeaderNav } from "../../components/HeaderNav";
import { PageHeader } from "../../components/PageHeader";
import { parseApiError } from "../../hooks/useAuthSession";
import { useRemotePrivateNnueManager } from "../../hooks/useRemotePrivateNnueManager";

const resolveWasmThreads = () => {
    const fallback = import.meta.env.DEV ? 4 : 1;
    const raw = import.meta.env.VITE_WASM_THREADS;
    if (typeof raw !== "string" || raw.trim() === "") return fallback;
    const parsed = Number(raw);
    if (!Number.isFinite(parsed) || parsed < 1) return fallback;
    return Math.trunc(parsed);
};

const wasmThreads = resolveWasmThreads();

const engineOptions: EngineOption[] = [
    {
        id: "wasm",
        label: "内蔵エンジン",
        createClient: () =>
            createWasmEngineClient({
                stopMode: "terminate",
                defaultInitOptions: { threads: wasmThreads },
                logWarningsToConsole: true,
            }),
        kind: "internal",
    },
];

const routeApi = getRouteApi("/games/$gameId/review");

async function createAnalysisSnapshot(
    gameId: string,
    requestBody: CreateAnalysisSnapshotRequest,
): Promise<CreateAnalysisSnapshotResponse> {
    const response = await fetch(`/api/games/${gameId}/analysis-snapshots`, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
        },
        credentials: "same-origin",
        body: JSON.stringify(requestBody),
    });

    if (!response.ok) {
        throw new Error(await parseApiError(response));
    }

    return (await response.json()) as CreateAnalysisSnapshotResponse;
}

async function getAnalysisSnapshot(
    gameId: string,
    snapshotId: string,
): Promise<GetAnalysisSnapshotResponse> {
    const response = await fetch(`/api/games/${gameId}/analysis-snapshots/${snapshotId}`, {
        credentials: "same-origin",
    });
    if (!response.ok) {
        throw new Error(await parseApiError(response));
    }

    return (await response.json()) as GetAnalysisSnapshotResponse;
}

export default function GameReviewPage(): ReactElement {
    const { gameId } = useParams({ from: "/games/$gameId/review" });
    const loaderData = routeApi.useLoaderData() as {
        game: GameRecordDetail;
        snapshots: AnalysisSnapshotSummary[];
    };
    const remoteNnueManager = useRemotePrivateNnueManager();
    const game = loaderData.game;
    const [snapshots, setSnapshots] = useState<AnalysisSnapshotSummary[]>(loaderData.snapshots);
    const [selectedSnapshot, setSelectedSnapshot] = useState<AnalysisSnapshotDetail | null>(null);
    const [draft, setDraft] = useState<AnalysisSnapshotDraft | null>(null);
    const [snapshotLabel, setSnapshotLabel] = useState("");
    const [isSaving, setIsSaving] = useState(false);
    const [status, setStatus] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);
    const selectedSnapshotEntries =
        selectedSnapshot?.entries.map((entry) => ({
            ply: entry.ply,
            evalCp: entry.evalCp,
            evalMate: entry.evalMate,
            depth: entry.depth,
            pv: entry.pv,
            multiPv: Array.isArray(entry.multiPv)
                ? (entry.multiPv as AnalysisSnapshotDraft["entries"][number]["multiPv"])
                : null,
        })) ?? null;
    const effectiveDraft =
        draft && draft.entries.length > 0
            ? draft
            : selectedSnapshot && selectedSnapshotEntries
              ? ({
                    startSfen:
                        typeof selectedSnapshot.metadata === "object" &&
                        selectedSnapshot.metadata !== null &&
                        "startSfen" in selectedSnapshot.metadata &&
                        typeof selectedSnapshot.metadata.startSfen === "string"
                            ? selectedSnapshot.metadata.startSfen
                            : game.initialSfen,
                    lineMoves: selectedSnapshot.lineMoves,
                    analysisSettings:
                        selectedSnapshot.analysisSettings as unknown as AnalysisSettings,
                    entries: selectedSnapshotEntries,
                } satisfies AnalysisSnapshotDraft)
              : null;

    async function handleSaveSnapshot(): Promise<void> {
        if (!effectiveDraft || !game || isSaving) return;

        setIsSaving(true);
        setStatus(null);
        setError(null);

        const requestBody: CreateAnalysisSnapshotRequest = {
            label: snapshotLabel.trim() || null,
            lineMoves: effectiveDraft.lineMoves,
            analysisSettings: effectiveDraft.analysisSettings as unknown as JsonValue,
            metadata: {
                startSfen: effectiveDraft.startSfen,
            },
            entries: effectiveDraft.entries.map((entry) => ({
                ply: entry.ply,
                evalCp: entry.evalCp,
                evalMate: entry.evalMate,
                depth: entry.depth,
                pv: entry.pv,
                multiPv: entry.multiPv,
            })),
        };

        await createAnalysisSnapshot(game.id, requestBody)
            .then((payload) => {
                setSnapshots((prev) => [payload.snapshot, ...prev]);
                setSnapshotLabel("");
                setStatus("解析結果を保存しました。");
            })
            .catch((nextError: unknown) => {
                setError(
                    nextError instanceof Error ? nextError.message : "解析結果の保存に失敗しました",
                );
            });

        setIsSaving(false);
    }

    async function handleSelectSnapshot(snapshotId: string): Promise<void> {
        setStatus(null);
        setError(null);

        await getAnalysisSnapshot(gameId, snapshotId)
            .then((payload) => {
                setSelectedSnapshot(payload.snapshot);
            })
            .catch((nextError: unknown) => {
                setError(
                    nextError instanceof Error ? nextError.message : "解析結果の取得に失敗しました",
                );
            });
    }

    const snapshotPanel = (
        <div className="flex flex-col gap-3">
            <div className="text-sm font-semibold text-wafuu-sumi">
                {game.participants.map((p) => p.displayNameSnapshot).join(" vs ")}
            </div>
            {status && (
                <div className="rounded-md border border-status-success-border bg-status-success-bg px-3 py-2 text-xs text-status-success">
                    {status}
                </div>
            )}
            {error && (
                <div className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
                    {error}
                </div>
            )}
            <div className="flex flex-col gap-2">
                <input
                    type="text"
                    value={snapshotLabel}
                    onChange={(event) => setSnapshotLabel(event.target.value)}
                    placeholder="保存名（任意）"
                    className="flex h-8 rounded-md border border-input bg-transparent px-2 py-1 text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                />
                <button
                    type="button"
                    onClick={() => void handleSaveSnapshot()}
                    disabled={isSaving || !effectiveDraft || effectiveDraft.entries.length === 0}
                    className="rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground shadow transition-colors hover:bg-primary/90 disabled:pointer-events-none disabled:opacity-50"
                >
                    {isSaving ? "保存中..." : "解析結果を保存"}
                </button>
                <div className="text-xs text-muted-foreground">
                    保存対象: {effectiveDraft?.entries.length ?? 0} 手
                </div>
            </div>
            {snapshots.length > 0 && (
                <div className="flex flex-col gap-1.5">
                    <div className="text-xs font-semibold text-wafuu-sumi">保存済み</div>
                    {snapshots.map((snapshot) => (
                        <button
                            key={snapshot.id}
                            type="button"
                            onClick={() => void handleSelectSnapshot(snapshot.id)}
                            className="rounded-md border border-input px-2 py-2 text-left text-xs transition-colors hover:bg-muted/50"
                        >
                            <div className="font-medium text-foreground">
                                {snapshot.label ?? "無題"}
                            </div>
                            <div className="text-muted-foreground">
                                {new Date(snapshot.createdAt).toLocaleString("ja-JP")} /{" "}
                                {snapshot.entryCount} 手
                            </div>
                        </button>
                    ))}
                </div>
            )}
        </div>
    );

    return (
        <>
            <PageHeader
                items={[
                    { label: "ラム将棋", to: "/" },
                    { label: "棋譜一覧", to: "/games" },
                    { label: "検討" },
                ]}
                right={<HeaderNav />}
            />
            <div>
                <ShogiMatch
                    key={selectedSnapshot?.id ?? "live-analysis"}
                    engineOptions={engineOptions}
                    manifestUrl={import.meta.env.VITE_NNUE_MANIFEST_URL as string}
                    remoteNnueManager={remoteNnueManager}
                    defaultSides={{
                        sente: { role: "human" },
                        gote: { role: "human" },
                    }}
                    initialReview={{
                        sfen: game.initialSfen,
                        moves: selectedSnapshot?.lineMoves ?? game.moves,
                    }}
                    initialAnalysisEntries={selectedSnapshotEntries}
                    onAnalysisSnapshotChange={setDraft}
                    reviewMode={true}
                    reviewLeftContent={snapshotPanel}
                />
            </div>
        </>
    );
}
