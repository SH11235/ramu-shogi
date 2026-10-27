import type { ReactElement } from "react";
import { useEffect, useRef } from "react";

// ダイアログを閉じた瞬間に下の棋譜ナビがずれないよう、終局したら高さを確保しておき、
// 閉じたときだけ見せる。押したボタンはダイアログごと消えるので、開き直すボタンへ
// フォーカスを移す。スクロールさせると見ようとした盤が画面の外へ押し出される
export function GameResultStrip({
    shown,
    text,
    onReopen,
}: {
    shown: boolean;
    text: string;
    onReopen: () => void;
}): ReactElement {
    const buttonRef = useRef<HTMLButtonElement>(null);
    useEffect(() => {
        if (shown) buttonRef.current?.focus({ preventScroll: true });
    }, [shown]);
    return (
        <div
            aria-hidden={!shown}
            className={`flex w-full max-w-md items-center justify-between gap-3 self-center rounded-lg border border-border bg-card px-3 py-2 ${shown ? "" : "invisible"}`}
        >
            <p className="text-sm font-semibold text-foreground">{text}</p>
            <button
                ref={buttonRef}
                type="button"
                onClick={onReopen}
                className="shrink-0 rounded-md bg-secondary px-3 py-1.5 text-xs font-semibold text-secondary-foreground hover:bg-secondary/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
                結果を表示
            </button>
        </div>
    );
}
