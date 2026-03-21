import type { NnueFormat } from "@shogi/app-core";
import type { EngineRegistration } from "@shogi/engine-tauri";
import {
    createEngineRegistryService,
    createPreviewSessionService,
    createTauriEngineClient,
    createTauriNnueStorage,
    createUsiEngineClient,
    detect_nnue_format,
    getLegalMoves,
    is_nnue_compatible,
} from "@shogi/engine-tauri";
import type { EngineOption } from "@shogi/ui";
import { EngineControlPanel, NnueProvider, ShogiMatch } from "@shogi/ui";
import { open } from "@tauri-apps/plugin-dialog";
import { useEffect, useState } from "react";
import { ActiveEngineSettingsDrawer } from "./components/ActiveEngineSettingsDrawer";
import { EngineManagerPanel } from "./components/EngineManagerPanel";

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
};

const panelEngine = createEngineClient();

// Tauri版のストレージは同期的に初期化可能
const nnueStorage = createTauriNnueStorage();

const registryService = createEngineRegistryService();
const previewSessionService = createPreviewSessionService();

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

function App() {
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

    const handleOpenEngineSettings = (info: {
        side: "sente" | "gote" | "analysis";
        engineId: string;
        sessionId: string | null;
    }) => {
        const reg = registrations.find((r) => r.id === info.engineId);
        if (!reg || !info.sessionId) return;
        const sideLabel =
            info.side === "sente" ? "☗ 先手" : info.side === "gote" ? "☖ 後手" : "🔍 解析";
        setEngineSettingsTarget({
            registration: reg,
            sessionId: info.sessionId,
            label: `${sideLabel} ${reg.displayName}`,
        });
    };

    return (
        <NnueProvider storage={nnueStorage} validateNnueHeader={validateNnueHeader}>
            <main className="mx-auto flex max-w-[1100px] flex-col gap-3 md:px-5">
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
                    onOpenEngineManager={() => setIsEngineManagerOpen(true)}
                    onOpenEngineSettings={handleOpenEngineSettings}
                />
                {storeError && (
                    <div className="text-xs text-destructive bg-destructive/10 p-2 rounded">
                        {storeError}
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
            <ActiveEngineSettingsDrawer
                open={engineSettingsTarget !== null}
                onOpenChange={(open) => {
                    if (!open) setEngineSettingsTarget(null);
                }}
                engine={engineSettingsTarget}
                registryService={registryService}
            />
        </NnueProvider>
    );
}

export default App;
