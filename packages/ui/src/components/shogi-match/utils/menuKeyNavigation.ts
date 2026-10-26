import type { KeyboardEvent } from "react";

const KIFU_NAVIGATION_KEYS = new Set([
    "ArrowUp",
    "ArrowDown",
    "ArrowLeft",
    "ArrowRight",
    "Home",
    "End",
]);

/**
 * Popover の中のメニューのキー操作。項目は tabIndex=-1 にして上下・Home・End だけで移り、
 * Tab / Shift+Tab ではメニューを閉じる（Popover が開いたボタンへフォーカスを戻す）。
 */
export function handleMenuKeyDown(
    event: KeyboardEvent<HTMLElement>,
    { itemSelector, onClose }: { itemSelector: string; onClose: () => void },
): void {
    if (event.key === "Tab") {
        // Popover は body の末尾に出るので、そのまま Tab を通すとページの末尾へ飛ぶ
        event.preventDefault();
        onClose();
        return;
    }
    // 棋譜の矢印キー送りは document で聞いているので、メニューを開いている間は背後の局面を動かさない
    if (KIFU_NAVIGATION_KEYS.has(event.key)) event.stopPropagation();
    const items = [...event.currentTarget.querySelectorAll<HTMLElement>(itemSelector)];
    const index = items.indexOf(document.activeElement as HTMLElement);
    const target = {
        ArrowDown: items[(index + 1) % items.length],
        ArrowUp: items[(index - 1 + items.length) % items.length],
        Home: items[0],
        End: items[items.length - 1],
    }[event.key];
    if (!target) return;
    event.preventDefault();
    target.focus();
}
