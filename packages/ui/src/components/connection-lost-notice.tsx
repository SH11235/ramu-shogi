import type { ReactElement } from "react";

/** 再接続を諦めた後の案内。canResume は再読み込みで対局者の席へ戻れるとき */
export function ConnectionLostNotice({ canResume }: { canResume: boolean }): ReactElement {
    return (
        <div
            role="alert"
            className="flex flex-col gap-3 rounded-lg border border-border bg-card p-4"
        >
            <p className="text-sm text-foreground">
                {canResume
                    ? "接続が切れました。再読み込みすると元の席に戻れます"
                    : "接続が切れました。再読み込みしてください"}
            </p>
            <button
                type="button"
                onClick={() => window.location.reload()}
                className="rounded-md bg-secondary px-3 py-2 text-sm font-medium text-secondary-foreground shadow-sm hover:bg-secondary/80 transition-colors"
            >
                再読み込み
            </button>
        </div>
    );
}
