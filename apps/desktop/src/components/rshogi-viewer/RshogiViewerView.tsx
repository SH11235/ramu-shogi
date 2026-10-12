import { createTauriEngineClient, getLegalMoves } from "@shogi/engine-tauri";
import type { EngineOption, PlayFromPosition } from "@shogi/ui";
import { RshogiCsaViewer } from "@shogi/ui";
import { Button } from "@shogi/ui/components/button";
import type { ComponentProps, ReactElement } from "react";

/** 棋譜ビューアが渡す棋譜（「研究ノートで開く」の材料）。 */
type ViewerGame = Parameters<
    NonNullable<ComponentProps<typeof RshogiCsaViewer>["renderGameAction"]>
>[0];

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
        // ネイティブのエンジンはアプリに 1 つだけなので、局面の並列解析はできない。
        maxParallel: 1,
    },
];

const nnueManifestUrl = import.meta.env.VITE_NNUE_MANIFEST_URL as string;

interface Props {
    gameId: string;
    onBackToList: () => void;
    onBackToLocal: () => void;
    /** 「この局面から対局」。いま表示している局面を受け取り、ローカル対局へ引き継ぐ。 */
    onPlayFromPosition: (position: PlayFromPosition) => void;
    /** 「研究ノートで開く」。同じ棋譜のノートがあればそれを開き、無ければ作る。 */
    onOpenAsStudy: (game: ViewerGame) => void;
}

export function RshogiViewerView({
    gameId,
    onBackToList,
    onBackToLocal,
    onPlayFromPosition,
    onOpenAsStudy,
}: Props): ReactElement {
    const apiBaseUrl =
        (import.meta.env.VITE_RSHOGI_API_BASE as string | undefined)?.trim() || undefined;

    return (
        <div className="flex flex-col gap-3">
            <div className="flex flex-wrap items-center gap-2">
                <Button variant="outline" size="sm" onClick={onBackToLocal}>
                    ← ローカル対局へ戻る
                </Button>
                <Button variant="outline" size="sm" onClick={onBackToList}>
                    ← 一覧へ戻る
                </Button>
                <span className="text-sm font-semibold text-wafuu-sumi">rshogi viewer</span>
                <span className="text-xs text-muted-foreground">対局 ID: {gameId}</span>
            </div>
            <RshogiCsaViewer
                gameId={gameId}
                engineOptions={ENGINE_OPTIONS}
                manifestUrl={nnueManifestUrl}
                apiBaseUrl={apiBaseUrl}
                // この画面から先へ進む操作は 2 つ。主が「研究ノートで開く」、従が「この局面から対局」。
                renderGameAction={(game) => (
                    <Button type="button" onClick={() => onOpenAsStudy(game)}>
                        研究ノートで開く
                    </Button>
                )}
                onPlayFromPosition={onPlayFromPosition}
                fetchLegalMoves={(sfen, moves, options) =>
                    getLegalMoves({ sfen, moves, passRights: options?.passRights })
                }
                isDevMode={true}
            />
        </div>
    );
}
