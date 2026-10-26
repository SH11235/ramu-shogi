import type { ClassValue } from "clsx";
import { clsx } from "clsx";
import { extendTailwindMerge } from "tailwind-merge";

// tailwind.preset.ts で足した名前付きの値。登録しないと tailwind-merge が別の種類のクラス（影の色など）と
// 見なし、className で `z-50` や `shadow-sm` を渡しても既定の値を打ち消さない。
const twMerge = extendTailwindMerge({
    extend: {
        classGroups: {
            z: [{ z: ["overlay", "modal", "window", "popover", "blocking", "drag"] }],
            shadow: [{ shadow: ["card", "panel", "modal"] }],
            "drop-shadow": [{ "drop-shadow": ["piece"] }],
        },
    },
});

export function cn(...inputs: ClassValue[]): string {
    return twMerge(clsx(inputs));
}
