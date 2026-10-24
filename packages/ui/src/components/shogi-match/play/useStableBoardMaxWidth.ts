import { useLayoutEffect, useState } from "react";

/**
 * スマホの対局画面の盤の幅の上限（px）。ブラウザのバーが出ているときの画面の高さ（svh）から、盤の外の
 * 帯・操作・余白（`reservedPx`）と、下端の余白（ホームバーの分。無ければ 8px）を引く。
 *
 * iPhone ではブラウザのバーを畳む途中で下端の余白（safe-area-inset-bottom）が変わるので、CSS の calc で
 * 決めると、スクロールのたびに盤が一瞬縮む。開いたときに 1 回測り、画面の幅か svh が変わったとき（向きの変更・
 * 画面の分割など。svh はバーの出し入れでは変わらない）だけ測り直す。測れない環境では undefined（呼び出し側の
 * CSS の上限に任せる）。
 */
export function useStableBoardMaxWidth(reservedPx: number, minPx: number): number | undefined {
    const [maxWidth, setMaxWidth] = useState<number>();

    useLayoutEffect(() => {
        let measuredWidth = -1;
        let measuredHeight = -1;
        const measure = () => {
            const probe = document.createElement("div");
            probe.style.cssText =
                "position:fixed;top:0;left:0;visibility:hidden;pointer-events:none;height:100svh;padding-bottom:max(env(safe-area-inset-bottom),8px)";
            document.body.append(probe);
            const style = getComputedStyle(probe);
            const height = Number.parseFloat(style.height);
            const bottomInset = Number.parseFloat(style.paddingBottom);
            probe.remove();
            if (!Number.isFinite(height) || height <= 0 || !Number.isFinite(bottomInset)) return;
            if (window.innerWidth === measuredWidth && height === measuredHeight) return;
            measuredWidth = window.innerWidth;
            measuredHeight = height;
            setMaxWidth(Math.max(minPx, Math.floor(height - reservedPx - bottomInset)));
        };
        measure();
        window.addEventListener("resize", measure);
        return () => window.removeEventListener("resize", measure);
    }, [reservedPx, minPx]);

    return maxWidth;
}
