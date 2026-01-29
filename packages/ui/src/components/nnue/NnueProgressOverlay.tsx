import type { ReactElement } from "react";
import { Progress } from "../progress";
import { Spinner } from "../spinner";

interface NnueProgressOverlayProps {
    /** 表示するかどうか */
    visible: boolean;
    /** 進捗値 (0-100)。undefined の場合は不確定モード */
    progress?: number;
    /** メッセージ */
    message?: string;
}

/**
 * NNUE インポート/ロード進捗オーバーレイ
 */
export function NnueProgressOverlay({
    visible,
    progress,
    message = "処理中...",
}: NnueProgressOverlayProps): ReactElement | null {
    if (!visible) return null;

    return (
        <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-4 rounded-md bg-background/90">
            <Spinner size="lg" label={message} />
            <div className="font-medium text-foreground">{message}</div>
            {progress !== undefined && (
                <div className="w-[200px]">
                    <Progress value={progress} />
                    <div className="mt-2 text-center text-[13px] text-muted-foreground">
                        {Math.round(progress)}%
                    </div>
                </div>
            )}
        </div>
    );
}
