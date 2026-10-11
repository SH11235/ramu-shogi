/**
 * rshogi CSA viewer 共通コンポーネント。
 *
 * Web/Desktop の各 Page から `engineOptions` と NNUE manifest を渡して使う。
 * フェッチ・パース・読み込み中表示までをここで集約し、本体の盤面/棋譜は
 * 既存の `<ShogiMatch>` の `initialReview + reviewMode` に委譲する。
 *
 * API contract は match-client 側の decode 層で snake_case → camelCase / epoch_ms 保持に
 * 変換される。本コンポーネントは decode 後の TS 型のみを扱う。
 */

import { parseCsaGameRecord } from "@shogi/app-core";
import type { FetchRshogiGameOptions, RshogiGame } from "@shogi/match-client";
import { fetchRshogiGame, RshogiGameNotFoundError } from "@shogi/match-client";
import { type ReactElement, type ReactNode, useEffect, useState } from "react";
import { Button } from "./button";
import { RshogiVenueBadge } from "./rshogi-csa-venue";
import { ShogiMatch } from "./shogi-match";
import { BottomSheet } from "./shogi-match/components/BottomSheet";
import type { ReviewMoveEval } from "./shogi-match/hooks/useKifuImportExport";
import { useIsMobile } from "./shogi-match/hooks/useMediaQuery";
import type { EngineOption } from "./shogi-match/types";
import { csaAnnotationsToMoveData } from "./shogi-match/utils/kifuImport";

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
    /** 開始局面の SFEN。平手なら `"startpos"`。 */
    startSfen?: string;
    moves?: string[];
    /** `moves` と同じ index で対応する評価値・読み筋・消費時間 (CSA のコメント由来)。 */
    moveData?: (ReviewMoveEval | undefined)[];
    /** CSA の `'black_rate:` / `'white_rate:` 行のレート。 */
    rates?: PlayerRates;
    errorMessage?: string;
}

interface PlayerRates {
    sente?: number;
    gote?: number;
}

/** 元棋譜へのリンクにしてよい URL の接頭辞。それ以外の `origin_url` はリンクにしない。 */
const ORIGIN_URL_PREFIX = "https://wdoor.c.u-tokyo.ac.jp/";

const formatRate = (rate: number | undefined): string =>
    rate === undefined ? "" : ` (R${Math.round(rate)})`;

const formatTimestampMs = (value: number | undefined): string => {
    if (value === undefined) return "不明";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "不明";
    return date.toLocaleString("ja-JP");
};

const formatMainTime = (seconds: number): string => {
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = seconds % 60;
    if (minutes === 0) return `${remainingSeconds}秒`;
    if (remainingSeconds === 0) return `${minutes}分`;
    return `${minutes}分${remainingSeconds}秒`;
};

const formatTimeControl = (value: RshogiGame["meta"]["timeControl"]): string => {
    if (!value) return "持ち時間: 不明";
    const main = formatMainTime(value.mainSeconds);
    // byoyomiSeconds は ms からの丸め値なので、秒未満の秒読み (countdown_msec) は
    // ms 側を優先して 0.25秒 のように表示する
    const byoyomiValue =
        value.byoyomiMilliseconds !== undefined && value.byoyomiMilliseconds > 0
            ? value.byoyomiMilliseconds / 1000
            : value.byoyomiSeconds;
    const byoyomi = byoyomiValue > 0 ? ` + 秒読み${byoyomiValue}秒` : "";
    const inc =
        value.incrementSeconds && value.incrementSeconds > 0
            ? ` + 加算${value.incrementSeconds}秒`
            : "";
    return `持ち時間: ${main}${byoyomi}${inc}`;
};

const RESULT_KIND_LABEL: Record<NonNullable<RshogiGame["meta"]["result"]>["kind"], string> = {
    resignation: "投了",
    checkmate: "詰み",
    time_expired: "時間切れ",
    draw: "千日手",
    jishogi: "入玉勝ち",
    oute_sennichite: "連続王手千日手",
    abort: "中断",
    max_moves: "最大手数",
    abnormal: "異常終了",
};

const formatResult = (meta: RshogiGame["meta"]): string => {
    const result = meta.result;
    if (!result) return "結果: 不明";
    // winner なし = 引き分けとは限らない (中断・異常終了も winner なし)
    const winnerLabel =
        result.winner === "sente"
            ? `先手 (${meta.senteName}) 勝ち`
            : result.winner === "gote"
              ? `後手 (${meta.goteName}) 勝ち`
              : result.kind === "draw" || result.kind === "max_moves"
                ? "引き分け"
                : "勝敗なし";
    const reason =
        result.endReason === "ILLEGAL" ? "反則" : (RESULT_KIND_LABEL[result.kind] ?? "終局");
    return `結果: ${winnerLabel} (${reason})`;
};

