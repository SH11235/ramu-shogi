import type { EngineControllerErrorLog, EngineControllerEvent, Player } from "@shogi/app-core";
import { cn } from "@shogi/design-system";
import { type EngineErrorCode, getEngineErrorInfo } from "@shogi/engine-client";
import { type ReactElement, useState } from "react";
import { formatEngineEventLog } from "../hooks/formatEngineEvent";

const baseCardClassName =
    "w-full rounded-xl border border-border bg-card p-3 shadow-[0_14px_28px_rgba(0,0,0,0.12)]";

interface EngineErrorDetails {
    hasError: boolean;
    errorCode?: EngineErrorCode;
    errorMessage?: string;
    canRetry: boolean;
}

interface EngineLogsPanelProps {
    /** イベントログのリスト */
    eventLogs: EngineControllerEvent[];
    /** エラーログのリスト */
    errorLogs: EngineControllerErrorLog[];
    /** エンジンエラーの詳細情報 */
    engineErrorDetails?: Record<Player, EngineErrorDetails | null>;
    /** リトライコールバック */
    onRetry?: (side: Player) => void;
    /** リトライ中かどうか */
    isRetrying?: Record<Player, boolean>;
}

/** 個別エラー詳細表示コンポーネント */
function ErrorDetailSection({
    side,
    error,
    onRetry,
    isRetrying,
}: {
    side: Player;
    error: EngineErrorDetails;
    onRetry?: (side: Player) => void;
    isRetrying?: boolean;
}): ReactElement | null {
    const [showDetails, setShowDetails] = useState(false);
    const errorInfo = getEngineErrorInfo(error.errorCode);

    return (
        <div className="mb-2 rounded-md bg-background p-3">
            {/* ヘッダー: 側面とメインメッセージ */}
            <div className="mb-2 flex items-center gap-2">
                <span
                    className={cn(
                        "rounded px-2 py-0.5 text-[11px] font-semibold",
                        side === "sente"
                            ? "bg-foreground text-background"
                            : "bg-muted text-foreground",
                    )}
                >
                    {side === "sente" ? "先手" : "後手"}
                </span>
                <span className="text-sm font-semibold">{errorInfo.userMessage}</span>
            </div>

            {/* 考えられる原因 */}
            <div className="mb-2">
                <div className="mb-1 text-xs text-muted-foreground">考えられる原因:</div>
                <ul className="list-disc pl-4 text-xs">
                    {errorInfo.possibleCauses.map((cause) => (
                        <li key={cause} className="mb-0.5">
                            {cause}
                        </li>
                    ))}
                </ul>
            </div>

            {/* 対処法 */}
            <div className="mb-3">
                <div className="mb-1 text-xs text-muted-foreground">対処法:</div>
                <ul className="list-disc pl-4 text-xs">
                    {errorInfo.solutions.map((solution) => (
                        <li key={solution} className="mb-0.5">
                            {solution}
                        </li>
                    ))}
                </ul>
            </div>

            {/* アクションボタン */}
            <div className="flex items-center gap-2">
                {errorInfo.canRetry && onRetry && (
                    <button
                        type="button"
                        onClick={() => onRetry(side)}
                        disabled={isRetrying}
                        className={cn(
                            "rounded-md px-4 py-2 text-[13px] font-medium text-white",
                            isRetrying
                                ? "cursor-not-allowed bg-muted opacity-60"
                                : "cursor-pointer bg-primary",
                        )}
                    >
                        {isRetrying ? "リトライ中..." : "再試行"}
                    </button>
                )}
                <button
                    type="button"
                    onClick={() => setShowDetails(!showDetails)}
                    className="rounded-md border border-border bg-transparent px-3 py-2 text-xs text-muted-foreground hover:text-foreground"
                >
                    {showDetails ? "詳細を隠す" : "詳細を表示"}
                </button>
            </div>

            {/* 技術的な詳細（折りたたみ） */}
            {showDetails && (
                <div className="mt-3 rounded bg-muted p-2 text-[11px] font-mono">
                    <div>エラーコード: {error.errorCode ?? "UNKNOWN"}</div>
                    {error.errorMessage && <div>メッセージ: {error.errorMessage}</div>}
                </div>
            )}
        </div>
    );
}

export function EngineLogsPanel({
    eventLogs,
    errorLogs,
    engineErrorDetails,
    onRetry,
    isRetrying,
}: EngineLogsPanelProps): ReactElement {
    const hasActiveError =
        engineErrorDetails?.sente?.hasError || engineErrorDetails?.gote?.hasError;

    return (
        <div
            className={cn(
                baseCardClassName,
                hasActiveError ? "border-2 border-destructive" : "border-border",
            )}
        >
            <div className="mb-1.5 font-bold">エンジンログ</div>

            {hasActiveError && (
                <div className="mb-2 rounded-md border border-destructive bg-destructive/10 p-3">
                    <div className="mb-3 flex items-center gap-2 text-[15px] font-semibold text-destructive">
                        <span className="text-lg">⚠️</span>
                        エンジンエラー
                    </div>

                    {(["sente", "gote"] as const).map((side) => {
                        const error = engineErrorDetails?.[side];
                        if (!error?.hasError) return null;
                        return (
                            <ErrorDetailSection
                                key={side}
                                side={side}
                                error={error}
                                onRetry={onRetry}
                                isRetrying={isRetrying?.[side]}
                            />
                        );
                    })}
                </div>
            )}

            <ul className="flex max-h-[160px] flex-col gap-1 overflow-auto">
                {eventLogs.map((log) => (
                    <li key={log.id} className="font-mono text-xs">
                        {formatEngineEventLog(log)}
                    </li>
                ))}
            </ul>
            {errorLogs.length ? (
                <div className="mt-2 text-xs text-destructive">{errorLogs[0].message}</div>
            ) : null}
        </div>
    );
}
