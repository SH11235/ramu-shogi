/**
 * 時間の決まり（秒読み・加算・切れ負け・1 手○秒）の説明。時間の選択肢の見出しの横に「?」で置く。
 * 押して開く（スマホではホバーで出る説明が使えない）。
 */

import { cn } from "@shogi/design-system";
import type { ReactElement } from "react";
import { Popover, PopoverContent, PopoverTrigger } from "../../popover";

const RULES: Array<{ name: string; example: string; text: string }> = [
    {
        name: "秒読み",
        example: "10分 秒読み30秒",
        text: "持ち時間の 10 分を使い切ったら、そこからは 1 手 30 秒以内に指します。",
    },
    {
        name: "加算",
        example: "5分 +10秒",
        text: "1 手指すごとに持ち時間が 10 秒増えます。チェスでよく使う決まりで、フィッシャー方式とも呼びます。",
    },
    {
        name: "切れ負け",
        example: "10分 切れ負け",
        text: "持ち時間を使い切ったら負けです。",
    },
    {
        name: "1 手○秒",
        example: "1手3秒",
        text: "毎手その秒数で指します（AI の考慮時間）。",
    },
];

interface PlayTimeRulesHelpProps {
    /** "icon" は見出しの横の小さな「?」、"text" は「? 時間の決まり」と書いたボタン */
    variant?: "icon" | "text";
    className?: string;
}

export function PlayTimeRulesHelp({
    variant = "icon",
    className,
}: PlayTimeRulesHelpProps): ReactElement {
    return (
        <Popover>
            <PopoverTrigger asChild>
                <button
                    type="button"
                    aria-label="時間の決まりの説明"
                    className={cn(
                        "relative inline-flex shrink-0 items-center justify-center rounded-full border border-wafuu-sumi-light bg-background font-semibold text-wafuu-sumi-light transition-colors hover:bg-wafuu-washi-warm hover:text-wafuu-sumi focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                        // 見た目は小さく、押せる範囲は指の大きさに広げる。
                        "after:absolute after:-inset-3 after:content-['']",
                        variant === "icon" ? "h-5 w-5 text-[11px]" : "h-7 gap-1 px-2.5 text-xs",
                        className,
                    )}
                >
                    ?{variant === "text" && <span className="font-medium">時間の決まり</span>}
                </button>
            </PopoverTrigger>
            <PopoverContent
                align="start"
                collisionPadding={12}
                className="flex w-[min(340px,calc(100vw-24px))] flex-col gap-2.5 text-sm leading-relaxed text-wafuu-sumi"
            >
                <p className="font-semibold">時間の決まり</p>
                <dl className="flex flex-col gap-2">
                    {RULES.map((rule) => (
                        <div key={rule.name}>
                            <dt>
                                <span className="font-semibold">{rule.name}</span>
                                <span className="ml-2 text-xs text-wafuu-sumi-light">
                                    例「{rule.example}」
                                </span>
                            </dt>
                            <dd className="text-xs">{rule.text}</dd>
                        </div>
                    ))}
                </dl>
            </PopoverContent>
        </Popover>
    );
}
