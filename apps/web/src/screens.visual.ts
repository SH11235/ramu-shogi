import { expect, type Locator, type Page, type Route, test } from "@playwright/test";

// サーバー（API）が無くても描ける画面を、PC とスマホで撮る。
const VIEWPORTS = {
    pc: { width: 1280, height: 800 },
    mobile: { width: 375, height: 812 },
} as const;

// 駒の取り合いがあり、両者に持ち駒がある短い棋譜。
const KIFU_WITH_HANDS = "+7776FU\n-3334FU\n+8822UM\n-3122GI\n+0055KA";
// 最後の手に対局時の読み筋（CSA の `'**` の注記）が付いた棋譜。読み筋の盤（ダイアログ）を開くのに使う。
const KIFU_WITH_PV = [
    "V2.2",
    "PI",
    "+",
    "+7776FU",
    "-3334FU",
    "+8822UM",
    "-3122GI",
    "+0055KA",
    "'** 50 -0033KA +5533UM -2133KE",
].join("\n");
// 両者に持ち駒がある局面（KIFU_WITH_HANDS の 4 手目のあと）だけを入れた定跡。
const BOOK_KEY_WITH_HANDS = "lnsgkg1nl/1r5s1/pppppp1pp/6p2/9/2P6/PP1PPPPPP/7R1/LNSGKGSNL b Bb";
const BOOK_WITH_HANDS = `#YANEURAOU-DB2016 1.00\nsfen ${BOOK_KEY_WITH_HANDS} 9\nB*5e none 50 20 3\n`;

