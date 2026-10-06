// 起動済みの環境で対局を始め、RoomDO が送る game_start と、その直後に参加した観戦者へ送る
// snapshot の組を記録して標準出力に書く。
//
// apps/web/src/pages/online/fixtures/backend-game-start.json を作り直すとき:
//
//   pnpm --filter web dev:workers          # ROOM_BACKEND=backend（既定）で起動しておく
//   pnpm --filter web record:room-game-start \
//       > apps/web/src/pages/online/fixtures/backend-game-start.json
//   pnpm exec biome format --write apps/web/src/pages/online/fixtures
//
// 環境変数:
//   BASE_URL  対象環境の URL（既定: http://localhost:8787）

const BASE_URL = process.env.BASE_URL ?? "http://localhost:8787";
// ルーム作成は IP ごとに 60 秒 10 回までに制限されている
const RATE_LIMIT_RETRY_MS = 15_000;
const MESSAGE_TIMEOUT_MS = 5_000;

const DEFAULT_SETTINGS = {
    startSfen: "startpos",
    timeControl: { type: "byoyomi", initialMs: 600_000, byoyomiMs: 30_000 },
    passRights: null,
    aiSupport: null,
    takeback: false,
};

const WHITE_TO_MOVE = "4k4/9/4p4/9/9/9/4P4/9/4K4 w - 1";

// create はルーム作成時の設定、startSfen は 1 人目が待機中に変更する開始局面
const CASES = [
    { name: "平手", create: {} },
    { name: "作成時から角落ち", create: { startSfen: "handicap:bishop" } },
    { name: "待機中に角落ちへ変更", create: {}, startSfen: "handicap:bishop" },
    { name: "待機中に飛車落ちへ変更", create: {}, startSfen: "handicap:rook" },
    { name: "待機中に飛車角落ちへ変更", create: {}, startSfen: "handicap:rook-bishop" },
    { name: "待機中に後手番の SFEN へ変更", create: {}, startSfen: WHITE_TO_MOVE },
    {
        name: "待機中に持ち駒のある先手番の SFEN へ変更",
        create: {},
        startSfen: "4k4/9/9/9/9/9/9/9/4K4 b 2Pb 1",
    },
    {
        name: "持ち時間なしの秒読み",
        create: { timeControl: { type: "byoyomi", initialMs: 0, byoyomiMs: 3_000 } },
    },
    {
        name: "無制限（秒読み 0）",
        create: { timeControl: { type: "byoyomi", initialMs: 0, byoyomiMs: 0 } },
    },
    {
        name: "フィッシャー",
        create: {
            timeControl: { type: "fischer", initialMs: 300_000, fischerIncrementMs: 5_000 },
        },
    },
    {
        name: "無制限（持ち時間 0 のフィッシャー）",
        create: { timeControl: { type: "fischer", initialMs: 0, fischerIncrementMs: 10_000 } },
    },
    {
        name: "パス権 2 回・角落ち",
        create: { passRights: { initialCount: 2 } },
        startSfen: "handicap:bishop",
    },
    { name: "先頭に空白のある SFEN", create: {}, startSfen: ` ${WHITE_TO_MOVE}` },
    { name: "末尾に空白のある SFEN", create: {}, startSfen: `${WHITE_TO_MOVE} ` },
    {
        name: "手番の前に空白が 2 つある SFEN",
        create: {},
        startSfen: WHITE_TO_MOVE.replace(" w ", "  w "),
    },
    { name: "タブ区切りの SFEN", create: {}, startSfen: WHITE_TO_MOVE.replaceAll(" ", "\t") },
    { name: "手数を省いた SFEN", create: {}, startSfen: "4k4/9/4p4/9/9/9/4P4/9/4K4 w -" },
];

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function createRoom(settings) {
    for (;;) {
        const response = await fetch(`${BASE_URL}/api/rooms`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ settings }),
        });
        if (response.status === 429) {
            console.error(`[record] 429: ${RATE_LIMIT_RETRY_MS / 1000} 秒待ってやり直します`);
            await sleep(RATE_LIMIT_RETRY_MS);
            continue;
        }
        if (!response.ok) {
            throw new Error(`ルームを作成できません: ${response.status} ${await response.text()}`);
        }
        return (await response.json()).roomId;
    }
}

async function connect(roomId) {
    const ws = new WebSocket(`${BASE_URL.replace(/^http/, "ws")}/api/rooms/${roomId}/ws`);
    const messages = [];
    ws.addEventListener("message", (event) => messages.push(JSON.parse(event.data)));
    await new Promise((resolve, reject) => {
        ws.addEventListener("open", resolve, { once: true });
        ws.addEventListener("error", () => reject(new Error("WebSocket に接続できません")), {
            once: true,
        });
    });
    return {
        send: (t, payload) => ws.send(JSON.stringify({ v: 1, t, clientMsgId: 1, payload })),
        async waitFor(description, predicate) {
            const deadline = Date.now() + MESSAGE_TIMEOUT_MS;
            for (;;) {
                const found = messages.find(predicate);
                if (found) return found.payload;
                if (Date.now() > deadline) {
                    throw new Error(`${description} が届きません: ${JSON.stringify(messages)}`);
                }
                await sleep(20);
            }
        },
        close: () => ws.close(),
    };
}

const isEvent = (kind) => (message) => message.t === "event" && message.payload.kind === kind;

async function record({ name, create, startSfen }) {
    const roomId = await createRoom({ ...DEFAULT_SETTINGS, ...create });
    const b = await connect(roomId);
    b.send("join", { seat: "b", name: "Alice" });
    await b.waitFor("先手の snapshot", (message) => message.t === "snapshot");
    if (startSfen !== undefined) {
        b.send("update_settings", { startSfen });
        await b.waitFor(`${name}: settings_updated`, isEvent("settings_updated"));
    }
    const w = await connect(roomId);
    w.send("join", { seat: "w", name: "Bob" });
    const gameStart = await b.waitFor("game_start", isEvent("game_start"));
    const s = await connect(roomId);
    s.send("join", { seat: "s", name: "Carol" });
    const snapshot = await s.waitFor("観戦者の snapshot", (message) => message.t === "snapshot");
    for (const client of [b, w, s]) client.close();
    return { name, create, ...(startSfen !== undefined ? { startSfen } : {}), gameStart, snapshot };
}

const recorded = [];
for (const testCase of CASES) {
    recorded.push(await record(testCase));
    console.error(`[record] ${testCase.name}`);
}
console.log(JSON.stringify(recorded, null, 4));
