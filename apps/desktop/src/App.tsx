import type { NnueFormat } from "@shogi/app-core";
import type { EngineRegistration } from "@shogi/engine-tauri";
import {
    createEngineRegistryService,
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

function App() {
    const [panelPosition, setPanelPosition] = useState<{
        label?: string;
        sfen: string;
        moves?: string[];
    }>({ label: "現在局面", sfen: "startpos", moves: [] });

    const [engineOptions, setEngineOptions] = useState<EngineOption[]>([INTERNAL_ENGINE_OPTION]);
    const [isEngineManagerOpen, setIsEngineManagerOpen] = useState(false);

    // Load registered engines on mount
    useEffect(() => {
        registryService.list().then((list) => {
            setEngineOptions(buildEngineOptions(list));
        });
    }, []);

    const handleEnginesChange = (engines: EngineRegistration[]) => {
        setEngineOptions(buildEngineOptions(engines));
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
                />
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
                            onEnginesChange={handleEnginesChange}
                        />
                    </div>
                )}
            </main>
        </NnueProvider>
    );
}

export default App;
