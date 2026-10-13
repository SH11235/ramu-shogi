import type { NnueFormat } from "@shogi/app-core";
import type { EngineRegistration } from "@shogi/engine-tauri";
import {
    createEngineRegistryService,
    createEngineSessionService,
    createPreviewSessionService,
    createTauriEngineClient,
    createTauriNnueStorage,
    createUsiEngineClient,
    detect_nnue_format,
    getLegalMoves,
    is_nnue_compatible,
} from "@shogi/engine-tauri";
import type { EngineOption, PlayFromPosition } from "@shogi/ui";
import { EngineControlPanel, NnueProvider, ShogiMatch } from "@shogi/ui";
import { Button } from "@shogi/ui/components/button";
import {
    createStudyFromKifuTree,
    openStudyFromRshogiGame,
} from "@shogi/ui/components/study-workspace/studyEntry";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { useEffect, useRef, useState } from "react";
import { ActiveEngineSettingsPanel } from "./components/ActiveEngineSettingsPanel";
import { CsaGameView } from "./components/csa/CsaGameView";
import { EngineManagerPanel } from "./components/EngineManagerPanel";
import { RshogiViewerListView } from "./components/rshogi-viewer/RshogiViewerListView";
import { RshogiViewerLiveView } from "./components/rshogi-viewer/RshogiViewerLiveView";
import { RshogiViewerView } from "./components/rshogi-viewer/RshogiViewerView";
import { StudiesView } from "./components/studies/StudiesView";
import { StudyView } from "./components/studies/StudyView";
import { getDesktopStudySync } from "./studies/desktopStudySync";

const createEngineClient = () =>
    createTauriEngineClient({
        stopMode: "terminate",
        useMockOnError: false,
        debug: true,
    });

const INTERNAL_ENGINE_OPTION: EngineOption = {
    id: "native",
    label: "内蔵エンジン",
    createClient: createEngineClient,
    kind: "internal",
    // ネイティブのエンジンはアプリに 1 つだけなので、局面の並列解析はできない。
    maxParallel: 1,
};

const panelEngine = createEngineClient();

// Tauri版のストレージは同期的に初期化可能
const nnueStorage = createTauriNnueStorage();

const registryService = createEngineRegistryService();
const previewSessionService = createPreviewSessionService();
const engineSessionService = createEngineSessionService();

// NNUE プリセット manifest.json の URL（環境変数で設定、必須）
const nnueManifestUrl = import.meta.env.VITE_NNUE_MANIFEST_URL as string;

const validateNnueHeader = async (header: Uint8Array, fileSize: number) => ({
    format: (await detect_nnue_format(header, fileSize)) as NnueFormat,
    isCompatible: await is_nnue_compatible(header, fileSize),
});

// NNUE ファイル選択ダイアログを開く
async function requestNnueFilePath(): Promise<string | null> {
    const result = await open({
        filters: [{ name: "NNUE Files", extensions: ["nnue"] }],
        multiple: false,
        directory: false,
    });
    if (typeof result === "string") {
        return result;
    }
    return null;
}

function buildEngineOptions(registrations: EngineRegistration[]): EngineOption[] {
    const external: EngineOption[] = registrations.map((reg) => ({
        id: reg.id,
        label: reg.displayName,
        createClient: () => createUsiEngineClient({ registrationId: reg.id }),
        kind: "external" as const,
    }));
    return [INTERNAL_ENGINE_OPTION, ...external];
}

interface EngineSettingsTarget {
    registration: EngineRegistration;
    sessionId: string;
    label: string;
}

type AppMode =
    | "local"
    | "csa"
    | "rshogi-viewer-list"
    | "rshogi-viewer-detail"
    | "rshogi-viewer-live"
    | "studies"
    | "study";

