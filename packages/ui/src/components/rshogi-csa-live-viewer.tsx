/**
 * rshogi 進行中対局 (live spectate) viewer。
 *
 * 静的単局 viewer (`RshogiCsaViewer`) と異なり、`subscribeRshogiLiveGame` を介して
 * WebSocket で server から snapshot + broadcast move を受信し、画面を逐次更新する。
 *
 * - snapshot 受信時のみ state を全置換し `<ShogiMatch>` を remount (key=snapshotEpoch)。
 *   broadcast move では key を変えず initialReview.moves を伸ばし、prop 更新で反映する
 *   (毎手 remount しないので盤・棋譜がちらつかない)。
 * - 対局者・時計・手数・接続状態は上部のブロードキャスト・スコアボードに集約表示する。
 * - clock countdown は server の残時間を anchor に local timer で 1Hz 減算する。
 * - 終局時に最終結果を表示する。
 */

import { cn } from "@shogi/design-system";
import {
    type RshogiGameMeta,
    type RshogiGameResult,
    type RshogiLiveCallbacks,
    type RshogiLiveConnectionState,
    type RshogiLiveMove,
    type RshogiLiveSession,
    type RshogiLiveSnapshot,
    subscribeRshogiLiveGame,
} from "@shogi/match-client";
import { type ReactElement, type ReactNode, useEffect, useRef, useState } from "react";
import { ShogiMatch } from "./shogi-match";
import type { ReviewMoveEval } from "./shogi-match/hooks/useKifuImportExport";
import type { EngineOption } from "./shogi-match/types";

export interface RshogiCsaLiveViewerProps {
    gameId: string;
    engineOptions: EngineOption[];
    manifestUrl: string;
    /** rshogi 観戦 WS のベース URL (例: `wss://csa.example.com`)。空のときは MVP のフォールバックモード。 */
    apiBaseUrl?: string;
    /** ヘッダ等の追加レイアウト要素 */
    header?: ReactNode;
    aiIconUrl?: string;
    fetchLegalMoves?: React.ComponentProps<typeof ShogiMatch>["fetchLegalMoves"];
    onRequestNnueFilePath?: React.ComponentProps<typeof ShogiMatch>["onRequestNnueFilePath"];
    isDevMode?: boolean;
}

interface LiveState {
    /** 最新 snapshot (= 直近の `onSnapshot` で受け取った全置換状態)。 */
    snapshot: RshogiLiveSnapshot | null;
    /** snapshot 後に到着した broadcast move を含む累計 moves。 */
    moves: string[];
    /**
     * `moves` と同順・同長の各手付随情報 (先手視点 eval / 消費秒)。
     * `initialReview.moveData` としてそのまま `<ShogiMatch>` に渡し、棋譜評価値
     * カラム・評価値グラフを点灯させる。scoreboard 用の latest-only 値 (senteEvalCp
     * 等) とは独立に、全手分を保持する。
     */
    moveEvals: (ReviewMoveEval | undefined)[];
    /** 表示中の対局結果 (終局後)。 */
    result?: RshogiGameResult;
    /**
     * snapshot 適用ごとに増えるカウンタ。`<ShogiMatch>` の key に使う。
     * snapshot は全置換 (接続/再接続時のみ) なので remount してよいが、broadcast
     * move では key を変えず prop 更新で反映する (毎手 remount を避けてちらつきを防ぐ)。
     */
    snapshotEpoch: number;
    /** 最後に server から受け取った clock 残時間 (ms)。 */
    clocks: { sente: number; gote: number; sideToMove: "sente" | "gote" } | null;
    /** clock を local timer で減算するための anchor (ms epoch)。 */
    clockAnchorAtMs: number | null;
    connectionState: RshogiLiveConnectionState;
    /** 直近の (致命的でない) エラー文言。 */
    lastError?: string;
    /**
     * 各手番エンジンが自コメントで報告した最新評価値 (wire 値 = **先手視点**、
     * `+` が先手有利)。表示時に後手側のみ符号反転して「その手番自身の視点」に直す。
     * コメントの無い対局 (旧サーバ) では undefined のまま。
     */
    senteEvalCp?: number;
    goteEvalCp?: number;
    /** 最新コメントの読み筋 (CSA トークン列)。無ければ undefined。 */
    latestPv?: string[];
    /** 直近手の消費秒数 (`,T` 由来)。旧サーバや未着手時は undefined。 */
    lastMoveElapsedSec?: number;
}

