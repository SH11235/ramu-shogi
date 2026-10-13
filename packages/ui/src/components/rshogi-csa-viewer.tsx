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

import { type Player, parseCsaGameRecord } from "@shogi/app-core";
import { cn } from "@shogi/design-system";
import type {
    FetchRshogiGameOptions,
    RshogiGame,
    RshogiGameEventMeta,
    RshogiGameEventSummary,
} from "@shogi/match-client";
import {
    fetchRshogiGame,
    fetchRshogiGameEvents,
    RshogiGameNotFoundError,
} from "@shogi/match-client";
import { type ReactElement, type ReactNode, useEffect, useEffectEvent, useState } from "react";
import { Button } from "./button";
import { findRshogiEventMeta, RshogiEventMetaDetail } from "./rshogi-csa-event-meta";
import { resolveDisplayedResult } from "./rshogi-csa-result";
import { RshogiVenueBadge } from "./rshogi-csa-venue";
import {
    type PlayFromPosition,
    PlayFromPositionButton,
    useShownPosition,
} from "./rshogi-play-from-position";
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
    /**
     * 対局情報の欄に足す操作（「研究ノートで開く」など）。読み込んだ棋譜を受け取って描く。
     * PC では左の対局情報の下、モバイルでは対局情報のシートの中に出る。
     */
    renderGameAction?: (game: RshogiGame) => ReactNode;
    /**
     * 「この局面から対局」を押したときに、いま表示している局面（本譜の現在の手数まで。分岐を
     * 見ていればその分岐の手順まで）を受け取る。対局ページへ引き継いで開く。
     * 指定したときだけボタンを出す（`renderGameAction` の操作のすぐ下）。
     */
    onPlayFromPosition?: (position: PlayFromPosition) => void;
}

