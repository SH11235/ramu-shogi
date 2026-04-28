/**
 * rshogi CSA viewer 共通コンポーネント。
 *
 * Web/Desktop の各 Page から `engineOptions` と NNUE manifest を渡して使う。
 * フェッチ・パース・読み込み中表示までをここで集約し、本体の盤面/棋譜は
 * 既存の `<ShogiMatch>` の `initialReview + reviewMode` に委譲する。
 *
 * 配信 API は別タスク (rshogi#542) で設計中のため、`fetchRshogiGame` は
 * モックを返す stub。本実装に差し替える際はこのコンポーネントは触らずに済む。
 */

import { parseCsaMoves } from "@shogi/app-core";
import type { FetchRshogiGameOptions, RshogiGame } from "@shogi/match-client";
import { fetchRshogiGame, RshogiGameNotFoundError } from "@shogi/match-client";
import { type ReactElement, type ReactNode, useEffect, useState } from "react";
import { ShogiMatch } from "./shogi-match";
import type { EngineOption } from "./shogi-match/types";

export interface RshogiCsaViewerProps {
    gameId: string;
    engineOptions: EngineOption[];
    manifestUrl: string;
    /** rshogi 配信 API のベース URL。空のときはモック fixture を返す。 */
    apiBaseUrl?: string;
    /** 主にテスト・SSR で fetch を差し替えるためのフック */
    fetchOverride?: FetchRshogiGameOptions["fetchImpl"];
    /** ヘッダ等の追加レイアウト要素 */
    header?: ReactNode;
    aiIconUrl?: string;
    fetchLegalMoves?: React.ComponentProps<typeof ShogiMatch>["fetchLegalMoves"];
    onRequestNnueFilePath?: React.ComponentProps<typeof ShogiMatch>["onRequestNnueFilePath"];
    isDevMode?: boolean;
}

interface LoadState {
    status: "loading" | "ready" | "not-found" | "error";
    game?: RshogiGame;
    moves?: string[];
    errorMessage?: string;
}

const formatTimestamp = (value: string | undefined): string => {
    if (!value) return "不明";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return value;
    return date.toLocaleString("ja-JP");
};

const formatTimeControl = (value: RshogiGame["meta"]["timeControl"]): string => {
    if (!value) return "持ち時間: 不明";
    const main = `${Math.round(value.mainSeconds / 60)}分`;
    const byoyomi = value.byoyomiSeconds > 0 ? ` + 秒読み${value.byoyomiSeconds}秒` : "";
    const inc =
        value.incrementSeconds && value.incrementSeconds > 0
            ? ` + 加算${value.incrementSeconds}秒`
            : "";
    return `持ち時間: ${main}${byoyomi}${inc}`;
};

const formatResult = (meta: RshogiGame["meta"]): string => {
    const result = meta.result;
    if (!result) return "結果: 不明";
    const winnerLabel =
        result.winner === "sente"
            ? `先手 (${meta.senteName}) 勝ち`
            : result.winner === "gote"
              ? `後手 (${meta.goteName}) 勝ち`
              : "引き分け";
    const reason: Record<typeof result.kind, string> = {
        resignation: "投了",
        checkmate: "詰み",
        time_expired: "時間切れ",
        draw: "引き分け",
        abort: "中断",
    };
    return `結果: ${winnerLabel} (${reason[result.kind]})`;
};