function App() {
    const [appMode, setAppMode] = useState<AppMode>("local");
    const [rshogiViewerGameId, setRshogiViewerGameId] = useState<string | null>(null);
    // rshogi viewer の「この局面から対局」で引き継いだ局面。ローカル対局をこの局面を読み込んだ
    // 検討の状態で開く（対局は始めない）。viewer や CSA 対局へ移るときに忘れる。
    const [playHandoff, setPlayHandoff] = useState<PlayFromPosition | null>(null);

    // 開いている研究ノート。
    const [studyId, setStudyId] = useState<string | null>(null);
    const [studyError, setStudyError] = useState<string | null>(null);

    const handleOpenStudies = () => {
        setPlayHandoff(null);
        setStudyError(null);
        setStudyId(null);
        setAppMode("studies");
    };

    const handleOpenStudy = (id: string) => {
        setPlayHandoff(null);
        setStudyError(null);
        setStudyId(id);
        setAppMode("study");
    };

    /** 研究ノートを作って開く。作れなかったら、理由を出す（画面はそのまま）。 */
    const openCreatedStudy = (creating: Promise<{ studyId: string }>) => {
        setStudyError(null);
        creating.then(
            (created) => handleOpenStudy(created.studyId),
            (error: unknown) => {
                console.error("[study] 研究ノートを作れませんでした", error);
                setStudyError(
                    `研究ノートを作れませんでした: ${error instanceof Error ? error.message : String(error)}`,
                );
            },
        );
    };

    const handlePlayFromPosition = (position: PlayFromPosition) => {
        setPlayHandoff(position);
        setAppMode("local");
    };

    const handleSwitchToCsa = async () => {
        try {
            const locked = await invoke<boolean>("csa_engine_lock_status");
            if (locked) {
                console.error("エンジンが使用中のため、CSA対局モードに切り替えられません。");
                return;
            }
        } catch {
            // ロック状態確認失敗時はそのまま切り替えを許可
        }
        setPlayHandoff(null);
        setAppMode("csa");
    };

    const handleSwitchToRshogiViewer = () => {
        setPlayHandoff(null);
        setRshogiViewerGameId(null);
        setAppMode("rshogi-viewer-list");
    };

    const handleSelectRshogiGame = (gameId: string) => {
        setRshogiViewerGameId(gameId);
        setAppMode("rshogi-viewer-detail");
    };

    // 一覧上部の「進行中の対局」から live 観戦へ。
    const handleSelectRshogiLiveGame = (gameId: string) => {
        setRshogiViewerGameId(gameId);
        setAppMode("rshogi-viewer-live");
    };

    const handleBackToRshogiList = () => {
        setRshogiViewerGameId(null);
        setAppMode("rshogi-viewer-list");
    };

    const [panelPosition, setPanelPosition] = useState<{
        label?: string;
        sfen: string;
        moves?: string[];
    }>({ label: "現在局面", sfen: "startpos", moves: [] });

    const [engineOptions, setEngineOptions] = useState<EngineOption[]>([INTERNAL_ENGINE_OPTION]);
    const [registrations, setRegistrations] = useState<EngineRegistration[]>([]);
    const [isEngineManagerOpen, setIsEngineManagerOpen] = useState(false);
    const [engineSettingsTarget, setEngineSettingsTarget] = useState<EngineSettingsTarget | null>(
        null,
    );

    const [storeError, setStoreError] = useState<string | null>(null);

    // Load registered engines on mount
    useEffect(() => {
        registryService
            .list()
            .then((list) => {
                setRegistrations(list);
                setEngineOptions(buildEngineOptions(list));
            })
            .catch((e) => {
                console.error("Failed to load engine registrations:", e);
                setStoreError(
                    `外部エンジンの読み込みに失敗しました: ${e instanceof Error ? e.message : String(e)}`,
                );
            });
    }, []);

    const handleEnginesChange = (engines: EngineRegistration[]) => {
        setRegistrations(engines);
        setEngineOptions(buildEngineOptions(engines));
    };

    const [sessionNotReadyMessage, setSessionNotReadyMessage] = useState<string | null>(null);
    const sessionNotReadyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    useEffect(() => {
        const ref = sessionNotReadyTimerRef;
        return () => {
            if (ref.current) {
                clearTimeout(ref.current);
            }
        };
    }, []);

    const handleOpenEngineSettings = (info: {
        side: "sente" | "gote" | "analysis";
        engineId: string;
        sessionId: string | null;
    }) => {
        const reg = registrations.find((r) => r.id === info.engineId);
        if (!reg) return;
        if (!info.sessionId) {
            if (sessionNotReadyTimerRef.current) {
                clearTimeout(sessionNotReadyTimerRef.current);
            }
            setSessionNotReadyMessage("エンジン起動後に設定を変更できます");
            sessionNotReadyTimerRef.current = setTimeout(() => {
                setSessionNotReadyMessage(null);
                sessionNotReadyTimerRef.current = null;
            }, 3000);
            return;
        }
        const sideLabel =
            info.side === "sente" ? "☗ 先手" : info.side === "gote" ? "☖ 後手" : "🔍 解析";
        setEngineSettingsTarget({
            registration: reg,
            sessionId: info.sessionId,
            label: `${sideLabel} ${reg.displayName}`,
        });
    };

    if (appMode === "csa") {
        return (
            <NnueProvider storage={nnueStorage} validateNnueHeader={validateNnueHeader}>
                <main className="mx-auto flex max-w-[1100px] flex-col gap-3 p-4 md:px-5">
                    <CsaGameView onBackToLocal={() => setAppMode("local")} />
                </main>
            </NnueProvider>
        );
    }

    if (appMode === "rshogi-viewer-list") {
        return (
            <NnueProvider storage={nnueStorage} validateNnueHeader={validateNnueHeader}>
                <main className="mx-auto flex max-w-[1100px] flex-col gap-3 p-4 md:px-5">
                    <RshogiViewerListView
                        onBackToLocal={() => setAppMode("local")}
                        onSelectGame={handleSelectRshogiGame}
                        onSelectLiveGame={handleSelectRshogiLiveGame}
                    />
                </main>
            </NnueProvider>
        );
    }

    if (appMode === "rshogi-viewer-detail" && rshogiViewerGameId) {
        return (
            <NnueProvider storage={nnueStorage} validateNnueHeader={validateNnueHeader}>
                <main className="mx-auto flex max-w-[1100px] flex-col gap-3 p-4 md:px-5">
                    <RshogiViewerView
                        gameId={rshogiViewerGameId}
                        onBackToList={handleBackToRshogiList}
                        onBackToLocal={() => setAppMode("local")}
                        onPlayFromPosition={handlePlayFromPosition}
                        onOpenAsStudy={(game) =>
                            openCreatedStudy(
                                openStudyFromRshogiGame(game, { sync: getDesktopStudySync() }),
                            )
                        }
                    />
                    {studyError && (
                        <div className="text-xs text-destructive bg-destructive/10 p-2 rounded">
                            {studyError}
                        </div>
                    )}
                </main>
            </NnueProvider>
        );
    }

    if (appMode === "studies") {
        return (
            <NnueProvider storage={nnueStorage} validateNnueHeader={validateNnueHeader}>
                <main className="mx-auto flex max-w-[1100px] flex-col gap-3 p-4 md:px-5">
                    <StudiesView
                        onBackToLocal={() => setAppMode("local")}
                        onOpenStudy={handleOpenStudy}
                    />
                </main>
            </NnueProvider>
        );
    }

    if (appMode === "study" && studyId) {
        return (
            <NnueProvider storage={nnueStorage} validateNnueHeader={validateNnueHeader}>
                {/* 研究ノートの画面は幅を使うので、ここでは幅を絞らない（中央寄せは画面側が行う）。 */}
                <main className="flex flex-col">
                    <StudyView
                        studyId={studyId}
                        engineOptions={engineOptions}
                        onBackToList={handleOpenStudies}
                        onBackToLocal={() => setAppMode("local")}
                        onPlayFromPosition={handlePlayFromPosition}
                    />
                </main>
            </NnueProvider>
        );
    }

    if (appMode === "rshogi-viewer-live" && rshogiViewerGameId) {
        return (
            <NnueProvider storage={nnueStorage} validateNnueHeader={validateNnueHeader}>
                <main className="mx-auto flex max-w-[1100px] flex-col gap-3 p-4 md:px-5">
                    <RshogiViewerLiveView
                        gameId={rshogiViewerGameId}
                        onBackToList={handleBackToRshogiList}
                        onBackToLocal={() => setAppMode("local")}
                        onPlayFromPosition={handlePlayFromPosition}
                    />
                </main>
            </NnueProvider>
        );
    }

    return (
        <NnueProvider storage={nnueStorage} validateNnueHeader={validateNnueHeader}>
            <main className="mx-auto flex max-w-[1100px] flex-col gap-3 md:px-5">
                <div className="flex justify-end gap-2 pt-2 px-1">
                    <Button variant="outline" size="sm" onClick={handleOpenStudies}>
                        研究ノート
                    </Button>
                    <Button variant="outline" size="sm" onClick={handleSwitchToRshogiViewer}>
                        rshogi viewer
                    </Button>
                    <Button variant="outline" size="sm" onClick={handleSwitchToCsa}>
                        CSA対局
                    </Button>
                </div>
                <ShogiMatch
                    engineOptions={engineOptions}
                    fetchLegalMoves={(sfen, moves, options) =>
                        getLegalMoves({ sfen, moves, passRights: options?.passRights })
                    }
                    isDevMode={true}
                    manifestUrl={nnueManifestUrl}
                    onRequestNnueFilePath={requestNnueFilePath}
                    allowAnalysisDuringMatch={true}
                    defaultNnuePresetKey={import.meta.env.VITE_DEFAULT_NNUE_PRESET}
                    onPositionSnapshot={(snapshot) => setPanelPosition(snapshot)}
                    initialReview={playHandoff ?? undefined}
                    // 読み込んだ棋譜・編集した局面（分岐・コメントごと）を研究ノートにして、その画面へ移る。
                    onOpenAsStudy={(tree, info) =>
                        openCreatedStudy(
                            createStudyFromKifuTree(tree, info, { sync: getDesktopStudySync() }),
                        )
                    }
                    onOpenEngineManager={() => setIsEngineManagerOpen(true)}
                    onOpenEngineSettings={handleOpenEngineSettings}
                />
                {studyError && (
                    <div className="text-xs text-destructive bg-destructive/10 p-2 rounded">
                        {studyError}
                    </div>
                )}
                {storeError && (
                    <div className="text-xs text-destructive bg-destructive/10 p-2 rounded">
                        {storeError}
                    </div>
                )}
                {sessionNotReadyMessage && (
                    <div className="text-xs text-wafuu-sumi bg-wafuu-kincha/20 p-2 rounded">
                        {sessionNotReadyMessage}
                    </div>
                )}
                <EngineControlPanel engine={panelEngine} position={panelPosition} />

                {/* エンジン管理パネル（シンプルな折りたたみ表示） */}
                {isEngineManagerOpen && (
                    <div className="bg-wafuu-washi-warm border border-wafuu-border rounded-xl p-4">
                        <div className="flex items-center justify-between mb-3">
                            <span className="text-sm font-semibold text-wafuu-sumi">
                                外部エンジン管理
                            </span>
                            <button
                                type="button"
                                onClick={() => setIsEngineManagerOpen(false)}
                                className="text-xs text-muted-foreground hover:text-foreground"
                            >
                                閉じる
                            </button>
                        </div>
                        <EngineManagerPanel
                            registryService={registryService}
                            previewSessionService={previewSessionService}
                            onEnginesChange={handleEnginesChange}
                        />
                    </div>
                )}
            </main>

            {/* 起動中エンジン設定drawer */}
            <ActiveEngineSettingsPanel
                open={engineSettingsTarget !== null}
                onOpenChange={(open) => {
                    if (!open) setEngineSettingsTarget(null);
                }}
                engine={engineSettingsTarget}
                registryService={registryService}
                sessionService={engineSessionService}
            />
        </NnueProvider>
    );
}

export default App;
