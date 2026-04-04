/**
 * CSA対局メインビュー
 *
 * useCsaGame フックを使用し、対局ステータスに応じた UI を表示する。
 * idle: 設定パネル / connecting: スピナー / waiting: 対局情報 /
 * playing: 盤面+時計+探索情報 / finished: 結果 / error: エラー表示
 */

import { Button } from "@shogi/ui/components/button";
import { Spinner } from "@shogi/ui/components/spinner";
import type { ReactElement } from "react";

import { CsaSettingsPanel } from "./CsaSettingsPanel";
import type { CsaClocks, CsaGameState, CsaSearchInfo, UseCsaGameReturn } from "./useCsaGame";
import { useCsaGame } from "./useCsaGame";

// ─── Props ───

interface CsaGameViewProps {
    onBackToLocal: () => void;
}

// ─── Main Component ───

export function CsaGameView({ onBackToLocal }: CsaGameViewProps): ReactElement {
    const { state, start, stop, reset } = useCsaGame();

    const handleBack = () => {
        reset();
        onBackToLocal();
    };

    return (
        <div className="space-y-4">
            <div className="flex items-center justify-between">
                <h2 className="text-base font-semibold text-wafuu-sumi">CSA通信対局</h2>
                {state.status === "idle" && (
                    <Button variant="ghost" size="sm" onClick={handleBack}>
                        ローカルモードに戻る
                    </Button>
                )}
            </div>

            {renderStatusView(state, { start, stop, reset, onBack: handleBack })}
        </div>
    );
}

// ─── Status-based Rendering ───

function renderStatusView(
    state: CsaGameState,
    actions: {
        start: UseCsaGameReturn["start"];
        stop: UseCsaGameReturn["stop"];
        reset: UseCsaGameReturn["reset"];
        onBack: () => void;
    },
): ReactElement {
    switch (state.status) {
        case "idle":
            return <CsaSettingsPanel onStart={actions.start} />;

        case "connecting":
            return <ConnectingView onStop={actions.stop} />;

        case "waiting":
            return <WaitingView state={state} onStop={actions.stop} />;

        case "playing":
            return <PlayingView state={state} onStop={actions.stop} />;

        case "finished":
            return <FinishedView state={state} onBack={actions.onBack} onReset={actions.reset} />;

        case "error":
            return <ErrorView state={state} onBack={actions.onBack} onReset={actions.reset} />;
    }
}

// ─── Sub Views ───

function ConnectingView({ onStop }: { onStop: () => Promise<void> }): ReactElement {
    return (
        <div className="flex flex-col items-center gap-4 py-12">
            <Spinner size="lg" label="サーバーに接続中..." />
            <p className="text-sm text-muted-foreground">サーバーに接続中...</p>
            <Button variant="outline" onClick={() => onStop()}>
                中断
            </Button>
        </div>
    );
}

function WaitingView({
    state,
    onStop,
}: {
    state: CsaGameState;
    onStop: () => Promise<void>;
}): ReactElement {
    return (
        <div className="space-y-4 py-6">
            <div className="flex flex-col items-center gap-3">
                <Spinner size="md" label="対局待ち中" />
                <p className="text-sm font-medium text-wafuu-sumi">対局待ち中</p>
            </div>
            {state.gameId && (
                <div className="bg-muted/30 rounded-lg p-4 text-xs space-y-1">
                    <InfoRow label="対局ID" value={state.gameId} />
                    <InfoRow
                        label="自分の手番"
                        value={state.myColor === "sente" ? "先手" : "後手"}
                    />
                    <InfoRow label="先手" value={state.senteName ?? "-"} />
                    <InfoRow label="後手" value={state.goteName ?? "-"} />
                </div>
            )}
            <div className="flex justify-center">
                <Button variant="outline" onClick={() => onStop()}>
                    切断
                </Button>
            </div>
        </div>
    );
}

