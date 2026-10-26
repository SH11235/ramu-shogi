import { expect, type Locator, type Page, test } from "@playwright/test";

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
    await page.getByRole("button", { name: "人 対 人", exact: true }).click();
    await page.getByRole("button", { name: "対局開始", exact: true }).click();
    await page
        .getByRole("button", { name: "対局開始", exact: true })
        .waitFor({ state: "detached" });
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
            // 盤は局面を読み込んでから描くので、ボタンより遅れて出ることがある。
            await page.locator("[data-square='5i']").first().waitFor();
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
        if (scene.devices && !scene.devices.includes(device as keyof typeof VIEWPORTS)) continue;
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
