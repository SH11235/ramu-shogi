import type { Config } from "tailwindcss";
import animate from "tailwindcss-animate";

const preset: Omit<Config, "content"> = {
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
                card: "hsl(var(--card))",
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
                // ラム（トイプードル）の毛色
                ram: {
                    fur: "hsl(var(--ram-fur))",
                    "fur-deep": "hsl(var(--ram-fur-deep))",
                    cream: "hsl(var(--ram-cream))",
                    ink: "hsl(var(--ram-ink))",
                },
                // 接続状態・成功状態
                status: {
                    online: "hsl(var(--status-online))",
                    "online-bg": "hsl(var(--status-online-bg))",
                    "online-border": "hsl(var(--status-online-border))",
                    success: "hsl(var(--status-success))",
                    "success-fg": "hsl(var(--status-success-fg))",
                    "success-bg": "hsl(var(--status-success-bg))",
                    "success-border": "hsl(var(--status-success-border))",
                    warning: "hsl(var(--status-warning))",
                    "warning-bg": "hsl(var(--status-warning-bg))",
                    "warning-border": "hsl(var(--status-warning-border))",
                },
                // モーダルの後ろを暗くする幕。light は盤を見せたまま結果を出すシート用
                overlay: {
                    DEFAULT: "hsl(var(--overlay) / 0.7)",
                    light: "hsl(var(--overlay) / 0.3)",
                },
                // 研究ノートの注目局面（悪手・疑問手）
                study: {
                    blunder: "hsl(var(--study-blunder))",
                    "blunder-bg": "hsl(var(--study-blunder-bg))",
                    "blunder-border": "hsl(var(--study-blunder-border))",
                    dubious: "hsl(var(--study-dubious))",
                    "dubious-bg": "hsl(var(--study-dubious-bg))",
                    "dubious-border": "hsl(var(--study-dubious-border))",
                },
                // 将棋盤配色
                shogi: {
                    border: "hsl(var(--shogi-border))",
                    "cell-light": "hsl(var(--shogi-cell-light))",
                    "cell-dark": "hsl(var(--shogi-cell-dark))",
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
                // 見出し・和の顔（明朝系）
                display: ["var(--font-display)", "serif"],
                // 評価値・秒読み・手数など桁を揃える数値
                mono: ["var(--font-mono)", "ui-monospace", "monospace"],
            },
            boxShadow: {
                card: "0 20px 25px -5px rgba(15, 23, 42, 0.08), 0 10px 10px -5px rgba(15, 23, 42, 0.04)",
                // 画面の上に浮く小窓（エンジンのログ、再起動中の表示など）
                panel: "0 14px 28px rgba(0, 0, 0, 0.12)",
                // ダイアログ
                modal: "0 24px 70px rgba(0, 0, 0, 0.35)",
            },
            dropShadow: {
                // 盤と駒台の駒
                piece: "0 2px 4px rgba(0, 0, 0, 0.15)",
            },
            // 画面全体に重なる層の順番。ページ内の重なり（z-10〜40）より上に置く。
            // ポップオーバー類はダイアログや小窓の中からも開くので、それらより上にする。
            zIndex: {
                overlay: "50",
                modal: "51",
                window: "60",
                popover: "70",
                blocking: "90",
                drag: "100",
            },
        },
    },
    plugins: [animate],
};

export default preset;