function PlayingView({
    state,
    onStop,
}: {
    state: CsaGameState;
    onStop: () => Promise<void>;
}): ReactElement {
    return (
        <div className="space-y-4">
            {/* 対局者情報 */}
            <div className="flex justify-between items-center text-xs">
                <span className="text-wafuu-sumi font-medium">
                    {state.myColor === "sente" ? "* " : ""}
                    {state.senteName ?? "先手"}
                </span>
                <span className="text-muted-foreground">vs</span>
                <span className="text-wafuu-sumi font-medium">
                    {state.myColor === "gote" ? "* " : ""}
                    {state.goteName ?? "後手"}
                </span>
            </div>

            {/* 時計 */}
            {state.clocks && <ClockDisplay clocks={state.clocks} />}

            {/* 盤面（テキスト表示） */}
            <div className="bg-muted/20 rounded-lg p-3">
                <p className="text-xs text-muted-foreground mb-1">
                    局面 (手数: {state.moves.length})
                </p>
                <pre className="text-xs font-mono text-wafuu-sumi break-all whitespace-pre-wrap">
                    {state.sfen ?? "（初期局面）"}
                </pre>
            </div>

            {/* 指し手履歴（直近5手） */}
            {state.moves.length > 0 && (
                <div className="bg-muted/20 rounded-lg p-3">
                    <p className="text-xs text-muted-foreground mb-1">直近の指し手</p>
                    <div className="flex gap-1 flex-wrap">
                        {recentMoves(state.moves, 5).map(({ moveNum, usi }) => (
                            <span
                                key={`${moveNum}-${usi}`}
                                className="text-xs font-mono bg-muted/40 px-1.5 py-0.5 rounded"
                            >
                                {moveNum}. {usi}
                            </span>
                        ))}
                    </div>
                </div>
            )}

            {/* 探索情報 */}
            {state.searchInfo && <SearchInfoDisplay info={state.searchInfo} />}

            {/* 停止ボタン */}
            <div className="flex justify-center pt-2">
                <Button variant="destructive" onClick={() => onStop()}>
                    対局中断
                </Button>
            </div>
        </div>
    );
}

function FinishedView({
    state,
    onBack,
    onReset,
}: {
    state: CsaGameState;
    onBack: () => void;
    onReset: () => void;
}): ReactElement {
    const resultLabel = formatResult(state.result);

    return (
        <div className="space-y-4 py-6">
            <div className="flex flex-col items-center gap-2">
                <p className="text-lg font-bold text-wafuu-sumi">{resultLabel}</p>
                <p className="text-xs text-muted-foreground">
                    対局数: {state.gamesPlayed} / 手数: {state.moves.length}
                </p>
            </div>

            {/* 対局情報 */}
            <div className="bg-muted/30 rounded-lg p-4 text-xs space-y-1">
                <InfoRow label="対局ID" value={state.gameId ?? "-"} />
                <InfoRow label="先手" value={state.senteName ?? "-"} />
                <InfoRow label="後手" value={state.goteName ?? "-"} />
                {state.recordPath && <InfoRow label="棋譜保存先" value={state.recordPath} />}
            </div>

            <div className="flex justify-center gap-3">
                <Button onClick={onReset}>もう一度接続</Button>
                <Button variant="outline" onClick={onBack}>
                    ローカルモードに戻る
                </Button>
            </div>
        </div>
    );
}

function ErrorView({
    state,
    onBack,
    onReset,
}: {
    state: CsaGameState;
    onBack: () => void;
    onReset: () => void;
}): ReactElement {
    return (
        <div className="space-y-4 py-6">
            <div className="flex flex-col items-center gap-2">
                <p className="text-sm font-semibold text-destructive">エラーが発生しました</p>
                <p className="text-xs text-destructive/80 text-center max-w-md">
                    {state.error ?? "不明なエラー"}
                </p>
            </div>
            <div className="flex justify-center gap-3">
                <Button onClick={onReset}>再試行</Button>
                <Button variant="outline" onClick={onBack}>
                    ローカルモードに戻る
                </Button>
            </div>
        </div>
    );
}

