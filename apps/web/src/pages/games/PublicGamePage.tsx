import type { GameRecordDetail } from "@shogi/api-contract";
import { parseCsaMoves } from "@shogi/app-core";
import type { EngineOption } from "@shogi/ui";
import { ShogiMatch, useIsMobile } from "@shogi/ui";
import { getRouteApi } from "@tanstack/react-router";
import type { ReactElement } from "react";
import { HeaderNav } from "../../components/HeaderNav";
import { OpenStudyButton } from "../../components/OpenStudyButton";
import { PageHeader } from "../../components/PageHeader";
import { createStudyFromKifuSource } from "../../lib/studyEntry";
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

function GameInfoPanel({ game, moves }: { game: GameRecordDetail; moves: string[] }): ReactElement {
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
            <OpenAsStudy game={game} moves={moves} />
        </div>
    );
}

/**
 * 「研究ノートで開く」と案内。この画面は棋譜を見るだけなので、調べたいときは研究ノートにして
 * 開く（自分のノートになる）。指し手の無い棋譜では出さない。
 */
function OpenAsStudy({
    game,
    moves,
}: {
    game: GameRecordDetail;
    moves: string[];
}): ReactElement | null {
    if (moves.length === 0) return null;
    return (
        <div className="flex flex-col gap-1">
            <OpenStudyButton
                open={() =>
                    createStudyFromKifuSource({
                        kind: "moves",
                        startSfen: game.initialSfen,
                        moves,
                    })
                }
            />
            {/* 「（整備中）」は、研究ノートの本格実装が済んだら外す。 */}
            <p className="text-xs text-muted-foreground">
                解析や変化の検討は、研究ノート（整備中）でできます。
            </p>
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
    // スマホのレイアウトには左の欄（対局情報）が無いので、研究ノートへの入口は盤の上に出す。
    const isMobile = useIsMobile();

    return (
        <>
            <PageHeader
                items={[{ label: "ラム将棋", to: "/" }, { label: "公開棋譜" }]}
                right={<HeaderNav />}
            />
            <div>
                {isMobile && (
                    <div className="px-2 pt-2">
                        <OpenAsStudy game={game} moves={moves} />
                    </div>
                )}
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
                    // 棋譜を見るだけの画面。盤の操作と解析はさせない。
                    viewerMode={true}
                    reviewLeftContent={<GameInfoPanel game={game} moves={moves} />}
                />
            </div>
        </>
    );
}
