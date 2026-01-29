import type { ReactElement } from "react";
import { Spinner } from "../spinner";

interface EngineRestartingOverlayProps {
    /** 表示するかどうか */
    visible: boolean;
}

/**
 * エンジン再起動中オーバーレイ
 */
export function EngineRestartingOverlay({
    visible,
}: EngineRestartingOverlayProps): ReactElement | null {
    if (!visible) return null;

    return (
        <div className="fixed inset-0 z-[100] flex flex-col items-center justify-center gap-4 bg-black/50">
            <div className="flex flex-col items-center gap-4 rounded-lg bg-card px-12 py-8 shadow-[0_8px_30px_rgba(0,0,0,0.2)]">
                <Spinner size="xl" label="エンジン再起動中" />
                <div className="text-base font-medium text-foreground">エンジン再起動中...</div>
                <div className="text-[13px] text-muted-foreground">しばらくお待ちください</div>
            </div>
        </div>
    );
}