const initialLiveState: LiveState = {
    snapshot: null,
    moves: [],
    moveEvals: [],
    snapshotEpoch: 0,
    clocks: null,
    clockAnchorAtMs: null,
    connectionState: "connecting",
};

/** 詰みを表すセンチネル (サーバ `build_floodgate_comment` は詰みを ±100000 で符号化)。 */
const MATE_EVAL_SENTINEL = 100_000;

/**
 * 評価値 (その手番自身の視点に直した値。`+` = その手番が有利) を表示文字列にする。
 * ±100000 の詰みセンチネルは数値でなく詰み表記にする。
 */
export function formatOwnEval(ownCp: number): string {
    if (ownCp >= MATE_EVAL_SENTINEL) return "詰み";
    if (ownCp <= -MATE_EVAL_SENTINEL) return "詰まされ";
    return ownCp >= 0 ? `+${ownCp}` : String(ownCp);
}

/** 各手番エンジンの最新自己 eval (wire=先手視点) と最新 PV を保持する部分状態。 */
interface LiveEvalState {
    senteEvalCp?: number;
    goteEvalCp?: number;
    latestPv?: string[];
}

/**
 * 1 件の move コメント (ply + eval/pv) を eval 部分状態に畳み込む。
 * ply 奇数 = 先手の指し手・偶数 = 後手の指し手。コメントは指した側のエンジンが
 * 付けるので、その手番側の eval として保持する。eval/pv が無ければ据え置く。
 */
export function applyMoveComment(
    prev: LiveEvalState,
    ply: number,
    comment: { evalCp?: number; pv?: string[] },
): LiveEvalState {
    const isSenteMove = ply % 2 !== 0;
    return {
        senteEvalCp:
            isSenteMove && comment.evalCp !== undefined ? comment.evalCp : prev.senteEvalCp,
        goteEvalCp: !isSenteMove && comment.evalCp !== undefined ? comment.evalCp : prev.goteEvalCp,
        latestPv: comment.pv && comment.pv.length > 0 ? comment.pv : prev.latestPv,
    };
}

/**
 * snapshot の `moveDetails` を畳み込み、各手番の最新 eval・最新 PV・直近消費秒を求める。
 * eval は wire 値 (先手視点) のまま保持し、表示側で後手のみ符号反転する。
 */
export function summarizeMoveDetails(moveDetails: RshogiLiveMove[]): LiveEvalState & {
    lastMoveElapsedSec?: number;
} {
    // ply = i + 1。奇数 = 先手の指し手、偶数 = 後手の指し手。
    const evalState = moveDetails.reduce<LiveEvalState>(
        (acc, detail, i) => (detail.comment ? applyMoveComment(acc, i + 1, detail.comment) : acc),
        {},
    );
    const last = moveDetails[moveDetails.length - 1];
    return { ...evalState, lastMoveElapsedSec: last?.elapsedSec };
}

/**
 * 詰みセンチネルを moveData (棋譜評価値カラム / 評価値グラフ) 用に丸める値 (cp)。
 *
 * ## 詰みセンチネルの扱い (設計判断)
 * wire は詰みを `±100000` センチネルで符号化するだけで **詰み手数を持たない**
 * (rshogi は mate-in-N を潰す)。これを `evalMate=±1` として渡すと `formatEval` /
 * `getEvalTooltipInfo` が「+詰1」「1手詰み」と **存在しない手数を偽って** 表示して
 * しまうため、`evalMate` は設定しない (手数を捏造しない)。
 * かつ `evalCp=±100000` を素通しすると EvalGraph の autoscale が ±100000 級に
 * 引き伸ばされ、通常の評価値 (数百 cp) が全て中央線に潰れてグラフが死ぬ。
 * そこでセンチネルは ±2000 (グラフの見やすい決定的優勢域) に丸めて `evalCp` に
 * 格納する。詰みに近い決定的優勢を、捏造した手数なしに・グラフを潰さずに伝える。
 */
const MATE_DISPLAY_EVAL_CP = 2000;

