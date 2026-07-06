import type { Config } from "tailwindcss";
import animate from "tailwindcss-animate";

const preset: Omit<Config, "content"> = {
    darkMode: "selector",
    content: [],
    theme: {
        container: {
            center: true,
            padding: "1.5rem",
            screens: {
                "2xl": "1400px",
            },
        },
        extend: {
            colors: {
                border: "hsl(var(--border))",
                input: "hsl(var(--input))",
                ring: "hsl(var(--ring))",
                background: "hsl(var(--background))",
                foreground: "hsl(var(--foreground))",
                primary: {
                    DEFAULT: "hsl(var(--primary))",
                    foreground: "hsl(var(--primary-foreground))",
                },
                secondary: {
                    DEFAULT: "hsl(var(--secondary))",
                    foreground: "hsl(var(--secondary-foreground))",
                },
                destructive: {
                    DEFAULT: "hsl(var(--destructive))",
                    foreground: "hsl(var(--destructive-foreground))",
                },
                muted: {
                    DEFAULT: "hsl(var(--muted))",
                    foreground: "hsl(var(--muted-foreground))",
                },
                accent: {
                    DEFAULT: "hsl(var(--accent))",
                    foreground: "hsl(var(--accent-foreground))",
                },
                popover: {
                    DEFAULT: "hsl(var(--popover))",
                    foreground: "hsl(var(--popover-foreground))",
                },
                card: {
                    DEFAULT: "hsl(var(--card))",
                    foreground: "hsl(var(--card-foreground))",
                },
                // 和モダン配色
                wafuu: {
                    sumi: "hsl(var(--wafuu-sumi))",
                    "sumi-light": "hsl(var(--wafuu-sumi-light))",
                    shu: "hsl(var(--wafuu-shu))",
                    "shu-light": "hsl(var(--wafuu-shu-light))",
                    "shu-fg": "hsl(var(--wafuu-shu-fg))",
                    ai: "hsl(var(--wafuu-ai))",
                    "ai-light": "hsl(var(--wafuu-ai-light))",
                    "ai-fg": "hsl(var(--wafuu-ai-fg))",
                    kin: "hsl(var(--wafuu-kin))",
                    kincha: "hsl(var(--wafuu-kincha))",
                    washi: "hsl(var(--wafuu-washi))",
                    "washi-warm": "hsl(var(--wafuu-washi-warm))",
                    border: "hsl(var(--wafuu-border))",
                },
                // 接続状態・成功状態
                status: {
                    online: "hsl(var(--status-online))",
                    "online-fg": "hsl(var(--status-online-fg))",
                    "online-bg": "hsl(var(--status-online-bg))",
                    "online-border": "hsl(var(--status-online-border))",
                    success: "hsl(var(--status-success))",
                    "success-fg": "hsl(var(--status-success-fg))",
                    "success-bg": "hsl(var(--status-success-bg))",
                    "success-border": "hsl(var(--status-success-border))",
                    warning: "hsl(var(--status-warning))",
                    "warning-fg": "hsl(var(--status-warning-fg))",
                    "warning-bg": "hsl(var(--status-warning-bg))",
                    "warning-border": "hsl(var(--status-warning-border))",
                },
                // 将棋盤配色
                shogi: {
                    border: "hsl(var(--shogi-border))",
                    "outer-border": "hsl(var(--shogi-outer-border))",
                    "cell-light": "hsl(var(--shogi-cell-light))",
                    "cell-dark": "hsl(var(--shogi-cell-dark))",
                    "piece-text": "hsl(var(--shogi-piece-text))",
                    "piece-bg": "hsl(var(--shogi-piece-bg))",
                    "piece-bg-dark": "hsl(var(--shogi-piece-bg-dark))",
                    "coord-text": "hsl(var(--shogi-coord-text))",
                    "last-move-to": "hsl(var(--shogi-last-move-to))",
                    "last-move-to-ring": "hsl(var(--shogi-last-move-to-ring))",
                    "last-move-from": "hsl(var(--shogi-last-move-from))",
                    "last-move-from-ring": "hsl(var(--shogi-last-move-from-ring))",
                },
            },
            borderRadius: {
                lg: "calc(var(--radius))",
                md: "calc(var(--radius) - 2px)",
                sm: "calc(var(--radius) - 4px)",
            },
            fontFamily: {
                sans: ["var(--font-sans)", "system-ui", "sans-serif"],
                // 見出し・和の顔（明朝系）
                display: ["var(--font-display)", "serif"],
                // 評価値・秒読み・手数など桁を揃える数値
                mono: ["var(--font-mono)", "ui-monospace", "monospace"],
            },
            boxShadow: {
                card: "0 20px 25px -5px rgba(15, 23, 42, 0.08), 0 10px 10px -5px rgba(15, 23, 42, 0.04)",
            },
            keyframes: {
                "accordion-down": {
                    from: { height: "0px" },
                    to: { height: "var(--radix-accordion-content-height)" },
                },
                "accordion-up": {
                    from: { height: "var(--radix-accordion-content-height)" },
                    to: { height: "0px" },
                },
            },
            animation: {
                "accordion-down": "accordion-down 0.2s ease-out",
                "accordion-up": "accordion-up 0.2s ease-out",
            },
        },
    },
    plugins: [animate],
};

export default preset;
