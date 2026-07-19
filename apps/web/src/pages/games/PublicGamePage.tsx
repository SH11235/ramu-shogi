import type { GameRecordDetail } from "@shogi/api-contract";
import { parseCsaMoves } from "@shogi/app-core";
import type { EngineOption } from "@shogi/ui";
import { ShogiMatch } from "@shogi/ui";
import { getRouteApi } from "@tanstack/react-router";
import type { ReactElement } from "react";
import { HeaderNav } from "../../components/HeaderNav";
import { PageHeader } from "../../components/PageHeader";
import { createWebWasmEngineClient } from "../../platform/wasm-engine-client";
import { formatGameResult } from "./gameResultUtils";

const engineOptions: EngineOption[] = [
    {
        id: "wasm",
        label: "内蔵エンジン",
        createClient: createWebWasmEngineClient,
        kind: "internal",
    },
];

const routeApi = getRouteApi("/public/games/$publicId");

function GameInfoPanel({ game }: { game: GameRecordDetail }): ReactElement {
    return (
        <div className="flex flex-col gap-3">
            <div className="text-sm font-semibold text-wafuu-sumi">
                {game.participants.map((p) => p.displayNameSnapshot).join(" vs ")}
            </div>
            <div className="text-sm text-muted-foreground">{formatGameResult(game)}</div>
            <div className="flex flex-col gap-1 text-xs text-muted-foreground">
                <span>
                    開始:{" "}
                    {game.startedAt ? new Date(game.startedAt).toLocaleString("ja-JP") : "不明"}
                </span>
                <span>
                    終了:{" "}
                    {game.finishedAt ? new Date(game.finishedAt).toLocaleString("ja-JP") : "不明"}
                </span>
            </div>
        </div>
    );
}

// CSA Worker (`source: 'csa_relay'`) 由来の棋譜は backend が USI moves を持たない
// ため `moves: []` を返す (issue #613)。viewer 側で `kifuText` (CSA V2 本文) を
// パースして USI moves を再構築する。
export function resolveMoves(game: GameRecordDetail): string[] {
    if (game.moves.length > 0) return game.moves;
    if (game.source !== "csa_relay" || !game.kifuText) return game.moves;
    try {
        return parseCsaMoves(game.kifuText);
    } catch (err) {
        // CSA パース失敗は viewer 表示を空盤面で起動させる仕様だが、原因追跡のため
        // 本番でも console に出力する。
        console.error("[PublicGamePage] CSA moves parse failed:", err);
        return [];
    }
}

export default function PublicGamePage(): ReactElement {
    const game = routeApi.useLoaderData() as GameRecordDetail;
    const moves = resolveMoves(game);

    return (
        <>
            <PageHeader
                items={[{ label: "ラム将棋", to: "/" }, { label: "公開棋譜" }]}
                right={<HeaderNav />}
            />
            <div>
                <ShogiMatch
                    engineOptions={engineOptions}
                    manifestUrl={import.meta.env.VITE_NNUE_MANIFEST_URL as string}
                    defaultSides={{
                        sente: { role: "human" },
                        gote: { role: "human" },
                    }}
                    initialReview={{
                        sfen: game.initialSfen,
                        moves,
                    }}
                    reviewMode={true}
                    reviewLeftContent={<GameInfoPanel game={game} />}
                />
            </div>
        </>
    );
}