/** wire eval (先手視点) の詰みセンチネル ±100000 を表示用 ±2000 に丸める。 */
function clampWireEvalForDisplay(evalCp: number | undefined): number | undefined {
    if (evalCp === undefined) return undefined;
    if (evalCp >= MATE_EVAL_SENTINEL) return MATE_DISPLAY_EVAL_CP;
    if (evalCp <= -MATE_EVAL_SENTINEL) return -MATE_DISPLAY_EVAL_CP;
    return evalCp;
}

/**
 * elapsedSec と wire eval (先手視点) から `initialReview.moveData` の 1 手分を作る
 * (両方無ければ undefined)。moves と同じ index で対応する。
 * 詰みセンチネルの丸めは {@link MATE_DISPLAY_EVAL_CP} を参照。
 */
function toMoveEval(elapsedSec: number, evalCp: number | undefined): ReviewMoveEval | undefined {
    const elapsedMs = elapsedSec > 0 ? elapsedSec * 1000 : undefined;
    if (elapsedMs === undefined && evalCp === undefined) return undefined;
    return { elapsedMs, evalCp: clampWireEvalForDisplay(evalCp) };
}

/** snapshot の moveDetails を moves と同順・同長の付随情報配列 (moveData) に変換する。 */
export function moveDetailsToEvals(details: RshogiLiveMove[]): (ReviewMoveEval | undefined)[] {
    return details.map((d) => toMoveEval(d.elapsedSec, d.comment?.evalCp));
}

/**
 * broadcast move 到着時に付随情報配列へ 1 手を追加する。
 * この時点では消費秒のみ確定し、eval は直後の onMoveComment で後追いで書き込む。
 */
export function appendMoveEval(
    prev: (ReviewMoveEval | undefined)[],
    elapsedSec: number,
): (ReviewMoveEval | undefined)[] {
    return [...prev, toMoveEval(elapsedSec, undefined)];
}

/**
 * onMoveComment 到着時に該当 ply の付随情報へ eval (先手視点) を後追いで書き込む。
 * ply は 1 始まり。範囲外・eval 無しコメントは配列を据え置く (消費秒は保持)。
 * 詰みセンチネルは snapshot 経路と同じく ±{@link MATE_DISPLAY_EVAL_CP} に丸める。
 */
export function setMoveEvalAtPly(
    prev: (ReviewMoveEval | undefined)[],
    ply: number,
    comment: { evalCp?: number },
): (ReviewMoveEval | undefined)[] {
    const idx = ply - 1;
    if (comment.evalCp === undefined || idx < 0 || idx >= prev.length) return prev;
    const next = prev.slice();
    next[idx] = { ...next[idx], evalCp: clampWireEvalForDisplay(comment.evalCp) };
    return next;
}

