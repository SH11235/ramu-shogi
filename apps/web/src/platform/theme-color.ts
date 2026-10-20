/**
 * スマホのアドレスバーの色（`<meta name="theme-color">`）を、ヘッダーの背景の色に合わせる。
 * 色はデザイントークン（`--wafuu-washi-warm`）から読む。HTML に色を書くと、配色を変えたときに
 * アドレスバーだけ古い色のまま残る。
 */
export function applyThemeColor(root: HTMLElement = document.documentElement): void {
    const token = getComputedStyle(root).getPropertyValue("--wafuu-washi-warm").trim();
    if (!token) return;
    let meta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
    if (!meta) {
        meta = document.createElement("meta");
        meta.name = "theme-color";
        document.head.append(meta);
    }
    meta.content = `hsl(${token})`;
}
