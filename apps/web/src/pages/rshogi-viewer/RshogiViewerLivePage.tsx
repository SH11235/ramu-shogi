import { createWasmEngineClient } from "@shogi/engine-wasm";
import type { EngineOption } from "@shogi/ui";
import { RshogiCsaLiveViewer } from "@shogi/ui";
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

const routeApi = getRouteApi("/rshogi-viewer/live/$gameId");

/**
 * 進行中対局の live 観戦ページ。
 *
 * 静的単局 viewer (`/rshogi-viewer/$gameId`) は `fetchRshogiGame` で CSA 全文を
 * 1 回取得して表示するのに対し、本ページは `subscribeRshogiLiveGame` で WS 接続
 * し、snapshot replay → broadcast move を逐次表示する。
 */
export default function RshogiViewerLivePage(): ReactElement {
    const { gameId } = routeApi.useParams();
    const apiBaseUrl =
        (import.meta.env.VITE_RSHOGI_API_BASE as string | undefined)?.trim() || undefined;

    return (
        <>
            <PageHeader
                items={[
                    { label: "ラム将棋", to: "/" },
                    { label: "rshogi viewer", to: "/rshogi-viewer" },
                    { label: `live: ${gameId}` },
                ]}
                right={<HeaderNav />}
            />
            <RshogiCsaLiveViewer
                gameId={gameId}
                engineOptions={engineOptions}
                manifestUrl={import.meta.env.VITE_NNUE_MANIFEST_URL as string}
                apiBaseUrl={apiBaseUrl}
            />
        </>
    );
}