const formatMs = (ms: number): string => {
    if (!Number.isFinite(ms) || ms <= 0) return "00:00";
    const totalSec = Math.floor(ms / 1000);
    const min = Math.floor(totalSec / 60);
    const sec = totalSec % 60;
    return `${String(min).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
};

const CONNECTION_LABEL: Record<RshogiLiveConnectionState, string> = {
    connecting: "接続中...",
    connected: "観戦中",
    reconnecting: "再接続中...",
    closed: "切断済み",
};

const CONNECTION_BADGE_CLASS: Record<RshogiLiveConnectionState, string> = {
    connecting: "bg-wafuu-kincha/30 text-wafuu-sumi",
    connected: "bg-wafuu-ai/20 text-wafuu-ai",
    reconnecting: "bg-wafuu-kincha/40 text-wafuu-sumi",
    closed: "bg-muted text-muted-foreground",
};

const RESULT_KIND_LABEL: Record<RshogiGameResult["kind"], string> = {
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

const formatResultText = (meta: RshogiGameMeta | undefined, result: RshogiGameResult): string => {
    const winnerLabel =
        result.winner === "sente"
            ? `先手${meta?.senteName ? ` (${meta.senteName})` : ""} 勝ち`
            : result.winner === "gote"
              ? `後手${meta?.goteName ? ` (${meta.goteName})` : ""} 勝ち`
              : "引き分け";
    const reason = RESULT_KIND_LABEL[result.kind] ?? "終局";
    return `${winnerLabel} (${reason})`;
};

/** 手番側だけ countdown した先手・後手の残時間 (ms)。 */
export function computeRemaining(
    clocks: LiveState["clocks"],
    elapsedSinceAnchor: number,
): { sente: number; gote: number } {
    return {
        sente:
            clocks && clocks.sideToMove === "sente"
                ? Math.max(0, clocks.sente - elapsedSinceAnchor)
                : (clocks?.sente ?? 0),
        gote:
            clocks && clocks.sideToMove === "gote"
                ? Math.max(0, clocks.gote - elapsedSinceAnchor)
                : (clocks?.gote ?? 0),
    };
}

/** スコアボードの片側 (対局者名 + 残時間 + 評価値)。手番側は朱で点灯する。 */
function ScoreboardSide({
    side,
    name,
    remainingMs,
    active,
    ownEvalCp,
}: {
    side: "sente" | "gote";
    name: string;
    remainingMs: number;
    active: boolean;
    /** その手番自身の視点に直した最新評価値 (`+` = その手番が有利)。無ければ非表示。 */
    ownEvalCp?: number;
}): ReactElement {
    const isSente = side === "sente";
    return (
        <div
            className={cn(
                "flex min-w-0 items-center gap-3 px-4 py-3",
                isSente ? "flex-row" : "flex-row-reverse text-right",
            )}
        >
            <span
                className={cn(
                    "flex h-9 w-9 flex-none items-center justify-center rounded-full border border-wafuu-sumi text-lg leading-none",
                    isSente ? "bg-wafuu-sumi text-background" : "bg-wafuu-washi text-wafuu-sumi",
                )}
                aria-hidden="true"
            >
                {isSente ? "☗" : "☖"}
            </span>
            <div className="min-w-0">
                <div className="text-[10px] uppercase tracking-widest text-muted-foreground">
                    {isSente ? "先手" : "後手"}
                </div>
                <div className="truncate text-base font-bold text-wafuu-sumi">
                    {name || (isSente ? "先手" : "後手")}
                </div>
                {ownEvalCp !== undefined && (
                    <div className="text-[11px] font-semibold tabular-nums text-muted-foreground">
                        評価値 {formatOwnEval(ownEvalCp)}
                    </div>
                )}
            </div>
            <div
                className={cn(
                    "flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-2xl font-bold leading-none tabular-nums transition-colors",
                    isSente ? "ml-auto" : "mr-auto",
                    active ? "bg-wafuu-shu/10 text-wafuu-shu" : "text-wafuu-sumi-light",
                )}
            >
                {active && (
                    <span
                        className="h-1.5 w-1.5 flex-none rounded-full bg-wafuu-shu animate-pulse motion-reduce:animate-none"
                        aria-hidden="true"
                    />
                )}
                {formatMs(remainingMs)}
            </div>
        </div>
    );
}

/** 各手番の wire 評価値 (先手視点) を「その手番自身の視点」に直す。 */
function toOwnEval(side: "sente" | "gote", wireEvalCp?: number): number | undefined {
    if (wireEvalCp === undefined) return undefined;
    // wire は常に先手視点 (+ = 先手有利)。先手側はそのまま、後手側は符号反転して
    // 「+ = その手番が有利」に揃える。
    return side === "sente" ? wireEvalCp : -wireEvalCp;
}

/** 対局者・時計・手数・接続状態・評価値を対面表示するブロードキャスト・スコアボード。 */
export function RshogiLiveScoreboard({
    meta,
    moveCount,
    clocks,
    elapsedSinceAnchor,
    connectionState,
    result,
    senteEvalCp,
    goteEvalCp,
    lastMoveElapsedSec,
}: {
    meta: RshogiGameMeta;
    moveCount: number;
    clocks: LiveState["clocks"];
    elapsedSinceAnchor: number;
    connectionState: RshogiLiveConnectionState;
    result?: RshogiGameResult;
    /** wire 評価値 (先手視点)。各手番エンジンの自己申告。無ければ非表示。 */
    senteEvalCp?: number;
    goteEvalCp?: number;
    /** 直近手の消費秒数。無ければ非表示。 */
    lastMoveElapsedSec?: number;
}): ReactElement {
    const remaining = computeRemaining(clocks, elapsedSinceAnchor);
    const isConnected = connectionState === "connected";
    const turnLabel = result
        ? "終局"
        : clocks?.sideToMove === "sente"
          ? "☗ 先手番"
          : clocks?.sideToMove === "gote"
            ? "☖ 後手番"
            : "";
    return (
        <section
            aria-label="対局スコアボード"
            className="grid grid-cols-1 overflow-hidden rounded-xl border border-wafuu-border bg-wafuu-washi-warm shadow-sm sm:grid-cols-[1fr_auto_1fr]"
        >
            <ScoreboardSide
                side="sente"
                name={meta.senteName}
                remainingMs={remaining.sente}
                active={!result && clocks?.sideToMove === "sente"}
                ownEvalCp={toOwnEval("sente", senteEvalCp)}
            />
            <div className="flex flex-row items-center justify-between gap-3 border-y border-wafuu-border bg-wafuu-washi px-4 py-2 sm:min-w-[7.5rem] sm:flex-col sm:justify-center sm:gap-1 sm:border-x sm:border-y-0">
                <span className="text-xl font-bold tabular-nums leading-none text-wafuu-sumi">
                    {moveCount}
                    <span className="ml-0.5 text-xs font-semibold text-muted-foreground">手</span>
                </span>
                {isConnected && !result ? (
                    <span className="inline-flex items-center gap-1.5 rounded-full bg-wafuu-shu/10 px-2.5 py-0.5 text-[11px] font-bold tracking-wider text-wafuu-shu">
                        <span
                            className="h-1.5 w-1.5 rounded-full bg-wafuu-shu animate-pulse motion-reduce:animate-none"
                            aria-hidden="true"
                        />
                        LIVE
                    </span>
                ) : (
                    <span className="rounded-full bg-wafuu-sumi/5 px-2.5 py-0.5 text-[11px] font-semibold text-muted-foreground">
                        {result ? "対局終了" : CONNECTION_LABEL[connectionState]}
                    </span>
                )}
                <span className="text-xs text-muted-foreground">{turnLabel}</span>
                {lastMoveElapsedSec !== undefined && (
                    <span className="text-[11px] tabular-nums text-muted-foreground">
                        直前手 {lastMoveElapsedSec}秒
                    </span>
                )}
            </div>
            <ScoreboardSide
                side="gote"
                name={meta.goteName}
                remainingMs={remaining.gote}
                active={!result && clocks?.sideToMove === "gote"}
                ownEvalCp={toOwnEval("gote", goteEvalCp)}
            />
        </section>
    );
}

/** PV 表示の最大トークン数 (これを超えたら末尾を省略する)。 */
const MAX_PV_TOKENS = 12;

/** 対局 ID・最終結果・最新読み筋を表示する補助パネル (名前/時計はスコアボードに集約)。 */
export function RshogiLiveMetaPanel({
    meta,
    result,
    latestPv,
}: {
    meta: RshogiGameMeta;
    result?: RshogiGameResult;
    /** 最新コメントの読み筋 (CSA トークン列)。無ければ非表示。 */
    latestPv?: string[];
}): ReactElement {
    // 表示は MAX_PV_TOKENS で省略し、title (ツールチップ) には全文を渡す。
    const pvFullText = latestPv && latestPv.length > 0 ? latestPv.join(" ") : undefined;
    const pvText =
        latestPv && pvFullText
            ? latestPv.slice(0, MAX_PV_TOKENS).join(" ") +
              (latestPv.length > MAX_PV_TOKENS ? " …" : "")
            : undefined;
    return (
        <section
            aria-label="観戦情報"
            className="flex flex-col gap-3 rounded-lg border border-wafuu-border bg-wafuu-washi-warm p-3 text-sm text-wafuu-sumi"
        >
            <div className="flex flex-col gap-1">
                <span className="text-[11px] uppercase tracking-wider text-muted-foreground">
                    対局 ID
                </span>
                <span className="break-all font-mono text-xs text-wafuu-sumi">{meta.gameId}</span>
            </div>
            {pvText && (
                <div className="flex flex-col gap-1">
                    <span className="text-[11px] uppercase tracking-wider text-muted-foreground">
                        読み筋
                    </span>
                    <span
                        className="truncate font-mono text-xs text-muted-foreground"
                        title={pvFullText}
                    >
                        {pvText}
                    </span>
                </div>
            )}
            {result && (
                <div className="rounded-md border border-wafuu-shu/40 bg-wafuu-shu/10 px-2.5 py-1.5 text-sm font-semibold text-wafuu-shu">
                    {formatResultText(meta, result)}
                </div>
            )}
        </section>
    );
}

export function RshogiCsaLiveViewer({
    gameId,
    engineOptions,
    manifestUrl,
    apiBaseUrl,
    header,
    aiIconUrl,
    fetchLegalMoves,
    onRequestNnueFilePath,
    isDevMode,
}: RshogiCsaLiveViewerProps): ReactElement {
    const [state, setState] = useState<LiveState>(initialLiveState);
    /** 現在の購読セッション。終局時に明示 disconnect して再接続を止めるために保持する。 */
    const sessionRef = useRef<RshogiLiveSession | null>(null);
    /** clock countdown 用の現在時刻 (1Hz 更新)。 */
    const [tickMs, setTickMs] = useState<number>(() => Date.now());

    useEffect(() => {
        // gameId / apiBaseUrl が変わったら state をリセットして再購読。
        setState(initialLiveState);
        setTickMs(Date.now());
        const callbacks: RshogiLiveCallbacks = {
            onSnapshot(snapshot) {
                const summary = summarizeMoveDetails(snapshot.moveDetails);
                setState((prev) => ({
                    ...prev,
                    snapshot,
                    moves: snapshot.moves,
                    // snapshot は全置換。全手分の付随情報 (moveData) も moveDetails から再導出。
                    moveEvals: moveDetailsToEvals(snapshot.moveDetails),
                    result: snapshot.finalResult ?? prev.result,
                    snapshotEpoch: prev.snapshotEpoch + 1,
                    clocks: snapshot.clocks,
                    clockAnchorAtMs: Date.now(),
                    lastError: undefined,
                    // snapshot は全置換なので eval/PV/消費秒も moveDetails から再導出する。
                    senteEvalCp: summary.senteEvalCp,
                    goteEvalCp: summary.goteEvalCp,
                    latestPv: summary.latestPv,
                    lastMoveElapsedSec: summary.lastMoveElapsedSec,
                }));
            },
            onMove({ csaMove, elapsedSec }) {
                setState((prev) => ({
                    ...prev,
                    moves: [...prev.moves, csaMove],
                    // 新規手を付随情報配列にも追加 (この時点では消費秒のみ、eval は後追い)。
                    moveEvals: appendMoveEval(prev.moveEvals, elapsedSec),
                    // broadcast move 到着時に手番側を切り替える (= clock の anchor も
                    // 更新してロジックを単純化する。サーバから次 snapshot が来たら
                    // 上書きされる)。
                    clocks: prev.clocks
                        ? {
                              sente:
                                  prev.clocks.sideToMove === "sente"
                                      ? Math.max(
                                            0,
                                            prev.clocks.sente -
                                                (Date.now() - (prev.clockAnchorAtMs ?? Date.now())),
                                        )
                                      : prev.clocks.sente,
                              gote:
                                  prev.clocks.sideToMove === "gote"
                                      ? Math.max(
                                            0,
                                            prev.clocks.gote -
                                                (Date.now() - (prev.clockAnchorAtMs ?? Date.now())),
                                        )
                                      : prev.clocks.gote,
                              sideToMove: prev.clocks.sideToMove === "sente" ? "gote" : "sente",
                          }
                        : prev.clocks,
                    clockAnchorAtMs: Date.now(),
                    lastMoveElapsedSec: elapsedSec,
                }));
            },
            onMoveComment({ ply, comment }) {
                setState((prev) => ({
                    ...prev,
                    ...applyMoveComment(prev, ply, comment),
                    // 該当 ply の付随情報へ eval を後追いで書き込む (scoreboard とは独立)。
                    moveEvals: setMoveEvalAtPly(prev.moveEvals, ply, comment),
                }));
            },
            onClock({ remainingMs, sideToMove }) {
                setState((prev) => ({
                    ...prev,
                    clocks: { sente: remainingMs.sente, gote: remainingMs.gote, sideToMove },
                    clockAnchorAtMs: Date.now(),
                }));
            },
            onEnd(result) {
                setState((prev) => ({ ...prev, result }));
            },
            onConnectionState(connState) {
                setState((prev) => ({ ...prev, connectionState: connState }));
            },
            onError(err) {
                setState((prev) => ({ ...prev, lastError: err.message }));
            },
        };
        let session: RshogiLiveSession | null = null;
        try {
            session = subscribeRshogiLiveGame(gameId, { apiBaseUrl }, callbacks);
        } catch (err) {
            setState((prev) => ({
                ...prev,
                lastError: err instanceof Error ? err.message : String(err),
                connectionState: "closed",
            }));
        }
        sessionRef.current = session;
        return () => {
            session?.disconnect();
            sessionRef.current = null;
        };
    }, [gameId, apiBaseUrl]);

    // 終局が確定したら購読を明示的に閉じる。終局済 DO は「接続成功→即 close」を
    // 繰り返すことがあり、これを止めないと connected↔reconnecting を往復し続ける。
    useEffect(() => {
        if (state.result) {
            sessionRef.current?.disconnect();
        }
    }, [state.result]);

    // clock countdown 用の 1Hz tick。終局後・clock 未取得時は止めて無駄な再描画を抑える。
    useEffect(() => {
        if (state.result || !state.clocks) return;
        const id = setInterval(() => {
            setTickMs(Date.now());
        }, 500);
        return () => {
            clearInterval(id);
        };
    }, [state.result, state.clocks]);

    const elapsedSinceAnchor =
        state.clockAnchorAtMs !== null ? Math.max(0, tickMs - state.clockAnchorAtMs) : 0;

    if (!state.snapshot) {
        // 初回 snapshot 受信前のローディング表示。
        // `packages/ui/AGENTS.md` の規約に従い、コンポーネント自身は margin
        // (`mx-auto` 等) を持たず、配置は親側に任せる。
        return (
            <div className="flex max-w-[480px] flex-col gap-2 px-4 py-10 text-sm text-muted-foreground">
                {header}
                <div className="flex items-center gap-2">
                    <span
                        className={`rounded px-2 py-0.5 text-xs ${CONNECTION_BADGE_CLASS[state.connectionState]}`}
                    >
                        {CONNECTION_LABEL[state.connectionState]}
                    </span>
                    <span>対局 ID: {gameId}</span>
                </div>
                <p>初期 snapshot を待機中...</p>
                {state.lastError && <p className="text-destructive">エラー: {state.lastError}</p>}
            </div>
        );
    }

    const meta = state.snapshot.meta;
    // key は snapshotEpoch のみ。broadcast move では key を変えず初期 review prop の
    // 更新で反映するため、`<ShogiMatch>` を毎手 remount せずちらつきが起きない。
    const matchKey = String(state.snapshotEpoch);

    return (
        <div className="flex flex-col gap-2">
            {header}
            {/* エラーは終局前の確定 closed 時のみ表示する。reconnect 中に出し入れすると
                行の出現でレイアウトシフトが連発するため、振動する状態では出さない。 */}
            {!state.result && state.connectionState === "closed" && state.lastError && (
                <div className="px-4 pt-2 text-xs text-destructive">{state.lastError}</div>
            )}
            <ShogiMatch
                key={matchKey}
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
                initialReview={{
                    sfen: "startpos",
                    moves: state.moves,
                    // 各手の評価値・消費秒。棋譜評価値カラム・評価値グラフを点灯させる。
                    moveData: state.moveEvals,
                }}
                reviewMode={true}
                // 観戦は表示設定を別名前空間で扱い、棋譜評価値カラムを既定 ON にする。
                spectateMode={true}
                reviewTopContent={
                    <RshogiLiveScoreboard
                        meta={meta}
                        moveCount={state.moves.length}
                        clocks={state.clocks}
                        elapsedSinceAnchor={elapsedSinceAnchor}
                        connectionState={state.connectionState}
                        result={state.result}
                        senteEvalCp={state.senteEvalCp}
                        goteEvalCp={state.goteEvalCp}
                        lastMoveElapsedSec={state.lastMoveElapsedSec}
                    />
                }
                reviewLeftContent={
                    <RshogiLiveMetaPanel
                        meta={meta}
                        result={state.result}
                        latestPv={state.latestPv}
                    />
                }
            />
        </div>
    );
}
