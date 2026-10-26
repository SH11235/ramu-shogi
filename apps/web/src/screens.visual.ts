import { expect, type Locator, type Page, test } from "@playwright/test";

// サーバー（API）が無くても描ける画面を、PC とスマホで撮る。
const VIEWPORTS = {
    pc: { width: 1280, height: 800 },
    mobile: { width: 375, height: 812 },
} as const;

// 駒の取り合いがあり、両者に持ち駒がある短い棋譜。
const KIFU_WITH_HANDS = "+7776FU\n-3334FU\n+8822UM\n-3122GI\n+0055KA";

// AI の一覧（/nnue）や棋譜の一覧は API の応答で中身が変わるので、ここでは撮らない。
interface Scene {
    name: string;
    open: (page: Page) => Promise<void>;
    /** 端末ごとに変わる部分。塗りつぶして比べる。 */
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
    // 幅によって送りのボタンが 2 か所に出ることがある。どちらも同じ操作なので最初のものを押す。
    await page.getByRole("button", { name: "最後の局面へ" }).first().click();
};

// 公開棋譜の画面は API の応答を固定して描く（棋譜を見るだけの盤と、スマホの設定の欄）。
const PUBLIC_GAME_ID = "visual-sample";
const openPublicGame = async (page: Page): Promise<void> => {
    await page.route(`**/api/public/games/${PUBLIC_GAME_ID}`, (route) =>
        route.fulfill({
            json: {
                game: {
                    id: PUBLIC_GAME_ID,
                    roomId: null,
                    source: "online_room",
                    visibility: "public",
                    publicId: PUBLIC_GAME_ID,
                    status: "finished",
                    result: null,
                    participants: [],
                    createdAt: "2026-01-01T00:00:00Z",
                    finishedAt: null,
                    initialSfen: "startpos",
                    metadata: null,
                    moves: ["7g7f", "3c3d", "8h2b+", "3a2b", "B*5e"],
                    kifuText: "",
                    startedAt: null,
                },
            },
        }),
    );
    await page.goto(`/public/games/${PUBLIC_GAME_ID}`);
    await page.getByRole("button", { name: "研究ノートで開く" }).first().waitFor();
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
        name: "play-time-dialog",
        open: async (page) => {
            await page.goto("/play");
            await page.getByRole("button", { name: "指定", exact: true }).click();
            await page.getByRole("dialog").waitFor();
        },
    },
    {
        name: "play-edit",
        open: async (page) => {
            await page.goto("/play");
            await page.getByRole("combobox", { name: "開始局面" }).selectOption("edit");
            await page.getByRole("region", { name: "開始局面の編集" }).waitFor();
        },
    },
    {
        name: "studies",
        open: gotoAndWait("/studies", (p) =>
            p.getByRole("button", { name: "研究ノートにする" }).waitFor(),
        ),
    },
    { name: "study-note", open: openStudyAtEnd },
    { name: "public-game", open: openPublicGame },
    {
        name: "public-game-settings",
        open: async (page) => {
            await openPublicGame(page);
            // 設定の欄はスマホだけにある。PC ではそのまま撮る。
            if ((page.viewportSize()?.width ?? 0) >= 768) return;
            await page.getByRole("button", { name: "設定を開く" }).click();
            await page.getByRole("dialog").waitFor();
        },
    },
    {
        name: "study-analysis-settings",
        open: async (page) => {
            await openStudyAtEnd(page);
            // スマホでは「その他の操作」の中にある。
            const more = page.getByRole("button", { name: "その他の操作" });
            if ((page.viewportSize()?.width ?? 0) < 768) await more.click();
            await page.getByRole("button", { name: /^解析の設定/ }).click();
            await page.getByRole("dialog").waitFor();
        },
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
