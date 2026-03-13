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
import type { AnalysisSnapshotDraft, EngineOption } from "@shogi/ui";
import { ShogiMatch } from "@shogi/ui";
import { getRouteApi, Link, useParams } from "@tanstack/react-router";
import type { ReactElement } from "react";
import { useState } from "react";
import { PageHeader } from "../../components/PageHeader";
import { parseApiError } from "../../hooks/useAuthSession";
import { useRemotePrivateNnueManager } from "../../hooks/useRemotePrivateNnueManager";
import type { AnalysisSettings } from "@shogi/ui";

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

    return (
        <>
            <PageHeader
                items={[
                    { label: "ラム将棋", to: "/" },
                    { label: "棋譜一覧", to: "/games" },
                    { label: "検討" },
                ]}
                right={
                    <Link
                        to="/games/$gameId"
                        params={{ gameId }}
                        className="rounded-md border border-border px-3 py-0.5 text-xs text-muted-foreground transition-colors hover:bg-muted/50 hover:text-foreground"
                    >
                        詳細へ戻る
                    </Link>
                }
            />
            <main className="mx-auto flex max-w-[1200px] flex-col gap-6 px-4 py-8">
                {status && (
                    <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-700">
                        {status}
                    </div>
                )}
                {error && (
                    <div className="rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
                        {error}
                    </div>
                )}

                <section className="rounded-xl border border-border bg-card p-5 shadow-sm">
                    <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
                        <div>
                            <h1 className="text-2xl font-bold text-foreground">
                                {game.participants
                                    .map((participant) => participant.displayNameSnapshot)
                                    .join(" vs ")}
                            </h1>
                            <p className="text-sm text-muted-foreground">
                                この画面で解析した評価値を snapshot として保存できます。
                            </p>
                        </div>
                        <div className="flex flex-col gap-2 sm:flex-row">
                            <input
                                type="text"
                                value={snapshotLabel}
                                onChange={(event) => setSnapshotLabel(event.target.value)}
                                placeholder="保存名（任意）"
                                className="flex h-10 rounded-md border border-input bg-transparent px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                            />
                            <button
                                type="button"
                                onClick={() => void handleSaveSnapshot()}
                                disabled={
                                    isSaving ||
                                    !effectiveDraft ||
                                    effectiveDraft.entries.length === 0
                                }
                                className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground shadow transition-colors hover:bg-primary/90 disabled:pointer-events-none disabled:opacity-50"
                            >
                                {isSaving ? "保存中..." : "解析結果を保存"}
                            </button>
                        </div>
                    </div>
                    <div className="mt-3 text-xs text-muted-foreground">
                        現在の保存対象: {effectiveDraft?.entries.length ?? 0} 手
                    </div>
                </section>

                <section className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_360px]">
                    <div className="min-w-0">
                        <ShogiMatch
                            key={selectedSnapshot?.id ?? "live-analysis"}
                            engineOptions={engineOptions}
                            manifestUrl={import.meta.env.VITE_NNUE_MANIFEST_URL as string}
                            remoteNnueManager={remoteNnueManager}
                            initialReview={{
                                sfen: game.initialSfen,
                                moves: selectedSnapshot?.lineMoves ?? game.moves,
                            }}
                            initialAnalysisEntries={selectedSnapshotEntries}
                            onAnalysisSnapshotChange={setDraft}
                        />
                    </div>

                    <div className="relative z-10 flex flex-col gap-4">
                        <section className="rounded-xl border border-border bg-card p-5 shadow-sm">
                            <h2 className="mb-3 text-lg font-semibold text-foreground">
                                保存済み snapshot
                            </h2>
                            {snapshots.length === 0 ? (
                                <p className="text-sm text-muted-foreground">
                                    保存済み snapshot はありません。
                                </p>
                            ) : (
                                <div className="grid gap-2">
                                    {snapshots.map((snapshot) => (
                                        <button
                                            key={snapshot.id}
                                            type="button"
                                            onClick={() => void handleSelectSnapshot(snapshot.id)}
                                            className="relative z-10 rounded-md border border-input px-3 py-3 text-left transition-colors hover:bg-muted/50"
                                        >
                                            <div className="text-sm font-medium text-foreground">
                                                {snapshot.label ?? "無題の snapshot"}
                                            </div>
                                            <div className="text-xs text-muted-foreground">
                                                {new Date(snapshot.createdAt).toLocaleString(
                                                    "ja-JP",
                                                )}
                                            </div>
                                            <div className="text-xs text-muted-foreground">
                                                {snapshot.entryCount} 手
                                            </div>
                                        </button>
                                    ))}
                                </div>
                            )}
                        </section>

                        {selectedSnapshot && (
                            <section className="rounded-xl border border-border bg-card p-5 shadow-sm">
                                <h2 className="mb-3 text-lg font-semibold text-foreground">
                                    snapshot 詳細
                                </h2>
                                <div className="mb-3 text-sm text-muted-foreground">
                                    {selectedSnapshot.label ?? "無題の snapshot"}
                                </div>
                                <ol className="grid gap-2 text-sm">
                                    {selectedSnapshot.entries.map((entry) => (
                                        <li
                                            key={`${selectedSnapshot.id}:${entry.ply}`}
                                            className="rounded-md border border-border px-3 py-2"
                                        >
                                            <div className="font-medium text-foreground">
                                                {entry.ply} 手目
                                            </div>
                                            <div className="text-xs text-muted-foreground">
                                                evalCp: {entry.evalCp ?? "-"} / evalMate:{" "}
                                                {entry.evalMate ?? "-"} / depth:{" "}
                                                {entry.depth ?? "-"}
                                            </div>
                                        </li>
                                    ))}
                                </ol>
                            </section>
                        )}
                    </div>
                </section>
            </main>
        </>
    );
}
