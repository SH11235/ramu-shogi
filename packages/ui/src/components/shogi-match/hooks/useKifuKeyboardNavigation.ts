/**
 * 棋譜キーボード・ホイールナビゲーションフック
 *
 * キーボードの矢印キーとマウスホイールで棋譜をナビゲート
 * 対局中は無効化される
 */

import { useEffect, useEffectEvent } from "react";

interface UseKifuKeyboardNavigationOptions {
    /** 1手進む */
    onForward: () => void;
    /** 1手戻る */
    onBack: () => void;
    /** 最初へ */
    onToStart: () => void;
    /** 最後へ */
    onToEnd: () => void;
    /** ナビゲーション無効化（対局中など） */
    disabled?: boolean;
    /** ホイールイベントを受け取るコンテナ要素 */
    containerRef?: React.RefObject<HTMLElement | null>;
    /** マウスホイールナビゲーションを有効にするか（デフォルト: true） */
    enableWheelNavigation?: boolean;
}

/**
 * 棋譜のキーボード・ホイールナビゲーションを提供するフック
 *
 * - ←/↑: 1手戻る
 * - →/↓: 1手進む
 * - Home: 開始局面へ
 * - End: 最終局面へ
 * - マウスホイール上: 1手戻る
 * - マウスホイール下: 1手進む
 */
export function useKifuKeyboardNavigation({
    onForward,
    onBack,
    onToStart,
    onToEnd,
    disabled = false,
    containerRef,
    enableWheelNavigation = true,
}: UseKifuKeyboardNavigationOptions): void {
    // キーボードイベントハンドラ
    const handleKeyDown = useEffectEvent((event: KeyboardEvent) => {
        if (disabled) return;

        // 入力フィールドにフォーカスがある場合は無視
        const target = event.target as HTMLElement;
        if (
            target.tagName === "INPUT" ||
            target.tagName === "TEXTAREA" ||
            target.isContentEditable
        ) {
            return;
        }

        switch (event.key) {
            case "ArrowLeft":
            case "ArrowUp":
                event.preventDefault();
                onBack();
                break;
            case "ArrowRight":
            case "ArrowDown":
                event.preventDefault();
                onForward();
                break;
            case "Home":
                event.preventDefault();
                onToStart();
                break;
            case "End":
                event.preventDefault();
                onToEnd();
                break;
        }
    });

    // ホイールイベントハンドラ
    const handleWheel = useEffectEvent((event: WheelEvent) => {
        if (disabled) return;

        // 縦スクロールのみ処理
        if (Math.abs(event.deltaY) < Math.abs(event.deltaX)) return;

        event.preventDefault();

        if (event.deltaY > 0) {
            // 下にスクロール = 1手進む
            onForward();
        } else if (event.deltaY < 0) {
            // 上にスクロール = 1手戻る
            onBack();
        }
    });

    // キーボードイベントの登録（document全体）
    useEffect(() => {
        document.addEventListener("keydown", handleKeyDown);
        return () => {
            document.removeEventListener("keydown", handleKeyDown);
        };
    }, []);

    // ホイールイベントの登録（コンテナ要素）
    // passive: false を指定してpreventDefaultを有効化
    // スクロール動作を棋譜ナビゲーションに置き換えるため
    useEffect(() => {
        if (!enableWheelNavigation) return;
        const container = containerRef?.current;
        if (!container) return;

        container.addEventListener("wheel", handleWheel, { passive: false });
        return () => {
            container.removeEventListener("wheel", handleWheel);
        };
    }, [containerRef, enableWheelNavigation]);
}
