import preset from "@shogi/design-system/tailwind.preset";
import type { Config } from "tailwindcss";

export default {
    presets: [preset],
    // Storybook の story は配信しないので、そこにしか無いクラスを本番の CSS に入れない。
    content: [
        "./src/**/*.{ts,tsx}",
        "./index.html",
        "../../packages/ui/src/**/*.{ts,tsx}",
        "!../../packages/ui/src/**/*.stories.tsx",
    ],
} satisfies Config;
