// オンライン対局を 2 つのブラウザ（+ 観戦者）で最後まで進める E2E テスト
//
// 対象の環境は E2E_BASE_URL、その環境でルーム API を処理している側は E2E_ROOM_BACKEND
// （legacy / backend）で指定する。処理する側で挙動が変わるシナリオは、どちらの期待値も明記する。

import {
    type APIRequestContext,
    type Browser,
    type BrowserContext,
    expect,
    type Locator,
    type Page,
    test,
} from "@playwright/test";

type RoomBackend = "legacy" | "backend";
type PlayerSeat = "b" | "w";

const roomBackendEnv = process.env.E2E_ROOM_BACKEND;
const roomBackend: RoomBackend = roomBackendEnv === "legacy" ? "legacy" : "backend";
const useDevLogin = process.env.E2E_DEV_LOGIN === "true";

const SEAT_LABEL: Record<PlayerSeat | "s", string> = {
    b: "先手として参加する",
    w: "後手として参加する",
    s: "観戦者として参加する",
};
const NAMES: Record<PlayerSeat, string> = { b: "先手テスト", w: "後手テスト" };

const SECOND_TAB_NOTICE =
    "この画面からは操作できません。別のタブやウィンドウで対局中の場合は、そちらで続けてください。";

interface RoomSettings {
    startSfen: string;
    timeControl:
        | { type: "byoyomi"; initialMs: number; byoyomiMs: number }
        | { type: "fischer"; initialMs: number; fischerIncrementMs: number };
    passRights: null;
    aiSupport: null;
    takeback: boolean;
}

const DEFAULT_SETTINGS: RoomSettings = {
    startSfen: "startpos",
    timeControl: { type: "byoyomi", initialMs: 600_000, byoyomiMs: 30_000 },
    passRights: null,
    aiSupport: null,
    takeback: false,
};

// ─── ヘルパー ──────────────────────────────────────────────────────────────────

// ルーム作成は IP ごとに 60 秒 10 回までに制限されている。スイートを続けて実行すると前の実行分で
// 上限に届くので、制限されたら枠が空くまで待ってやり直す
const RATE_LIMIT_RETRY_MS = 15_000;
const RATE_LIMIT_MAX_RETRIES = 5;

async function createRoom(
    request: APIRequestContext,
    settings: Partial<RoomSettings> = {},
): Promise<string> {
    for (let attempt = 0; ; attempt += 1) {
        const response = await request.post("/api/rooms", {
            data: { settings: { ...DEFAULT_SETTINGS, ...settings } },
        });
        if (response.status() === 429 && attempt < RATE_LIMIT_MAX_RETRIES) {
            test.setTimeout(test.info().timeout + RATE_LIMIT_RETRY_MS);
            await new Promise((resolve) => setTimeout(resolve, RATE_LIMIT_RETRY_MS));
            continue;
        }
        expect(response.status(), await response.text()).toBe(200);
        const { roomId } = (await response.json()) as { roomId: string };
        return roomId;
    }
}

async function newContext(browser: Browser, devLoginPlayer?: 1 | 2): Promise<BrowserContext> {
    const context = await browser.newContext();
    if (useDevLogin && devLoginPlayer) {
        const response = await context.request.get(`/api/auth/dev-login?player=${devLoginPlayer}`);
        expect(response.ok(), "dev-login に失敗しました").toBe(true);
    }
    return context;
}

async function joinRoom(
    page: Page,
    roomId: string,
    seat: PlayerSeat | "s",
    name: string,
): Promise<void> {
    await page.goto(`/online/${roomId}`);
    await page.getByLabel("名前").fill(name);
    await page.getByRole("button", { name: SEAT_LABEL[seat] }).click();
}

interface Match {
    roomId: string;
    b: Page;
    w: Page;
    contexts: Record<PlayerSeat, BrowserContext>;
}

/** 先手・後手が別々のブラウザで参加し、双方に盤面が出るまで進める */
async function startMatch(
    browser: Browser,
    request: APIRequestContext,
    settings: Partial<RoomSettings> = {},
): Promise<Match> {
    const roomId = await createRoom(request, settings);
    const contexts = { b: await newContext(browser, 1), w: await newContext(browser, 2) };
    const b = await contexts.b.newPage();
    const w = await contexts.w.newPage();

    await joinRoom(b, roomId, "b", NAMES.b);
    await expect(b.getByText("接続しました。対局開始を待っています...")).toBeVisible();
    await joinRoom(w, roomId, "w", NAMES.w);
    await expectBoard(b);
    await expectBoard(w);
    return { roomId, b, w, contexts };
}