interface LoadState {
    checkmatedSide?: Player;
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

/**
 * 対局者（先手・後手）を左右に分けた 1 行。盤の上の中央に出す、盤の見出し。
 *
 * 見出しなので背景と枠は付けない（背景付きのカードは、脇に置く補足情報のかたまりだけに使う）。
 * 並びは盤を反転しても変えない（先手が左、後手が右。ライブ観戦のスコアボードと同じ）。
 * 色は評価値グラフと同じく先手 = 朱、後手 = 藍。長い名前は省略せず、その側の幅の中で折り返す。
 * 勝った側には「勝ち」の印を付ける（引き分け・中断・結果不明ではどちらにも付けない）。
 */
function RshogiPlayersBar({
    meta,
    rates,
}: {
    meta: RshogiGame["meta"];
    rates?: PlayerRates;
}): ReactElement {
    const winner = meta.result?.winner;
    const renderSide = (side: "sente" | "gote") => {
        const isSente = side === "sente";
        const name = isSente ? meta.senteName : meta.goteName;
        const rate = isSente ? rates?.sente : rates?.gote;
        return (
            <div
                data-side={side}
                className={cn(
                    "flex min-w-0 flex-col gap-0.5 px-3 py-0.5",
                    isSente
                        ? "border-l-4 border-wafuu-shu"
                        : "items-end border-r-4 border-wafuu-ai text-right",
                )}
            >
                <span className="text-xs text-muted-foreground">{isSente ? "先手" : "後手"}</span>
                <div
                    className={cn(
                        // 収まらないときは、後ろの要素（勝ちの印・レート）から次の行へ送り、名前に幅を譲る。
                        "flex min-w-0 max-w-full flex-wrap items-baseline gap-x-1.5 gap-y-0.5",
                        !isSente && "justify-end",
                    )}
                >
                    <span
                        className={cn(
                            "flex-none text-base leading-none",
                            isSente ? "text-wafuu-shu" : "text-wafuu-ai",
                        )}
                        aria-hidden="true"
                    >
                        {isSente ? "☗" : "☖"}
                    </span>
                    <span className="min-w-0 max-w-full text-sm font-semibold [overflow-wrap:anywhere]">
                        {name}
                    </span>
                    {rate !== undefined && (
                        <span className="flex-none text-xs tabular-nums text-muted-foreground">
                            R{Math.round(rate)}
                        </span>
                    )}
                    {winner === side && (
                        <span className="flex-none rounded border border-wafuu-kin bg-wafuu-kin/20 px-1.5 text-[11px] font-bold leading-4 text-wafuu-sumi">
                            勝ち
                        </span>
                    )}
                </div>
            </div>
        );
    };
    return (
        <section aria-label="対局者" className="grid grid-cols-2 gap-2 text-wafuu-sumi">
            {renderSide("sente")}
            {renderSide("gote")}
        </section>
    );
}

function RshogiGameMetaPanel({
    game,
    eventMeta,
    checkmatedSide,
}: {
    game: RshogiGame;
    checkmatedSide?: Player;
    /** イベントのメタデータ（大会の正式名称・公式ページなど）。無ければタグだけを出す。 */
    eventMeta?: RshogiGameEventMeta;
}): ReactElement {
    const { meta } = game;
    const originUrl = meta.originUrl?.startsWith(ORIGIN_URL_PREFIX) ? meta.originUrl : undefined;
    return (
        <section
            aria-label="対局情報"
            className="flex flex-col gap-2 rounded-lg border border-wafuu-border bg-wafuu-washi-warm p-3 text-sm text-wafuu-sumi"
        >
            {/* 対局 ID はページ上部のパンくずに出ているので、ここには出さない。 */}
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
                    {eventMeta ? (
                        <RshogiEventMetaDetail meta={eventMeta} />
                    ) : (
                        <span>{meta.event}</span>
                    )}
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
            <div className="text-sm">
                {formatResult({
                    ...meta,
                    result: resolveDisplayedResult(meta.result, checkmatedSide),
                })}
            </div>
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
    renderGameAction,
    onPlayFromPosition,
}: RshogiCsaViewerProps): ReactElement {
    const [state, setState] = useState<LoadState>({ status: "loading" });
    const isMobile = useIsMobile();
    const [isMetaSheetOpen, setIsMetaSheetOpen] = useState(false);
    const [events, setEvents] = useState<RshogiGameEventSummary[]>([]);
    const shownPosition = useShownPosition();
    const resetShownPosition = useEffectEvent(shownPosition.reset);

    useEffect(() => {
        const controller = new AbortController();
        setState({ status: "loading" });
        resetShownPosition();
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
                    checkmatedSide: record.checkmatedSide,
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

    // イベントのメタデータ（大会の正式名称・公式ページなど）。棋譜とは別のリクエストで、
    // 取れなくても棋譜の表示は妨げない（イベントのタグだけを出す）。
    const eventTag = state.game?.meta.event;
    useEffect(() => {
        if (!eventTag) return;
        const controller = new AbortController();
        void (async () => {
            try {
                const list = await fetchRshogiGameEvents({
                    baseUrl: apiBaseUrl,
                    fetchImpl: fetchOverride,
                    signal: controller.signal,
                });
                if (!controller.signal.aborted) setEvents(list);
            } catch {
                if (!controller.signal.aborted) setEvents([]);
            }
        })();
        return () => {
            controller.abort();
        };
    }, [eventTag, apiBaseUrl, fetchOverride]);

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

    // 対局者は横に長いので、左の対局情報ではなく盤の上に出す。
    const playersBar = <RshogiPlayersBar meta={game.meta} rates={rates} />;

    const metaContent = (
        <div className="flex flex-col gap-2">
            <RshogiGameMetaPanel
                checkmatedSide={state.checkmatedSide}
                game={game}
                eventMeta={findRshogiEventMeta(events, game.meta.event, game.meta.source)}
            />
            {/* 主は「研究ノートで開く」、従は「この局面から対局」。続けて並べる。 */}
            {renderGameAction?.(game)}
            {onPlayFromPosition && (
                <PlayFromPositionButton
                    onClick={() => onPlayFromPosition(shownPosition.getShownPosition(startSfen))}
                />
            )}
            <Button type="button" variant="outline" size="sm" onClick={handleDownloadCsa}>
                CSA ダウンロード
            </Button>
        </div>
    );

    return (
        <div>
            {header}
            {/* モバイルのレイアウトには左カラムが無い。盤の上に対局者（PC と同じ、先手・後手を
                分けた行）と、対局場所の 1 行を出し、残り (元棋譜へのリンク・CSA ダウンロードなど)
                はシートで開く。 */}
            {isMobile && (
                <>
                    <div className="px-2 pt-1">{playersBar}</div>
                    <button
                        type="button"
                        onClick={() => setIsMetaSheetOpen(true)}
                        aria-haspopup="dialog"
                        className="flex w-full items-center justify-end gap-2 border-b border-wafuu-border px-3 py-1.5 text-left text-xs text-wafuu-sumi"
                    >
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
                // 棋譜を見るだけの画面なので、対局開始・棋譜読込・局面編集などは出さない。
                viewerMode={true}
                // 盤の上（対局時計の位置）に対局者を出す。スマホは上の行で出している。
                boardTopContent={playersBar}
                // 対局中ではないので、評価値グラフは隠さず常に出す（折りたたみの操作も出さない）。
                evalGraphPinned={true}
                onPositionSnapshot={shownPosition.handlePositionSnapshot}
                // 棋譜に評価値が入っているときは、観戦と同じく評価値の列とグラフを最初から出す。
                spectateMode={hasRecordedEval}
                reviewLeftContent={metaContent}
            />
        </div>
    );
}