function RshogiGameMetaPanel({ game }: { game: RshogiGame }): ReactElement {
    const { meta } = game;
    return (
        <section
            aria-label="対局情報"
            className="flex flex-col gap-2 rounded-lg border border-wafuu-border bg-wafuu-washi-warm p-3 text-sm text-wafuu-sumi"
        >
            <div className="flex flex-col gap-1">
                <span className="text-xs text-muted-foreground">対局 ID</span>
                <span className="font-mono text-xs text-wafuu-sumi">{meta.gameId}</span>
            </div>
            <div className="flex flex-col gap-1">
                <span className="text-xs text-muted-foreground">対局者</span>
                <span className="text-sm font-semibold">
                    ☗ {meta.senteName} vs ☖ {meta.goteName}
                </span>
            </div>
            {meta.event && (
                <div className="flex flex-col gap-1">
                    <span className="text-xs text-muted-foreground">大会</span>
                    <span>{meta.event}</span>
                </div>
            )}
            <div className="flex flex-col gap-0.5 text-xs text-muted-foreground">
                <span>開始: {formatTimestamp(meta.startedAt)}</span>
                <span>終了: {formatTimestamp(meta.endedAt)}</span>
            </div>
            <div className="text-xs text-muted-foreground">
                {formatTimeControl(meta.timeControl)}
            </div>
            <div className="text-sm">{formatResult(meta)}</div>
        </section>
    );
}

export function RshogiCsaViewer({
    gameId,
    engineOptions,
    manifestUrl,
    apiBaseUrl,
    fetchOverride,
    header,
    aiIconUrl,
    fetchLegalMoves,
    onRequestNnueFilePath,
    isDevMode,
}: RshogiCsaViewerProps): ReactElement {
    const [state, setState] = useState<LoadState>({ status: "loading" });

    useEffect(() => {
        const controller = new AbortController();
        setState({ status: "loading" });
        void (async () => {
            try {
                const game = await fetchRshogiGame(gameId, {
                    baseUrl: apiBaseUrl,
                    fetchImpl: fetchOverride,
                    signal: controller.signal,
                });
                if (controller.signal.aborted) return;
                let moves: string[];
                try {
                    moves = parseCsaMoves(game.csa);
                } catch (parseError) {
                    setState({
                        status: "error",
                        errorMessage: `CSA の解析に失敗しました: ${String(parseError)}`,
                    });
                    return;
                }
                setState({ status: "ready", game, moves });
            } catch (error) {
                if (controller.signal.aborted) return;
                if (error instanceof RshogiGameNotFoundError) {
                    setState({ status: "not-found" });
                    return;
                }
                setState({
                    status: "error",
                    errorMessage:
                        error instanceof Error
                            ? error.message
                            : `読み込みに失敗しました: ${String(error)}`,
                });
            }
        })();
        return () => {
            controller.abort();
        };
    }, [gameId, apiBaseUrl, fetchOverride]);

    if (state.status === "loading") {
        return (
            <div className="mx-auto flex max-w-[480px] flex-col gap-2 px-4 py-10 text-sm text-muted-foreground">
                {header}
                <p>棋譜を読み込み中...</p>
            </div>
        );
    }

    if (state.status === "not-found") {
        return (
            <div className="mx-auto flex max-w-[480px] flex-col gap-2 px-4 py-10 text-sm">
                {header}
                <p className="text-destructive">
                    対局 ID「{gameId}」の棋譜が見つかりませんでした。
                </p>
            </div>
        );
    }

    if (state.status === "error") {
        return (
            <div className="mx-auto flex max-w-[480px] flex-col gap-2 px-4 py-10 text-sm">
                {header}
                <p className="text-destructive">{state.errorMessage}</p>
            </div>
        );
    }

    const { game, moves } = state;
    if (!game || !moves) {
        return <div className="mx-auto flex max-w-[480px] flex-col gap-2 px-4 py-10 text-sm" />;
    }

    return (
        <div>
            {header}
            <ShogiMatch
                engineOptions={engineOptions}
                manifestUrl={manifestUrl}
                aiIconUrl={aiIconUrl}
                fetchLegalMoves={fetchLegalMoves}
                onRequestNnueFilePath={onRequestNnueFilePath}
                isDevMode={isDevMode}
                defaultSides={{
                    sente: { role: "human" },
                    gote: { role: "human" },
                }}
                initialReview={{ sfen: "startpos", moves }}
                reviewMode={true}
                reviewLeftContent={<RshogiGameMetaPanel game={game} />}
            />
        </div>
    );
}
