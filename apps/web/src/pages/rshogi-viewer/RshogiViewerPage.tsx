import type { EngineOption } from "@shogi/ui";
import { RshogiCsaViewer } from "@shogi/ui";
import { getRouteApi } from "@tanstack/react-router";
import { type ReactElement, useEffect } from "react";
import { HeaderNav } from "../../components/HeaderNav";
import { OpenStudyButton } from "../../components/OpenStudyButton";
import { PageHeader } from "../../components/PageHeader";
import { usePlayFromPosition } from "../../hooks/usePlayFromPosition";
import { openStudyFromRshogiGame } from "../../lib/studyEntry";
import { createWebWasmEngineClient } from "../../platform/wasm-engine-client";

const engineOptions: EngineOption[] = [
    {
        id: "wasm",
        label: "内蔵エンジン",
        createClient: createWebWasmEngineClient,
        kind: "internal",
    },
];

const routeApi = getRouteApi("/rshogi-viewer/$gameId");

function GameTitle({ sente, gote }: { sente: string; gote: string }): null {
    useEffect(() => {
        if (!sente.trim() || !gote.trim()) return;
        const previous = document.title;
        const title = `${sente} 対 ${gote} | ラム将棋`;
        document.title = title;
        return () => {
            if (document.title === title) document.title = previous;
        };
    }, [sente, gote]);
    return null;
}

export default function RshogiViewerPage(): ReactElement {
    const { gameId } = routeApi.useParams();
    const playFromPosition = usePlayFromPosition();
    const apiBaseUrl =
        (import.meta.env.VITE_RSHOGI_API_BASE as string | undefined)?.trim() || undefined;

    return (
        <>
            <PageHeader
                items={[
                    { label: "ラム将棋", to: "/" },
                    { label: "rshogi viewer", to: "/rshogi-viewer" },
                    { label: "棋譜" },
                ]}
                right={<HeaderNav />}
            />
            <RshogiCsaViewer
                gameId={gameId}
                engineOptions={engineOptions}
                manifestUrl={import.meta.env.VITE_NNUE_MANIFEST_URL as string}
                apiBaseUrl={apiBaseUrl}
                // 同じ棋譜の研究ノートがあればそれを開き、無ければ対局時の評価値ごと取り込んで作る。
                // この画面から先へ進む操作は 2 つ。主が「研究ノートで開く」、従が「この局面から対局」。
                renderGameAction={(game, { compact }) => (
                    <>
                        <GameTitle sente={game.meta.senteName} gote={game.meta.goteName} />
                        <OpenStudyButton
                            open={() => openStudyFromRshogiGame(game)}
                            // スマホの盤の下の 1 行に収めるため、短い名前にする。
                            label={compact ? "研究ノート" : undefined}
                            size={compact ? "compact" : "default"}
                        />
                    </>
                )}
                // いま表示している局面を `/play` へ引き継ぐ（対局は始めず、設定を選べる状態で開く）。
                onPlayFromPosition={playFromPosition}
            />
        </>
    );
}
