import { createTauriEngineClient, getLegalMoves } from "@shogi/engine-tauri";
import type { EngineOption } from "@shogi/ui";
import { RshogiCsaLiveViewer } from "@shogi/ui";
import { Button } from "@shogi/ui/components/button";
import type { ReactElement } from "react";

const ENGINE_OPTIONS: EngineOption[] = [
    {
        id: "native",
        label: "内蔵エンジン",
        createClient: () =>
            createTauriEngineClient({
                stopMode: "terminate",
                useMockOnError: false,
                debug: true,
            }),
        kind: "internal",
    },
];

const nnueManifestUrl = import.meta.env.VITE_NNUE_MANIFEST_URL as string;

interface Props {
    gameId: string;
    onBackToList: () => void;
    onBackToLocal: () => void;
}

/**
 * Desktop 用の rshogi 進行中対局 (live spectate) ビュー。
 *
 * Web 側 `RshogiViewerLivePage` と同一の `RshogiCsaLiveViewer` を表示する。
 * gameId は呼出側 (`App.tsx`) で保持し、戻るボタンで一覧 / ローカル対局へ遷移する。
 */
export function RshogiViewerLiveView({ gameId, onBackToList, onBackToLocal }: Props): ReactElement {
    const apiBaseUrl =
        (import.meta.env.VITE_RSHOGI_API_BASE as string | undefined)?.trim() || undefined;

    return (
        <div className="flex flex-col gap-3">
            <div className="flex flex-wrap items-center gap-2">
                <Button variant="outline" size="sm" onClick={onBackToLocal}>
                    ← ローカル対局へ戻る
                </Button>
                <Button variant="outline" size="sm" onClick={onBackToList}>
                    ← 棋譜一覧へ戻る
                </Button>
                <span className="text-sm font-semibold text-wafuu-sumi">rshogi viewer (live)</span>
                <span className="text-xs text-muted-foreground">対局 ID: {gameId}</span>
            </div>
            <RshogiCsaLiveViewer
                gameId={gameId}
                engineOptions={ENGINE_OPTIONS}
                manifestUrl={nnueManifestUrl}
                apiBaseUrl={apiBaseUrl}
                fetchLegalMoves={(sfen, moves, options) =>
                    getLegalMoves({ sfen, moves, passRights: options?.passRights })
                }
                isDevMode={true}
            />
        </div>
    );
}