// AI の一覧（/nnue）や棋譜の一覧は API の応答で中身が変わるので、ここでは撮らない。
interface Scene {
    name: string;
    open: (page: Page) => Promise<void>;
    /** 撮る端末を絞る（省くと全部）。 */
    devices?: readonly (keyof typeof VIEWPORTS)[];
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

const openStudyPv = (flip: boolean) => async (page: Page) => {
    await page.goto("/studies");
    await page.getByRole("textbox", { name: "棋譜のテキスト" }).fill(KIFU_WITH_PV);
    await page.getByRole("button", { name: "研究ノートにする" }).click();
    await page.waitForURL(/\/studies\/[^/]+$/);
    await page.getByRole("button", { name: "最後の局面へ" }).first().click();
    if (flip) await page.getByRole("button", { name: "盤面を反転" }).first().click();
    // スマホでは候補手（対局時の読み筋の欄）を別のタブに出す。
    const candidatesTab = page.getByRole("tab", { name: "候補手" });
    if (await candidatesTab.isVisible()) await candidatesTab.click();
    await page.getByRole("button", { name: "対局時の読み筋を見る" }).click();
    await page.getByRole("dialog").waitFor();
    // 読み筋の 1 手目まで送り、直前の手の印と持ち駒の両方を写す。
    await page.getByRole("dialog").getByRole("button", { name: ">", exact: true }).click();
};

const openBookViewer = (flip: boolean) => async (page: Page) => {
    await page.goto("/book-viewer");
    await page.getByLabel("定跡ファイル").setInputFiles({
        name: "hands.db",
        mimeType: "text/plain",
        buffer: Buffer.from(BOOK_WITH_HANDS),
    });
    await page.getByRole("textbox", { name: "局面キー" }).fill(BOOK_KEY_WITH_HANDS);
    await page.getByRole("button", { name: "局面へ移動" }).click();
    await page.getByRole("region", { name: "指し手一覧" }).getByText("定跡の手").waitFor();
    if (flip) await page.getByRole("button", { name: "盤を反転" }).click();
};

/** 人どうしの対局を始め、マス（`7g` など）や成りの選択（`成る`）を順に押す。 */
const openHumanGame = (clicks: readonly string[]) => async (page: Page) => {
    await page.goto("/play");
    const start = page.getByRole("button", { name: "対局開始", exact: true });
    // 設定の欄は読み込みのあとに描き直されるので、それより前に押した選択や開始は効かないことがある。
    // 対局が始まるまで選び直して押す。
    await expect(async () => {
        await page.getByRole("button", { name: "人 対 人", exact: true }).click();
        await start.click();
        await expect(start).toHaveCount(0, { timeout: 2_000 });
    }).toPass({ timeout: 30_000 });
    for (const target of clicks) {
        if (/^\d[a-i]$/.test(target)) {
            await page.locator(`[data-square='${target}']:visible`).click();
        } else {
            await page.getByRole("button", { name: target, exact: true }).click();
        }
    }
    // 押したマスの選択の印が消え、最後の手が盤に出るのを待つ。
    if (clicks.length > 0) await page.getByRole("button", { name: "待った" }).first().waitFor();
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

// 棋譜の一覧（自分の棋譜・公開棋譜）に並べる 1 局。終了日時は固定し、撮るたびに変わらないようにする。
const GAME_SUMMARY = {
    id: "00000000-0000-4000-8000-000000000001",
    roomId: null,
    source: "online_room",
    visibility: "public",
    publicId: "visual-summary",
    status: "finished",
    result: { winner: "b", reason: "resign" },
    participants: [
        { seat: "b", displayNameSnapshot: "先手さん" },
        { seat: "w", displayNameSnapshot: "後手さん" },
    ],
    createdAt: "2026-01-01T00:00:00Z",
    finishedAt: "2026-01-01T01:00:00Z",
    metadata: null,
};

const openGamesList =
    (path: string, api: string, response: Parameters<Route["fulfill"]>[0]) =>
    async (page: Page): Promise<void> => {
        await page.route(api, (route) => route.fulfill(response));
        await page.goto(path);
        await page.getByRole("heading", { level: 2 }).first().waitFor();
    };

const SCENES: Scene[] = [
    {
        name: "landing",
        open: gotoAndWait("/", (p) => p.getByRole("heading", { level: 1 }).waitFor()),
    },
    {
        name: "play-setup",
        open: async (page) => {
            await page.goto("/play");
            await page.getByRole("button", { name: "対局開始", exact: true }).waitFor();
            // PC では盤も並ぶが、局面を読み込んでから描くので、ボタンより遅れて出ることがある。
            if ((page.viewportSize()?.width ?? 0) >= 768) {
                await page.locator("[data-square='5i']").first().waitFor();
            }
        },
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
    // 人どうしの対局はエンジンを使わないので、毎回同じ盤を撮れる。始めた直後（空の持ち駒の段）と、
    // 角を取り合ったあと（両者に持ち駒がある段）。
    { name: "play-human", open: openHumanGame([]) },
    {
        name: "play-human-hands",
        open: openHumanGame(["7g", "7f", "3c", "3d", "8h", "2b", "成る", "3a", "2b"]),
        // 棋譜の消費時間は押す速さで変わる。
        mask: (page) => [page.getByText(/^\d+(\.\d+)?秒$/)],
    },
    {
        name: "studies",
        open: gotoAndWait("/studies", (p) =>
            p.getByRole("button", { name: "研究ノートにする" }).waitFor(),
        ),
    },
    { name: "study-note", open: openStudyAtEnd },
    { name: "study-pv", open: openStudyPv(false) },
    { name: "study-pv-flipped", open: openStudyPv(true), devices: ["pc"] },
    { name: "book-viewer", open: openBookViewer(false) },
    { name: "book-viewer-flipped", open: openBookViewer(true), devices: ["pc"] },
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
    {
        name: "studies-list",
        open: async (page) => {
            await openStudyAtEnd(page);
            await page.goto("/studies");
            await page
                .getByRole("button", { name: /を削除$/ })
                .first()
                .waitFor();
        },
        // 一覧の更新日時は作った時刻で変わる。
        mask: (page) => [page.getByText(/^更新 /)],
    },
    {
        name: "games-auth",
        open: openGamesList("/games", "**/api/games", { status: 401, json: {} }),
    },
    {
        name: "games-list",
        open: openGamesList("/games", "**/api/games", {
            json: { games: [GAME_SUMMARY], nextCursor: null },
        }),
    },
    {
        name: "public-games",
        open: openGamesList("/public/games", "**/api/public/games", {
            json: { games: [GAME_SUMMARY], nextCursor: null },
        }),
    },
    { name: "auth", open: gotoAndWait("/auth", (p) => p.getByRole("heading").first().waitFor()) },
    {
        name: "online",
        open: gotoAndWait("/online", (p) => p.getByRole("heading").first().waitFor()),
    },
];

for (const [device, viewport] of Object.entries(VIEWPORTS)) {
    for (const scene of SCENES) {
        if (scene.devices && !scene.devices.includes(device as keyof typeof VIEWPORTS)) continue;
        test(`${scene.name} ${device}`, async ({ page }) => {
            await page.setViewportSize(viewport);
            await scene.open(page);
            // 局面を読み込んでいる間の表示が消えてから撮る（設定の欄や盤は読み込みのあとに描き直される）。
            await expect(page.getByText(/局面を読み込み中/)).toHaveCount(0, { timeout: 30_000 });
            // API の再試行や開発サーバーの接続があるので networkidle は来ない。フォントと画像を待つ。
            await page.evaluate(async () => {
                await document.fonts.ready;
                // ダイアログの開くアニメーションなど、動いている途中の文字は撮るたびににじみが変わる。
                await Promise.all(
                    document
                        .getAnimations()
                        // 繰り返し続けるもの（読み込み中の点滅など）は終わらないので待たない。
                        .filter(
                            (animation) =>
                                animation.effect?.getComputedTiming().endTime !== Infinity,
                        )
                        .map((animation) => animation.finished.catch(() => null)),
                );
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
