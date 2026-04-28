import { createTauriEngineClient, getLegalMoves } from "@shogi/engine-tauri";
import type { EngineOption } from "@shogi/ui";
import { listMockRshogiGameIds, RshogiCsaViewer } from "@shogi/ui";
import { Button } from "@shogi/ui/components/button";
import { type ReactElement, useState } from "react";

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
    onBackToLocal: () => void;
}

export function RshogiViewerView({ onBackToLocal }: Props): ReactElement {
    const mockIds = listMockRshogiGameIds();
    const [gameId, setGameId] = useState<string>(mockIds[0] ?? "sample-1");
    const [draftGameId, setDraftGameId] = useState<string>(gameId);
    const apiBaseUrl =
        (import.meta.env.VITE_RSHOGI_API_BASE as string | undefined)?.trim() || undefined;

    const handleApply = () => {
        const next = draftGameId.trim();
        if (next.length > 0) setGameId(next);
    };

    return (
        <div className="flex flex-col gap-3">
            <div className="flex flex-wrap items-center gap-2">
                <Button variant="outline" size="sm" onClick={onBackToLocal}>
                    ← ローカル対局へ戻る
                </Button>
                <span className="text-sm font-semibold text-wafuu-sumi">rshogi viewer</span>
                <span className="text-xs text-muted-foreground">
                    対局 ID を指定して CSA 棋譜を再生します。
                </span>
            </div>
            <div className="flex flex-wrap items-center gap-2 rounded-lg border border-wafuu-border bg-wafuu-washi-warm p-2">
                <label className="text-xs text-muted-foreground" htmlFor="rshogi-game-id">
                    対局 ID
                </label>
                <input
                    id="rshogi-game-id"
                    className="rounded border border-wafuu-border bg-background px-2 py-1 text-sm"
                    value={draftGameId}
                    onChange={(e) => setDraftGameId(e.target.value)}
                />
                <Button size="sm" onClick={handleApply}>
                    再生
                </Button>
                {mockIds.length > 0 && (
                    <span className="text-xs text-muted-foreground">
                        モック ID 例: {mockIds.join(", ")}
                    </span>
                )}
            </div>
            <RshogiCsaViewer
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