function square(page: Page, id: string): Locator {
    return page.locator(`[data-square="${id}"]`);
}

async function expectBoard(page: Page): Promise<void> {
    await expect(square(page, "5e")).toBeVisible({ timeout: 15_000 });
}

/** マスに指定の駒がある（piece が null なら空マス）ことを確かめる */
async function expectSquare(page: Page, id: string, piece: string | null): Promise<void> {
    await expect(square(page, id)).toHaveAccessibleName(
        piece === null ? `${id} 空マス` : new RegExp(`^${id} ${piece}。`),
    );
}

async function expectPly(page: Page, current: number, total: number): Promise<void> {
    await expect(page.getByText(`${current}/${total}手`, { exact: true })).toBeVisible();
}

/**
 * 盤上の駒を from から to へ動かす。
 * 合法手の取得が終わる前のクリックは選択の解除として扱われるので、動くまでやり直す。
 */
async function playMove(page: Page, from: string, to: string, piece: string): Promise<void> {
    await expect(async () => {
        await square(page, from).click();
        await square(page, to).click();
        await expect(square(page, to)).toHaveAccessibleName(new RegExp(`^${to} ${piece}。`), {
            timeout: 1_000,
        });
    }).toPass({ timeout: 20_000 });
}

/** 指し手が双方の盤面に反映されるまで待つ */
async function playMoveOnBoth(
    match: Match,
    seat: PlayerSeat,
    from: string,
    to: string,
    piece: string,
): Promise<void> {
    await playMove(match[seat], from, to, piece);
    for (const page of [match.b, match.w]) {
        await expectSquare(page, to, piece);
        await expectSquare(page, from, null);
    }
}

/** 平手の初形から ▲7六歩 △3四歩 ▲2六歩 △8四歩 まで進める */
async function playOpening(match: Match): Promise<void> {
    await playMoveOnBoth(match, "b", "7g", "7f", "先手の歩");
    await playMoveOnBoth(match, "w", "3c", "3d", "後手の歩");
    await playMoveOnBoth(match, "b", "2g", "2f", "先手の歩");
    await playMoveOnBoth(match, "w", "8c", "8d", "後手の歩");
}

/** 起きてはいけない変化が、待っても起きないことを確かめる */
async function expectUnchangedFor(
    page: Page,
    ms: number,
    check: () => Promise<void>,
): Promise<void> {
    await check();
    await page.waitForTimeout(ms);
    await check();
}

function resultDialogHeading(page: Page, winner: PlayerSeat): Locator {
    return page.getByRole("heading", { name: `${NAMES[winner]} の勝ち` });
}

async function closeAll(...contexts: BrowserContext[]): Promise<void> {
    await Promise.all(contexts.map((context) => context.close()));
}

// ─── テスト ───────────────────────────────────────────────────────────────────

