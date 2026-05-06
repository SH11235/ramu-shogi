import type { GameRecordDetail } from "@shogi/api-contract";
import { parseCsaMoves } from "@shogi/app-core";
import { createWasmEngineClient } from "@shogi/engine-wasm";
import type { EngineOption } from "@shogi/ui";
import { ShogiMatch } from "@shogi/ui";
import { getRouteApi } from "@tanstack/react-router";
import type { ReactElement } from "react";
import { HeaderNav } from "../../components/HeaderNav";
import { PageHeader } from "../../components/PageHeader";
import { formatGameResult } from "./gameResultUtils";

const resolveWasmThreads = () => {
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
function resolveMoves(game: GameRecordDetail): string[] {
    if (game.moves.length > 0) return game.moves;
    if (game.source !== "csa_relay" || !game.kifuText) return game.moves;
    try {
        return parseCsaMoves(game.kifuText);
    } catch {
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
