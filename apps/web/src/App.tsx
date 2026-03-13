import { createWasmEngineClient } from "@shogi/engine-wasm";
import type { EngineOption } from "@shogi/ui";
import { EngineControlPanel, ShogiMatch, useDevMode } from "@shogi/ui";
import { Link } from "@tanstack/react-router";
import { useState } from "react";
import { PageHeader } from "./components/PageHeader";
import { useRemotePrivateNnueManager } from "./hooks/useRemotePrivateNnueManager";

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
    const remoteNnueManager = useRemotePrivateNnueManager();
    const [panelPosition, setPanelPosition] = useState<{
        label?: string;
        sfen: string;
        moves?: string[];
    }>({ label: "現在局面", sfen: "startpos", moves: [] });

    const headerLinks = (
        <div className="flex items-center gap-2">
            <Link
                to="/auth"
                className="rounded-md border border-border px-3 py-0.5 text-xs text-muted-foreground transition-colors hover:bg-muted/50 hover:text-foreground"
            >
                ログイン
            </Link>
            <Link
                to="/games"
                className="rounded-md border border-border px-3 py-0.5 text-xs text-muted-foreground transition-colors hover:bg-muted/50 hover:text-foreground"
            >
                棋譜一覧
            </Link>
            <Link
                to="/nnue"
                className="rounded-md border border-border px-3 py-0.5 text-xs text-muted-foreground transition-colors hover:bg-muted/50 hover:text-foreground"
            >
                NNUE
            </Link>
            <Link
                to="/online"
                className="rounded-md border border-wafuu-shu px-3 py-0.5 text-xs text-wafuu-shu transition-colors hover:bg-wafuu-shu/10"
            >
                オンライン対局 →
            </Link>
        </div>
    );

    return (
        <>
            <PageHeader items={[{ label: "ラム将棋" }]} right={headerLinks} />
            <main className="mx-auto flex max-w-[1100px] flex-col gap-3 pt-3 md:px-5">
                <ShogiMatch
                    engineOptions={engineOptions}
                    isDevMode={isDevMode}
                    manifestUrl={nnueManifestUrl}
                    remoteNnueManager={remoteNnueManager}
                    defaultNnuePresetKey={import.meta.env.VITE_DEFAULT_NNUE_PRESET}
                    aiIconUrl={`${import.meta.env.BASE_URL}ramu.jpeg`}
                    onPositionSnapshot={(snapshot) => setPanelPosition(snapshot)}
                />
                {isDevMode && <EngineControlPanel engine={panelEngine} position={panelPosition} />}
            </main>
        </>
    );
}

export default App;