test.describe(`オンライン対局（ルーム API: ${roomBackend}）`, () => {
    test.beforeAll(() => {
        if (roomBackendEnv !== "legacy" && roomBackendEnv !== "backend") {
            throw new Error(
                "E2E_ROOM_BACKEND に、対象環境でルーム API を処理している側（legacy / backend）を指定してください",
            );
        }
    });

    test("対局設定画面で作成したルームに 2 人が参加すると対局が始まる", async ({ browser }) => {
        const contextB = await newContext(browser, 1);
        const contextW = await newContext(browser, 2);
        const b = await contextB.newPage();
        const w = await contextW.newPage();

        await b.goto("/online/create");
        await b.getByLabel("あなたの名前").fill(NAMES.b);
        test.setTimeout(test.info().timeout + RATE_LIMIT_RETRY_MS * RATE_LIMIT_MAX_RETRIES);
        await expect(async () => {
            const createButton = b.getByRole("button", { name: "部屋を作成する" });
            if (await createButton.isVisible()) {
                await createButton.click();
            }
            await expect(b.getByRole("heading", { name: "対局ルーム" })).toBeVisible({
                timeout: 5_000,
            });
        }).toPass({
            intervals: [RATE_LIMIT_RETRY_MS],
            timeout: RATE_LIMIT_RETRY_MS * RATE_LIMIT_MAX_RETRIES,
        });
        const roomId = new URL(b.url()).pathname.split("/").at(-1) ?? "";
        expect(roomId).toMatch(/^[A-Za-z0-9]{6}$/);

        await expect(b.getByLabel("名前")).toHaveValue(NAMES.b);
        await b.getByRole("button", { name: SEAT_LABEL.b }).click();
        await expect(b.getByText("接続しました。対局開始を待っています...")).toBeVisible();

        await joinRoom(w, roomId, "w", NAMES.w);
        for (const page of [b, w]) {
            await expectBoard(page);
            await expect(page.getByText(`▲ ${NAMES.b}`)).toBeVisible();
            await expect(page.getByText(`△ ${NAMES.w}`)).toBeVisible();
            await expectSquare(page, "7g", "先手の歩");
            await expectPly(page, 0, 0);
        }

        await closeAll(contextB, contextW);
    });

    test("双方が数手ずつ指すと、盤面と棋譜が双方に反映される", async ({ browser, request }) => {
        const match = await startMatch(browser, request);

        await playOpening(match);
        await playMoveOnBoth(match, "b", "2f", "2e", "先手の歩");
        await playMoveOnBoth(match, "w", "8d", "8e", "後手の歩");

        for (const page of [match.b, match.w]) {
            await expectPly(page, 6, 6);
            await page.getByRole("button", { name: "棋譜", exact: true }).click();
            await expect(page.getByRole("button", { name: /^\d+\./ })).toHaveCount(6);
            await expect(page.getByRole("button", { name: /^1\./ })).toContainText("7六歩");
            await expect(page.getByRole("button", { name: /^6\./ })).toContainText("8五歩");
        }

        await closeAll(match.contexts.b, match.contexts.w);
    });

    test("角落ちのルームは上手（後手）から指せる", async ({ browser, request }) => {
        const match = await startMatch(browser, request, { startSfen: "handicap:bishop" });

        for (const page of [match.b, match.w]) {
            await expectSquare(page, "2b", null);
            await expectSquare(page, "8b", "後手の飛");
            await expectSquare(page, "8h", "先手の角");
        }
        await playMoveOnBoth(match, "w", "3c", "3d", "後手の歩");
        await playMoveOnBoth(match, "b", "7g", "7f", "先手の歩");
        await expectPly(match.b, 2, 2);

        await closeAll(match.contexts.b, match.contexts.w);
    });

    test("SFEN で指定した局面から対局できる", async ({ browser, request }) => {
        const match = await startMatch(browser, request, {
            startSfen: "4k4/9/4p4/9/9/9/4P4/9/4K4 b - 1",
        });

        for (const page of [match.b, match.w]) {
            await expectSquare(page, "5a", "後手の玉");
            await expectSquare(page, "5i", "先手の玉");
            await expectSquare(page, "7g", null);
        }
        await playMoveOnBoth(match, "b", "5g", "5f", "先手の歩");
        await playMoveOnBoth(match, "w", "5c", "5d", "後手の歩");

        await closeAll(match.contexts.b, match.contexts.w);
    });

    test("待機中に開始局面を SFEN 直接入力へ変更する", async ({ browser, request }) => {
        const roomId = await createRoom(request);
        const contextB = await newContext(browser, 1);
        const contextW = await newContext(browser, 2);
        const b = await contextB.newPage();
        const w = await contextW.newPage();

        await joinRoom(b, roomId, "b", NAMES.b);
        await expect(b.getByText("接続しました。対局開始を待っています...")).toBeVisible();
        await b.getByRole("combobox", { name: "開始局面を選択" }).click();
        await b.getByRole("option", { name: "SFEN 直接入力" }).click();

        if (roomBackend === "legacy") {
            // legacy は「SFEN 直接入力」を選んだ時点で送られる空の開始局面をエラーで返し、
            // 待機中の接続はそこで切れる。変更した側にはエラーが表示され、平手のまま始まる
            await expect(b.getByText("エラーが発生しました")).toBeVisible();
            await expect(b.getByText("接続しました。対局開始を待っています...")).toHaveCount(0);
            await joinRoom(w, roomId, "w", NAMES.w);
            await expectBoard(w);
            await expectSquare(w, "7g", "先手の歩");
            await expect(b.getByRole("heading", { name: "対局ルーム" })).toBeVisible();
            await expect(square(b, "5e")).toHaveCount(0);
            await closeAll(contextB, contextW);
            return;
        }

        // 入力途中の不正な SFEN は無視されて接続は保たれ、入力し終えた局面で始まる
        await b
            .getByPlaceholder(/^例: lnsgkgsnl/)
            .pressSequentially("4k4/9/4p4/9/9/9/4P4/9/4K4 b - 1");
        await joinRoom(w, roomId, "w", NAMES.w);
        for (const page of [b, w]) {
            await expectBoard(page);
            await expectSquare(page, "5a", "後手の玉");
            await expectSquare(page, "7g", null);
        }
        // 変更した側が先に指す局面なので、変更後の局面から指せて、双方の盤面が一致する
        const match: Match = { roomId, b, w, contexts: { b: contextB, w: contextW } };
        await playMoveOnBoth(match, "b", "5g", "5f", "先手の歩");
        await playMoveOnBoth(match, "w", "5c", "5d", "後手の歩");
        await expectPly(b, 2, 2);

        await closeAll(contextB, contextW);
    });

    test("待機中に開始局面を変更した側も、変更後の局面で対局が始まる", async ({
        browser,
        request,
    }) => {
        const roomId = await createRoom(request);
        const contextB = await newContext(browser, 1);
        const contextW = await newContext(browser, 2);
        const b = await contextB.newPage();
        const w = await contextW.newPage();

        await joinRoom(b, roomId, "b", NAMES.b);
        await expect(b.getByText("接続しました。対局開始を待っています...")).toBeVisible();
        await b.getByRole("combobox", { name: "開始局面を選択" }).click();
        await b.getByRole("option", { name: "角落ち", exact: true }).click();
        await expect
            .poll(async () => {
                const response = await request.get(`/api/rooms/${roomId}`);
                const room = (await response.json()) as { settings: { startSfen: string } };
                return room.settings.startSfen;
            })
            .toBe("handicap:bishop");

        await joinRoom(w, roomId, "w", NAMES.w);
        for (const page of [b, w]) {
            await expectBoard(page);
            await expectSquare(page, "2b", null);
            await expectSquare(page, "8b", "後手の飛");
        }
        const match: Match = { roomId, b, w, contexts: { b: contextB, w: contextW } };
        await playMoveOnBoth(match, "w", "3c", "3d", "後手の歩");
        await playMoveOnBoth(match, "b", "7g", "7f", "先手の歩");
        await expectPly(b, 2, 2);

        await closeAll(contextB, contextW);
    });

    test("待機中に開始局面を変更した側が先に指す局面でも、変更後の局面から指せる", async ({
        browser,
        request,
    }) => {
        const roomId = await createRoom(request);
        const contextB = await newContext(browser, 1);
        const contextW = await newContext(browser, 2);
        const b = await contextB.newPage();
        const w = await contextW.newPage();

        await joinRoom(w, roomId, "w", NAMES.w);
        await expect(w.getByText("接続しました。対局開始を待っています...")).toBeVisible();
        await w.getByRole("combobox", { name: "開始局面を選択" }).click();
        await w.getByRole("option", { name: "角落ち", exact: true }).click();
        await expect
            .poll(async () => {
                const response = await request.get(`/api/rooms/${roomId}`);
                const room = (await response.json()) as { settings: { startSfen: string } };
                return room.settings.startSfen;
            })
            .toBe("handicap:bishop");

        await joinRoom(b, roomId, "b", NAMES.b);
        for (const page of [b, w]) {
            await expectBoard(page);
            await expectSquare(page, "2b", null);
            await expectSquare(page, "8b", "後手の飛");
        }
        // 角落ちは上手（後手）から指す。変更した側が古い局面のまま指すと、サーバーの局面が
        // 相手の盤面と食い違う
        const match: Match = { roomId, b, w, contexts: { b: contextB, w: contextW } };
        await playMoveOnBoth(match, "w", "3c", "3d", "後手の歩");
        await playMoveOnBoth(match, "b", "7g", "7f", "先手の歩");
        for (const page of [b, w]) {
            await expectSquare(page, "2b", null);
            await expectPly(page, 2, 2);
        }

        await closeAll(contextB, contextW);
    });

    test("待機中に開始局面を変更して再読み込みした側も、相手が参加すると変更後の局面で対局が始まる", async ({
        browser,
        request,
    }) => {
        const roomId = await createRoom(request);
        const contextB = await newContext(browser, 1);
        const contextW = await newContext(browser, 2);
        const b = await contextB.newPage();
        const w = await contextW.newPage();

        await joinRoom(b, roomId, "b", NAMES.b);
        await expect(b.getByText("接続しました。対局開始を待っています...")).toBeVisible();
        await b.getByRole("combobox", { name: "開始局面を選択" }).click();
        await b.getByRole("option", { name: "角落ち", exact: true }).click();
        await expect
            .poll(async () => {
                const response = await request.get(`/api/rooms/${roomId}`);
                const room = (await response.json()) as { settings: { startSfen: string } };
                return room.settings.startSfen;
            })
            .toBe("handicap:bishop");

        await b.reload();
        await expect(b.getByText("接続しました。対局開始を待っています...")).toBeVisible();
        await expect(b.getByRole("combobox", { name: "開始局面を選択" })).toHaveText("角落ち");

        await joinRoom(w, roomId, "w", NAMES.w);
        for (const page of [b, w]) {
            await expectBoard(page);
            await expectSquare(page, "2b", null);
            await expectSquare(page, "8b", "後手の飛");
        }
        const match: Match = { roomId, b, w, contexts: { b: contextB, w: contextW } };
        await playMoveOnBoth(match, "w", "3c", "3d", "後手の歩");
        await playMoveOnBoth(match, "b", "7g", "7f", "先手の歩");
        await expectPly(b, 2, 2);

        await closeAll(contextB, contextW);
    });

    test("開始局面を解釈できない game_start を受けた側は、サーバーの snapshot から盤面を開く", async ({
        browser,
        request,
    }) => {
        const roomId = await createRoom(request, { startSfen: "handicap:bishop" });
        const contextB = await newContext(browser, 1);
        const contextW = await newContext(browser, 2);
        const contextS = await newContext(browser);
        const b = await contextB.newPage();
        const w = await contextW.newPage();
        const s = await contextS.newPage();

        // クライアントの知らないプリセット名が届いた状況を、先手と観戦者の受信だけ書き換えて作る
        const sentTypes = new Map<Page, string[]>([
            [b, []],
            [s, []],
        ]);
        for (const [page, sent] of sentTypes) {
            await page.routeWebSocket(/\/api\/rooms\/[^/]+\/ws$/, (ws) => {
                const server = ws.connectToServer();
                ws.onMessage((data) => {
                    sent.push((JSON.parse(String(data)) as { t: string }).t);
                    server.send(data);
                });
                server.onMessage((data) => {
                    const message = JSON.parse(String(data)) as {
                        t: string;
                        payload: { kind?: string; settings?: { startSfen: string } };
                    };
                    if (message.t === "event" && message.payload.kind === "game_start") {
                        ws.send(
                            JSON.stringify({
                                ...message,
                                payload: {
                                    ...message.payload,
                                    settings: {
                                        ...message.payload.settings,
                                        startSfen: "handicap:unknown",
                                    },
                                },
                            }),
                        );
                        return;
                    }
                    ws.send(data);
                });
            });
        }

        await joinRoom(b, roomId, "b", NAMES.b);
        await expect(b.getByText("接続しました。対局開始を待っています...")).toBeVisible();
        await joinRoom(s, roomId, "s", "観戦者テスト");
        await expect(s.getByText("接続しました。対局開始を待っています...")).toBeVisible();
        await joinRoom(w, roomId, "w", NAMES.w);

        for (const page of [b, w, s]) {
            await expectBoard(page);
            await expectSquare(page, "2b", null);
            await expectSquare(page, "8b", "後手の飛");
        }
        const match: Match = { roomId, b, w, contexts: { b: contextB, w: contextW } };
        await playMoveOnBoth(match, "w", "3c", "3d", "後手の歩");
        await playMoveOnBoth(match, "b", "7g", "7f", "先手の歩");
        await expectSquare(s, "7f", "先手の歩");
        await expectPly(s, 2, 2);
        // 盤面は game_start からでなく、対局者は resume、観戦者は参加し直しで得た snapshot から開いた
        expect(sentTypes.get(b)).toContain("resume");
        expect(sentTypes.get(s)?.filter((type) => type === "join")).toHaveLength(2);

        await closeAll(contextB, contextW, contextS);
    });

    test("対局中に再読み込みすると盤面と棋譜が復元され、続きを指せる", async ({
        browser,
        request,
    }) => {
        const match = await startMatch(browser, request);
        const contextS = await newContext(browser);
        const s = await contextS.newPage();
        await joinRoom(s, match.roomId, "s", "観戦者テスト");
        await expectBoard(s);
        await playOpening(match);
        await expectPly(s, 4, 4);

        await match.b.reload();
        await expectBoard(match.b);
        await expectSquare(match.b, "7f", "先手の歩");
        await expectSquare(match.b, "2f", "先手の歩");
        await expectSquare(match.b, "3d", "後手の歩");
        await expectSquare(match.b, "8d", "後手の歩");
        await expectPly(match.b, 4, 4);
        await match.b.getByRole("button", { name: "棋譜", exact: true }).click();
        await expect(match.b.getByRole("button", { name: /^\d+\./ })).toHaveCount(4);
        await expect(match.b.getByRole("button", { name: /^4\./ })).toContainText("8四歩");

        await playMoveOnBoth(match, "b", "2f", "2e", "先手の歩");
        await playMoveOnBoth(match, "w", "8d", "8e", "後手の歩");

        // 対局中に巻き戻せるのは観戦者だけなので、巻き戻しの復元は観戦者で確かめる。
        // 観戦者は再読み込みすると参加し直しになる
        await s.reload();
        await expect(s.getByLabel("名前")).toHaveValue("観戦者テスト");
        await s.getByRole("button", { name: SEAT_LABEL.s }).click();
        await expectBoard(s);
        await expectSquare(s, "8e", "後手の歩");
        await expectPly(s, 6, 6);
        await s.getByTitle("最初へ戻る").click();
        await expectPly(s, 0, 6);
        await expectSquare(s, "7g", "先手の歩");
        await expectSquare(s, "8c", "後手の歩");
        await s.getByTitle("1手進む").click();
        await expectPly(s, 1, 6);
        await expectSquare(s, "7f", "先手の歩");
        await expectSquare(s, "3c", "後手の歩");
        await s.getByTitle("最後へ進む").click();
        await expectPly(s, 6, 6);
        await expectSquare(s, "8e", "後手の歩");

        await closeAll(match.contexts.b, match.contexts.w, contextS);
    });

    test("待ったを承認すると直前の手が取り消される", async ({ browser, request }) => {
        const match = await startMatch(browser, request, { takeback: true });
        await playMoveOnBoth(match, "b", "7g", "7f", "先手の歩");

        await match.b.getByRole("button", { name: "待った", exact: true }).click();
        await expect(match.b.getByText("待った申請中... 相手の応答を待っています")).toBeVisible();
        await expect(match.w.getByText("待ったの申請", { exact: true })).toBeVisible();
        await match.w.getByRole("button", { name: "承認する" }).click();

        for (const page of [match.b, match.w]) {
            await expectSquare(page, "7g", "先手の歩");
            await expectSquare(page, "7f", null);
            await expectPly(page, 0, 0);
            await expect(page.getByText("待ったの申請", { exact: true })).toHaveCount(0);
        }
        await expect(match.b.getByText("待った申請中... 相手の応答を待っています")).toHaveCount(0);

        // 取り消した側の手番に戻り、別の手を指せる
        await playMoveOnBoth(match, "b", "2g", "2f", "先手の歩");

        await closeAll(match.contexts.b, match.contexts.w);
    });

    test("待ったを拒否すると局面は変わらず、相手の手番のまま続く", async ({ browser, request }) => {
        const match = await startMatch(browser, request, { takeback: true });
        await playMoveOnBoth(match, "b", "7g", "7f", "先手の歩");

        await match.b.getByRole("button", { name: "待った", exact: true }).click();
        await expect(match.w.getByText("待ったの申請", { exact: true })).toBeVisible();
        await match.w.getByRole("button", { name: "拒否する" }).click();

        await expect(match.w.getByText("待ったの申請", { exact: true })).toHaveCount(0);
        await expect(match.b.getByText("待った申請中... 相手の応答を待っています")).toHaveCount(0);
        for (const page of [match.b, match.w]) {
            await expectSquare(page, "7f", "先手の歩");
            await expectPly(page, 1, 1);
        }
        await playMoveOnBoth(match, "w", "3c", "3d", "後手の歩");

        await closeAll(match.contexts.b, match.contexts.w);
    });

    test("投了すると結果ダイアログが双方に 1 つずつ出る", async ({ browser, request }) => {
        const match = await startMatch(browser, request);
        await playOpening(match);

        await match.b.getByRole("button", { name: "投了" }).click();

        for (const page of [match.b, match.w]) {
            await expect(resultDialogHeading(page, "w")).toBeVisible();
            await expect(page.getByText("投了", { exact: true })).toBeVisible();
            await expect(page.getByRole("button", { name: "棋譜を検討する" })).toBeVisible();
            await expect(page.getByRole("button", { name: "投了" })).toHaveCount(0);
        }
        // 棋譜保存の完了通知など、終局後に届くメッセージでダイアログが増えないこと
        await expectUnchangedFor(match.b, 2_000, async () => {
            for (const page of [match.b, match.w]) {
                await expect(page.getByRole("heading", { name: /の勝ち$|^引き分け$/ })).toHaveCount(
                    1,
                );
            }
        });

        await closeAll(match.contexts.b, match.contexts.w);
    });

    test("終局後に再読み込みしたときの結果と検討への導線", async ({ browser, request }) => {
        const match = await startMatch(browser, request);
        await playOpening(match);
        await match.b.getByRole("button", { name: "投了" }).click();
        await expect(resultDialogHeading(match.w, "w")).toBeVisible();

        await match.w.reload();
        await expectBoard(match.w);
        await expectSquare(match.w, "8d", "後手の歩");
        await expectPly(match.w, 4, 4);

        if (roomBackend === "backend") {
            await expect(resultDialogHeading(match.w, "w")).toHaveCount(1);
            await expect(match.w.getByText("投了", { exact: true })).toBeVisible();
            await match.w.getByRole("button", { name: "棋譜を検討する" }).click();
            // 棋譜が保存されるのはログイン中の対局者がいる対局だけ
            await expect(match.w).toHaveURL(useDevLogin ? /\/games\/[^/]+\/review$/ : /\/play$/);
        } else {
            // legacy は終局済みルームの結果を再接続時に返さないので、盤面だけが表示される
            await expectUnchangedFor(match.w, 2_000, async () => {
                await expect(
                    match.w.getByRole("heading", { name: /の勝ち$|^引き分け$/ }),
                ).toHaveCount(0);
                await expect(match.w.getByRole("button", { name: "棋譜を検討する" })).toHaveCount(
                    0,
                );
            });
        }

        await closeAll(match.contexts.b, match.contexts.w);
    });

    test("持ち時間を使い切ると時間切れで終局する", async ({ browser, request }) => {
        const match = await startMatch(browser, request, {
            timeControl: { type: "byoyomi", initialMs: 0, byoyomiMs: 3_000 },
        });

        for (const page of [match.b, match.w]) {
            await expect(resultDialogHeading(page, "w")).toBeVisible({ timeout: 20_000 });
            await expect(page.getByText("時間切れ", { exact: true })).toBeVisible();
        }

        await closeAll(match.contexts.b, match.contexts.w);
    });

    test("観戦者には指し手が届き、観戦者は指せない", async ({ browser, request }) => {
        const match = await startMatch(browser, request);
        const contextS = await newContext(browser);
        const s = await contextS.newPage();

        await playMoveOnBoth(match, "b", "7g", "7f", "先手の歩");
        await joinRoom(s, match.roomId, "s", "観戦者テスト");
        await expectBoard(s);
        await expectSquare(s, "7f", "先手の歩");

        await playMoveOnBoth(match, "w", "3c", "3d", "後手の歩");
        await expectSquare(s, "3d", "後手の歩");
        await expectPly(s, 2, 2);

        await expect(s.getByRole("button", { name: "投了" })).toHaveCount(0);
        await square(s, "2g").click();
        await square(s, "2f").click();
        await expectUnchangedFor(s, 1_500, async () => {
            for (const page of [match.b, match.w, s]) {
                await expectSquare(page, "2g", "先手の歩");
                await expectSquare(page, "2f", null);
            }
        });

        // 観戦者は対局中でも棋譜を巻き戻せる
        await s.getByTitle("1手戻る").click();
        await expectPly(s, 1, 2);
        await expectSquare(s, "3c", "後手の歩");

        await playMoveOnBoth(match, "b", "2g", "2f", "先手の歩");
        await closeAll(match.contexts.b, match.contexts.w, contextS);
    });

    test("同じ席を 2 つ目のタブで開いたときの操作権", async ({ browser, request }) => {
        const match = await startMatch(browser, request);
        await playMoveOnBoth(match, "b", "7g", "7f", "先手の歩");
        await playMoveOnBoth(match, "w", "3c", "3d", "後手の歩");

        const secondTab = await match.contexts.b.newPage();
        await secondTab.goto(`/online/${match.roomId}`);
        await expectBoard(secondTab);
        await expectSquare(secondTab, "3d", "後手の歩");

        if (roomBackend === "backend") {
            // 操作権は後から開いたタブへ移り、先に開いていたタブの指し手は受け付けられない
            await square(match.b, "2g").click();
            await square(match.b, "2f").click();
            await expect(match.b.getByRole("alert")).toHaveText(SECOND_TAB_NOTICE);
            await expectSquare(match.w, "2f", null);

            await playMove(secondTab, "2g", "2f", "先手の歩");
            for (const page of [match.b, match.w, secondTab]) {
                await expectSquare(page, "2f", "先手の歩");
            }
        } else {
            // legacy は席ごとの操作権を持たず、どちらのタブからも指せる
            await playMove(match.b, "2g", "2f", "先手の歩");
            for (const page of [match.w, secondTab]) {
                await expectSquare(page, "2f", "先手の歩");
            }
            await playMoveOnBoth(match, "w", "8c", "8d", "後手の歩");
            await playMove(secondTab, "2f", "2e", "先手の歩");
            for (const page of [match.b, match.w]) {
                await expectSquare(page, "2e", "先手の歩");
            }
            await expect(match.b.getByRole("alert")).toHaveCount(0);
        }

        await closeAll(match.contexts.b, match.contexts.w);
    });

    test("接続が切れている間の指し手は、再接続後に反映される", async ({ browser, request }) => {
        const roomId = await createRoom(request);
        const contextB = await newContext(browser, 1);
        const contextW = await newContext(browser, 2);
        const b = await contextB.newPage();
        const w = await contextW.newPage();

        // 後手の WebSocket だけテストから切断・遮断できるようにする
        let online = true;
        let connectionCount = 0;
        let dropConnection = async (): Promise<void> => {};
        await w.routeWebSocket(/\/api\/rooms\/[^/]+\/ws$/, (ws) => {
            if (!online) {
                void ws.close();
                return;
            }
            connectionCount += 1;
            const server = ws.connectToServer();
            dropConnection = async () => {
                await Promise.all([ws.close(), server.close()]);
            };
        });

        await joinRoom(b, roomId, "b", NAMES.b);
        await expect(b.getByText("接続しました。対局開始を待っています...")).toBeVisible();
        await joinRoom(w, roomId, "w", NAMES.w);
        await expectBoard(b);
        await expectBoard(w);
        const match: Match = { roomId, b, w, contexts: { b: contextB, w: contextW } };
        await playMoveOnBoth(match, "b", "7g", "7f", "先手の歩");
        await playMoveOnBoth(match, "w", "3c", "3d", "後手の歩");

        online = false;
        const connectionsBeforeDrop = connectionCount;
        await dropConnection();
        await playMove(b, "2g", "2f", "先手の歩");
        await expectUnchangedFor(w, 1_500, () => expectSquare(w, "2f", null));

        online = true;
        await expectSquare(w, "2f", "先手の歩");
        expect(connectionCount).toBeGreaterThan(connectionsBeforeDrop);
        await expectPly(w, 3, 3);
        await playMoveOnBoth(match, "w", "8c", "8d", "後手の歩");

        await closeAll(contextB, contextW);
    });

    test("存在しないルームを開くと「ルームが見つかりません」と表示される", async ({ page }) => {
        await page.goto("/online/zzzzzz");

        await expect(page.getByText("ルームが見つかりません")).toBeVisible();
        await expect(page.getByRole("button", { name: "← オンライン対局に戻る" })).toBeVisible();
    });

    test("存在しないルームへの WebSocket 接続は、参加時に ROOM_NOT_FOUND を返す", async ({
        page,
    }) => {
        await page.goto("/online");
        const outcome = await page.evaluate(
            () =>
                new Promise<{ opened: boolean; errorCode: string | null }>((resolve) => {
                    const scheme = location.protocol === "https:" ? "wss:" : "ws:";
                    const ws = new WebSocket(`${scheme}//${location.host}/api/rooms/zzzzzz/ws`);
                    let opened = false;
                    const finish = (errorCode: string | null): void => {
                        resolve({ opened, errorCode });
                        ws.close();
                    };
                    ws.addEventListener("open", () => {
                        opened = true;
                        ws.send(
                            JSON.stringify({
                                v: 1,
                                t: "join",
                                clientMsgId: 1,
                                payload: { seat: "s", name: "観戦者テスト" },
                            }),
                        );
                    });
                    ws.addEventListener("message", (event) => {
                        const message = JSON.parse(String(event.data)) as {
                            t: string;
                            payload: { code?: string };
                        };
                        if (message.t === "error") finish(message.payload.code ?? null);
                    });
                    ws.addEventListener("close", () => finish(null));
                }),
        );

        // 接続は受け付けられ、参加しようとした時点でエラーが返る
        expect(outcome).toEqual({ opened: true, errorCode: "ROOM_NOT_FOUND" });
    });
});