function RshogiGameMetaPanel({
    game,
    rates,
}: {
    game: RshogiGame;
    rates?: PlayerRates;
}): ReactElement {
    const { meta } = game;
    const originUrl = meta.originUrl?.startsWith(ORIGIN_URL_PREFIX) ? meta.originUrl : undefined;
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
                    ☗ {meta.senteName}
                    {formatRate(rates?.sente)} vs ☖ {meta.goteName}
                    {formatRate(rates?.gote)}
                </span>
            </div>
            {meta.source && (
                <div className="flex flex-col gap-1">
                    <span className="text-xs text-muted-foreground">対局場所</span>
                    <span className="text-sm">
                        <RshogiVenueBadge source={meta.source} withLabelPrefix={false} />
                    </span>
                </div>
            )}
            {meta.event && (
                <div className="flex flex-col gap-1">
                    <span className="text-xs text-muted-foreground">イベント</span>
                    <span>{meta.event}</span>
                </div>
            )}
            {originUrl && (
                <a
                    href={originUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-xs text-wafuu-ai underline underline-offset-2 hover:text-wafuu-ai-light"
                >
                    元の棋譜を開く（Floodgate）
                </a>
            )}
            <div className="flex flex-col gap-0.5 text-xs text-muted-foreground">
                <span>開始: {formatTimestampMs(meta.startedAtMs)}</span>
                <span>終了: {formatTimestampMs(meta.endedAtMs)}</span>
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
    const isMobile = useIsMobile();
    const [isMetaSheetOpen, setIsMetaSheetOpen] = useState(false);

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
                let record: ReturnType<typeof parseCsaGameRecord>;
                try {
                    record = parseCsaGameRecord(game.csa);
                } catch (parseError) {
                    setState({
                        status: "error",
                        errorMessage: `CSA の解析に失敗しました: ${
                            parseError instanceof Error ? parseError.message : String(parseError)
                        }`,
                    });
                    return;
                }
                setState({
                    status: "ready",
                    game,
                    startSfen: record.startSfen,
                    moves: record.moves,
                    moveData: csaAnnotationsToMoveData(record.annotations),
                    rates: { sente: record.senteRate, gote: record.goteRate },
                });
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

    const { game, startSfen, moves, moveData, rates } = state;
    if (!game || !moves || !startSfen) {
        return <div className="mx-auto flex max-w-[480px] flex-col gap-2 px-4 py-10 text-sm" />;
    }

    const hasRecordedEval =
        moveData?.some((data) => data?.evalCp !== undefined || data?.evalMate !== undefined) ??
        false;

    const handleDownloadCsa = (): void => {
        const blob = new Blob([game.csa], { type: "text/plain;charset=utf-8" });
        const url = URL.createObjectURL(blob);
        const anchor = document.createElement("a");
        anchor.href = url;
        anchor.download = `${gameId}.csa`;
        document.body.appendChild(anchor);
        anchor.click();
        anchor.remove();
        URL.revokeObjectURL(url);
    };

    const metaContent = (
        <div className="flex flex-col gap-2">
            <RshogiGameMetaPanel game={game} rates={rates} />
            <Button type="button" variant="outline" size="sm" onClick={handleDownloadCsa}>
                CSA ダウンロード
            </Button>
        </div>
    );

    return (
        <div>
            {header}
            {/* モバイルのレイアウトには左カラムが無い。盤面を狭めないよう対局者と対局場所だけを
                1 行で出し、残り (レート・元棋譜へのリンク・CSA ダウンロードなど) はシートで開く。 */}
            {isMobile && (
                <>
                    <button
                        type="button"
                        onClick={() => setIsMetaSheetOpen(true)}
                        aria-haspopup="dialog"
                        className="flex w-full items-center gap-2 border-b border-wafuu-border bg-wafuu-washi-warm px-3 py-1.5 text-left text-xs text-wafuu-sumi"
                    >
                        <span className="min-w-0 flex-1 truncate font-semibold">
                            ☗ {game.meta.senteName} vs ☖ {game.meta.goteName}
                        </span>
                        <RshogiVenueBadge source={game.meta.source} />
                        <span className="shrink-0 text-wafuu-shu">対局情報</span>
                    </button>
                    <BottomSheet
                        open={isMetaSheetOpen}
                        onOpenChange={setIsMetaSheetOpen}
                        title="対局情報"
                        height="auto"
                    >
                        {metaContent}
                    </BottomSheet>
                </>
            )}
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
                initialReview={{ sfen: startSfen, moves, moveData }}
                reviewMode={true}
                // 棋譜に評価値が入っているときは、観戦と同じく評価値の列とグラフを最初から出す。
                spectateMode={hasRecordedEval}
                reviewLeftContent={metaContent}
            />
        </div>
    );
}
