import { expect, type Locator, type Page, test } from "@playwright/test";

// サーバー（API）が無くても描ける画面を、PC とスマホで撮る。
const VIEWPORTS = {
    pc: { width: 1280, height: 800 },
    mobile: { width: 375, height: 812 },
} as const;

// 駒の取り合いがあり、両者に持ち駒がある短い棋譜。
const KIFU_WITH_HANDS = "+7776FU\n-3334FU\n+8822UM\n-3122GI\n+0055KA";

interface Scene {
    name: string;
    open: (page: Page) => Promise<void>;
    /** 端末ごとに変わる部分（ブラウザの保存容量など）。塗りつぶして比べる。 */
    mask?: (page: Page) => Locator[];
}

const gotoAndWait =
    (path: string, ready: (page: Page) => Promise<unknown>) => async (page: Page) => {
        await page.goto(path);
        await ready(page);
    };

const openStudyAtEnd = async (page: Page): Promise<void> => {
    await page.goto("/studies");
    await page.getByRole("textbox", { name: "棋譜のテキスト" }).fill(KIFU_WITH_HANDS);
    await page.getByRole("button", { name: "研究ノートにする" }).click();
    await page.waitForURL(/\/studies\/[^/]+$/);
    await page.getByRole("button", { name: "最後の局面へ" }).first().click();
};

const SCENES: Scene[] = [
    {
        name: "landing",
        open: gotoAndWait("/", (p) => p.getByRole("heading", { level: 1 }).waitFor()),
    },
    {
        name: "play-setup",
        open: gotoAndWait("/play", (p) =>
            p.getByRole("button", { name: "対局開始", exact: true }).waitFor(),
        ),
    },
    {
        name: "play-settings",
        open: async (page) => {
            await page.goto("/play");
            await page.getByRole("button", { name: "詳細設定", exact: true }).click();
            await page.getByRole("dialog").waitFor();
        },
    },
    {
        name: "studies",
        open: gotoAndWait("/studies", (p) =>
            p.getByRole("button", { name: "研究ノートにする" }).waitFor(),
        ),
    },
    { name: "study-note", open: openStudyAtEnd },
    {
        name: "nnue",
        open: gotoAndWait("/nnue", (p) => p.getByRole("heading", { name: /^RAMU / }).waitFor()),
        mask: (p) => [p.getByText(/このブラウザに保存している AI/)],
    },
    {
        name: "privacy",
        open: gotoAndWait("/privacy", (p) => p.getByRole("heading").first().waitFor()),
    },
    {
        name: "dog-sounds",
        open: gotoAndWait("/dog-sounds", (p) => p.getByRole("heading").first().waitFor()),
    },
    { name: "auth", open: gotoAndWait("/auth", (p) => p.getByRole("heading").first().waitFor()) },
    {
        name: "online",
        open: gotoAndWait("/online", (p) => p.getByRole("heading").first().waitFor()),
    },
];

for (const [device, viewport] of Object.entries(VIEWPORTS)) {
    for (const scene of SCENES) {
        test(`${scene.name} ${device}`, async ({ page }) => {
            await page.setViewportSize(viewport);
            await scene.open(page);
            // API の再試行や開発サーバーの接続があるので networkidle は来ない。フォントと画像を待つ。
            await page.evaluate(async () => {
                await document.fonts.ready;
                await Promise.all(
                    [...document.images].map((img) =>
                        img.complete ? null : img.decode().catch(() => null),
                    ),
                );
            });
            await expect(page).toHaveScreenshot(`${scene.name}-${device}.png`, {
                fullPage: true,
                mask: scene.mask?.(page),
            });
        });
    }
}