// ─── Display Components ───

function ClockDisplay({ clocks }: { clocks: CsaClocks }): ReactElement {
    return (
        <div className="flex justify-between items-center bg-muted/30 rounded-lg px-4 py-2">
            <div className="text-center">
                <p className="text-[10px] text-muted-foreground">先手</p>
                <p className="text-sm font-mono font-semibold text-wafuu-sumi">
                    {formatTimeMs(clocks.sente_ms)}
                </p>
            </div>
            {clocks.byoyomi_ms > 0 && (
                <div className="text-center">
                    <p className="text-[10px] text-muted-foreground">秒読み</p>
                    <p className="text-xs font-mono text-muted-foreground">
                        {Math.floor(clocks.byoyomi_ms / 1000)}秒
                    </p>
                </div>
            )}
            {clocks.increment_ms > 0 && (
                <div className="text-center">
                    <p className="text-[10px] text-muted-foreground">加算</p>
                    <p className="text-xs font-mono text-muted-foreground">
                        {Math.floor(clocks.increment_ms / 1000)}秒
                    </p>
                </div>
            )}
            <div className="text-center">
                <p className="text-[10px] text-muted-foreground">後手</p>
                <p className="text-sm font-mono font-semibold text-wafuu-sumi">
                    {formatTimeMs(clocks.gote_ms)}
                </p>
            </div>
        </div>
    );
}

function SearchInfoDisplay({ info }: { info: CsaSearchInfo }): ReactElement {
    const score =
        info.score_mate != null
            ? `詰み ${info.score_mate > 0 ? "+" : ""}${info.score_mate}手`
            : info.score_cp != null
              ? `${info.score_cp > 0 ? "+" : ""}${info.score_cp}`
              : "-";

    return (
        <div className="bg-muted/20 rounded-lg p-3 text-xs space-y-1">
            <p className="text-muted-foreground font-medium">探索情報</p>
            <div className="grid grid-cols-3 gap-2">
                <span>
                    深さ: <strong>{info.depth}</strong>
                </span>
                <span>
                    評価値: <strong>{score}</strong>
                </span>
                <span>
                    NPS: <strong>{formatNps(info.nps)}</strong>
                </span>
            </div>
            {info.pv.length > 0 && (
                <p className="font-mono text-[10px] text-muted-foreground truncate">
                    PV: {info.pv.join(" ")}
                </p>
            )}
        </div>
    );
}

// ─── Shared Pieces ───

function InfoRow({ label, value }: { label: string; value: string }): ReactElement {
    return (
        <div className="flex gap-2">
            <span className="text-muted-foreground w-24 shrink-0">{label}:</span>
            <span className="text-wafuu-sumi break-all">{value}</span>
        </div>
    );
}

// ─── Formatters ───

function formatTimeMs(ms: number): string {
    const totalSec = Math.max(0, Math.floor(ms / 1000));
    const min = Math.floor(totalSec / 60);
    const sec = totalSec % 60;
    return `${min}:${sec.toString().padStart(2, "0")}`;
}

function formatNps(nps: number): string {
    if (nps >= 1_000_000) return `${(nps / 1_000_000).toFixed(1)}M`;
    if (nps >= 1_000) return `${(nps / 1_000).toFixed(1)}K`;
    return String(nps);
}

/** 直近 n 手の指し手を、手数付きの配列として返す */
function recentMoves(moves: string[], count: number): { moveNum: number; usi: string }[] {
    const start = Math.max(0, moves.length - count);
    return moves.slice(start).map((usi, offset) => ({
        moveNum: start + offset + 1,
        usi,
    }));
}

function formatResult(result: string | null): string {
    switch (result) {
        case "win":
            return "勝利";
        case "lose":
            return "敗北";
        case "draw":
            return "引き分け";
        case "censored":
            return "中断（検閲）";
        case "interrupted":
            return "中断";
        default:
            return "対局終了";
    }
}
