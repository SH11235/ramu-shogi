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
        <div className="fixed inset-0 z-blocking flex flex-col items-center justify-center gap-4 bg-overlay">
            <div className="flex flex-col items-center gap-4 rounded-lg bg-card px-12 py-8 shadow-panel">
                <Spinner size="xl" label="エンジン再起動中" />
                <div className="text-base font-medium text-foreground">エンジン再起動中...</div>
                <div className="text-[13px] text-muted-foreground">しばらくお待ちください</div>
            </div>
        </div>
    );
}
