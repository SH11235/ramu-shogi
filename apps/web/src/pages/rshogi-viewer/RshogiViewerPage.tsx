import { createWasmEngineClient } from "@shogi/engine-wasm";
import type { EngineOption } from "@shogi/ui";
import { RshogiCsaViewer } from "@shogi/ui";
import { getRouteApi } from "@tanstack/react-router";
import type { ReactElement } from "react";
import { HeaderNav } from "../../components/HeaderNav";
import { PageHeader } from "../../components/PageHeader";

const resolveWasmThreads = (): number => {
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

const routeApi = getRouteApi("/rshogi-viewer/$gameId");

export default function RshogiViewerPage(): ReactElement {
    const { gameId } = routeApi.useParams();
    const apiBaseUrl =
        (import.meta.env.VITE_RSHOGI_API_BASE as string | undefined)?.trim() || undefined;

    return (
        <>
            <PageHeader
                items={[
                    { label: "ラム将棋", to: "/" },
                    { label: "rshogi viewer" },
                    { label: gameId },
                ]}
                right={<HeaderNav />}
            />
            <RshogiCsaViewer
                gameId={gameId}
                engineOptions={engineOptions}
                manifestUrl={import.meta.env.VITE_NNUE_MANIFEST_URL as string}
                apiBaseUrl={apiBaseUrl}
            />
        </>
    );
}
