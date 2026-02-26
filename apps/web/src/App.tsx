import { createWasmEngineClient } from "@shogi/engine-wasm";
import type { EngineOption } from "@shogi/ui";
import { EngineControlPanel, ShogiMatch, useDevMode } from "@shogi/ui";
import { useNavigate } from "@tanstack/react-router";

const resolveWasmThreads = () => {
    const fallback = import.meta.env.DEV ? 4 : 1;
    const raw = import.meta.env.VITE_WASM_THREADS;
    if (typeof raw !== "string" || raw.trim() === "") return fallback;
    const parsed = Number(raw);
    if (!Number.isFinite(parsed) || parsed < 1) return fallback;
    return Math.trunc(parsed);
};

const wasmThreads = resolveWasmThreads();

const createEngineClient = () =>
    createWasmEngineClient({
        stopMode: "terminate",
        defaultInitOptions: { threads: wasmThreads },
        logWarningsToConsole: true,
    });

const engineOptions: EngineOption[] = [
    { id: "wasm", label: "内蔵エンジン", createClient: createEngineClient, kind: "internal" },
];

const panelEngine = createEngineClient();

// NNUE プリセット manifest.json の URL（環境変数で設定、必須）
const nnueManifestUrl = import.meta.env.VITE_NNUE_MANIFEST_URL as string;

function App() {
    const isDevMode = useDevMode();
    const navigate = useNavigate();

    return (
        <main className="mx-auto flex max-w-[1100px] flex-col gap-3 md:px-5">
            <div className="flex items-center justify-end px-1 pt-2">
                <button
                    type="button"
                    onClick={() => void navigate({ to: "/online" })}
                    className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground shadow hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                >
                    オンライン対局を始める
                </button>
            </div>
            <ShogiMatch
                engineOptions={engineOptions}
                isDevMode={isDevMode}
                manifestUrl={nnueManifestUrl}
                defaultNnuePresetKey={import.meta.env.VITE_DEFAULT_NNUE_PRESET}
                aiIconUrl={`${import.meta.env.BASE_URL}ramu.jpeg`}
            />
            {isDevMode && <EngineControlPanel engine={panelEngine} />}
        </main>
    );
}

export default App;
