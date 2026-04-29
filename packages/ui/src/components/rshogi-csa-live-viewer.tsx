/**
 * rshogi 進行中対局 (live spectate) viewer。
 *
 * 静的単局 viewer (`RshogiCsaViewer`) と異なり、`subscribeRshogiLiveGame` を介して
 * WebSocket で server から snapshot + broadcast move を受信し、画面を逐次更新する。
 *
 * MVP では以下に絞る:
 * - 接続状態バナー (connecting / connected / reconnecting / closed) を画面上部に表示
 * - snapshot 受信時は state 全置換、`<ShogiMatch>` の `key` を bump して remount
 * - broadcast move 受信時も累計 moves を拡張して remount し UI を再生
 * - clock countdown は `Black/White_Time_Remaining_Ms:` を anchor に local timer
 *   で減算 (1Hz 程度、`requestAnimationFrame` ではなく `setInterval` で十分)
 * - 終局時に最終結果を表示
 */

import {
    type RshogiGameMeta,
    type RshogiGameResult,
    type RshogiLiveCallbacks,
    type RshogiLiveConnectionState,
    type RshogiLiveSession,
    type RshogiLiveSnapshot,
    subscribeRshogiLiveGame,
} from "@shogi/match-client";
import { type ReactElement, type ReactNode, useEffect, useState } from "react";
import { ShogiMatch } from "./shogi-match";
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
    /** 表示中の対局結果 (終局後)。 */
    result?: RshogiGameResult;
    /** snapshot 適用ごとに増えるカウンタ。`<ShogiMatch>` の key bump に使う。 */
    snapshotEpoch: number;
    /** broadcast move 適用ごとに増えるカウンタ (snapshot epoch と組合せて key 生成)。 */
    moveEpoch: number;
    /** 最後に server から受け取った clock 残時間 (ms)。 */
    clocks: { sente: number; gote: number; sideToMove: "sente" | "gote" } | null;
    /** clock を local timer で減算するための anchor (ms epoch)。 */
    clockAnchorAtMs: number | null;
    connectionState: RshogiLiveConnectionState;
    /** 直近の (致命的でない) エラー文言。 */
    lastError?: string;
}

const initialLiveState: LiveState = {
    snapshot: null,
    moves: [],
    snapshotEpoch: 0,
    moveEpoch: 0,
    clocks: null,
    clockAnchorAtMs: null,
    connectionState: "connecting",
};

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

function RshogiLiveMetaPanel({
    meta,
    moves,
    clocks,
    elapsedSinceAnchor,
    result,
}: {
    meta: RshogiGameMeta;
    moves: string[];
    clocks: LiveState["clocks"];
    elapsedSinceAnchor: number;
    result?: RshogiGameResult;
}): ReactElement {
    // 手番側だけ countdown する (相手側は anchor 値を据え置き表示)。
    const senteRemainingMs =
        clocks && clocks.sideToMove === "sente"
            ? Math.max(0, clocks.sente - elapsedSinceAnchor)
            : (clocks?.sente ?? 0);
    const goteRemainingMs =
        clocks && clocks.sideToMove === "gote"
            ? Math.max(0, clocks.gote - elapsedSinceAnchor)
            : (clocks?.gote ?? 0);
    return (
        <section
            aria-label="観戦情報"
            className="flex flex-col gap-2 rounded-lg border border-wafuu-border bg-wafuu-washi-warm p-3 text-sm text-wafuu-sumi"
        >
            <div className="flex flex-col gap-1">
                <span className="text-xs text-muted-foreground">対局 ID</span>
                <span className="font-mono text-xs text-wafuu-sumi">{meta.gameId}</span>
            </div>
            <div className="flex flex-col gap-1">
                <span className="text-xs text-muted-foreground">対局者</span>
                <span className="text-sm font-semibold">
                    ☗ {meta.senteName || "先手"} vs ☖ {meta.goteName || "後手"}
                </span>
            </div>
            {clocks && (
                <div className="flex flex-col gap-0.5 text-sm">
                    <span
                        className={
                            clocks.sideToMove === "sente" ? "font-semibold text-wafuu-shu" : ""
                        }
                    >
                        ☗ 残り {formatMs(senteRemainingMs)}
                    </span>
                    <span
                        className={
                            clocks.sideToMove === "gote" ? "font-semibold text-wafuu-shu" : ""
                        }
                    >
                        ☖ 残り {formatMs(goteRemainingMs)}
                    </span>
                </div>
            )}
            <div className="text-xs text-muted-foreground">手数: {moves.length}</div>
            {result && (
                <div className="rounded border border-wafuu-shu/40 bg-wafuu-shu/10 px-2 py-1 text-sm font-semibold text-wafuu-shu">
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
    /** clock countdown 用の現在時刻 (1Hz 更新)。 */
    const [tickMs, setTickMs] = useState<number>(() => Date.now());

    useEffect(() => {
        // gameId / apiBaseUrl が変わったら state をリセットして再購読。
        setState(initialLiveState);
        setTickMs(Date.now());
        const callbacks: RshogiLiveCallbacks = {
            onSnapshot(snapshot) {
                setState((prev) => ({
                    ...prev,
                    snapshot,
                    moves: snapshot.moves,
                    result: snapshot.finalResult ?? prev.result,
                    snapshotEpoch: prev.snapshotEpoch + 1,
                    moveEpoch: 0,
                    clocks: snapshot.clocks,
                    clockAnchorAtMs: Date.now(),
                    lastError: undefined,
                }));
            },
            onMove({ csaMove }) {
                setState((prev) => ({
                    ...prev,
                    moves: [...prev.moves, csaMove],
                    moveEpoch: prev.moveEpoch + 1,
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
        return () => {
            session?.disconnect();
        };
    }, [gameId, apiBaseUrl]);

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
    // snapshot ごとに `<ShogiMatch>` を remount し、broadcast move 到着時にも
    // 累計手で再 import するため moveEpoch も key に含める。
    const matchKey = `${state.snapshotEpoch}-${state.moveEpoch}`;

    return (
        <div className="flex flex-col gap-2">
            {header}
            <div className="flex flex-wrap items-center gap-2 px-4 pt-2 text-xs">
                <span
                    className={`rounded px-2 py-0.5 ${CONNECTION_BADGE_CLASS[state.connectionState]}`}
                >
                    {CONNECTION_LABEL[state.connectionState]}
                </span>
                {state.lastError && <span className="text-destructive">{state.lastError}</span>}
            </div>
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
                initialReview={{ sfen: "startpos", moves: state.moves }}
                reviewMode={true}
                reviewLeftContent={
                    <RshogiLiveMetaPanel
                        meta={meta}
                        moves={state.moves}
                        clocks={state.clocks}
                        elapsedSinceAnchor={elapsedSinceAnchor}
                        result={state.result}
                    />
                }
            />
        </div>
    );
}
