// @vitest-environment node
// 対局画面を開くときに game_start から組み立てる snapshot が、RoomDO が対局開始直後に送る
// snapshot と一致することを、RoomDO の実際の出力と突き合わせて確かめる。
//
// - legacy: この repo の RoomDO（worker/room-do.ts）をテストの中で動かす
// - backend: 起動した backend の RoomDO から記録した fixtures/backend-game-start.json。
//   backendCommit は記録元の commit を示すだけで、いまの backend と一致することは確かめない
//   （この repo の CI から backend は見えない）。backend の RoomDO の対局開始まわりを変えたら、
//   scripts/record-room-game-start.mjs で記録し直す

import type { GameStartEvent, RoomSettings, SnapshotPayload } from "@shogi/match-client";
import { snapshotAtGameStart } from "@shogi/ui/components/online-game-state";
import { describe, expect, it, vi } from "vitest";
import recorded from "./fixtures/backend-game-start.json";

interface GameStartCase {
    name: string;
    /** ルーム作成時の設定（既定値との差分） */
    create: Partial<RoomSettings>;
    /** 1 人目が待機中に変更する開始局面 */
    startSfen?: string;
}

interface RecordedCase extends GameStartCase {
    gameStart: GameStartEvent;
    snapshot: SnapshotPayload;
}

const BACKEND_CASES = recorded.cases as RecordedCase[];

// 空白の読み方と手数の補い方が RoomDO の実装によって違う開始局面。game_start からは組み立てず、
// サーバーの snapshot を取り直す
const NOT_BUILT_LOCALLY = [
    "先頭に空白のある SFEN",
    "末尾に空白のある SFEN",
    "手番の前に空白が 2 つある SFEN",
    "タブ区切りの SFEN",
    "手数を省いた SFEN",
    "5 フィールドの SFEN",
];

/** game_start から組み立てた snapshot が、サーバーの snapshot と全フィールドで一致する */
function expectSameAsServer(gameStart: GameStartEvent, snapshot: SnapshotPayload): void {
    const built = snapshotAtGameStart(gameStart);

    expect(built).not.toBeNull();
    // 観戦者数は game_start に無く、待機中の snapshot から引き継ぐ
    expect({ ...built, spectators: snapshot.spectators }).toEqual(snapshot);
}

describe("backend の RoomDO が送った game_start と対局開始直後の snapshot", () => {
    it("記録に、組み立てる開始局面と組み立てない開始局面の両方がある", () => {
        const names = BACKEND_CASES.map((recordedCase) => recordedCase.name);

        expect(names.filter((name) => NOT_BUILT_LOCALLY.includes(name))).toHaveLength(5);
        expect(names.filter((name) => !NOT_BUILT_LOCALLY.includes(name))).toHaveLength(12);
    });

    it.each(
        BACKEND_CASES.filter(({ name }) => !NOT_BUILT_LOCALLY.includes(name)),
    )("$name: 組み立てた snapshot がサーバーの snapshot と一致する", ({ gameStart, snapshot }) => {
        expect(snapshot.status).toBe("playing");
        expectSameAsServer(gameStart, snapshot);
    });

    it.each(
        BACKEND_CASES.filter(({ name }) => NOT_BUILT_LOCALLY.includes(name)),
    )("$name: 組み立てない", ({ gameStart }) => {
        expect(snapshotAtGameStart(gameStart)).toBeNull();
    });
});

// ─── legacy の RoomDO をテストの中で動かす ────────────────────────────────────

interface FakeConnection {
    messages: Array<{ t: string; payload: Record<string, unknown> }>;
    send(data: string): void;
    serializeAttachment(value: unknown): void;
    deserializeAttachment(): unknown;
    close(): void;
}

interface LegacyRoomDO {
    fetch(request: Request): Promise<Response>;
    webSocketMessage(ws: FakeConnection, message: string): Promise<void>;
}

// RoomDO は Workers の型に依存するので、アプリ用の tsconfig でモジュール解決をさせない
const { RoomDO } = await vi.importActual<{
    RoomDO: new (state: unknown, env: unknown) => LegacyRoomDO;
}>("../../../worker/room-do");

const DEFAULT_SETTINGS: RoomSettings = {
    startSfen: "startpos",
    timeControl: { type: "byoyomi", initialMs: 600_000, byoyomiMs: 30_000 },
    passRights: null,
    aiSupport: null,
    takeback: false,
};

async function openLegacyRoom(settings: RoomSettings) {
    const storage = new Map<string, unknown>();
    const connections: FakeConnection[] = [];
    const room = new RoomDO(
        {
            storage: {
                get: async (key: string) => structuredClone(storage.get(key)),
                put: async (key: string, value: unknown) => {
                    storage.set(key, structuredClone(value));
                },
                setAlarm: async () => {},
                deleteAll: async () => storage.clear(),
            },
            getWebSockets: () => connections,
        },
        {},
    );
    await room.fetch(
        new Request("https://room/init", {
            method: "POST",
            body: JSON.stringify({ roomId: "room01", settings }),
        }),
    );

    return {
        connect() {
            let attachment: unknown = { seat: null, name: "", userId: null };
            const connection: FakeConnection = {
                messages: [],
                send: (data) => connection.messages.push(JSON.parse(data)),
                serializeAttachment: (value) => {
                    attachment = value;
                },
                deserializeAttachment: () => attachment,
                close: () => {},
            };
            connections.push(connection);
            return {
                messages: connection.messages,
                send: (t: string, payload: unknown) =>
                    room.webSocketMessage(
                        connection,
                        JSON.stringify({ v: 1, t, clientMsgId: 1, payload }),
                    ),
            };
        },
    };
}

/** 記録スクリプトと同じ手順で対局を始め、game_start と観戦者への snapshot を得る */
async function startOnLegacy({ create, startSfen }: GameStartCase) {
    const room = await openLegacyRoom({ ...DEFAULT_SETTINGS, ...create });
    const b = room.connect();
    await b.send("join", { seat: "b", name: "Alice" });
    if (startSfen !== undefined) {
        await b.send("update_settings", { startSfen });
    }
    const rejected = b.messages.some((message) => message.t === "error");
    const w = room.connect();
    await w.send("join", { seat: "w", name: "Bob" });
    const s = room.connect();
    await s.send("join", { seat: "s", name: "Carol" });

    const gameStart = b.messages.find(
        (message) => message.t === "event" && message.payload.kind === "game_start",
    )?.payload as GameStartEvent | undefined;
    const snapshot = s.messages.find((message) => message.t === "snapshot")?.payload as
        | SnapshotPayload
        | undefined;
    if (!gameStart || !snapshot) throw new Error("対局が始まりませんでした");
    return { rejected, gameStart, snapshot };
}

describe("legacy の RoomDO が送る game_start と対局開始直後の snapshot", () => {
    // legacy は 4 フィールド未満（空白 1 つで区切って数える）の開始局面を受け付けない
    const REJECTED_BY_LEGACY = ["タブ区切りの SFEN", "手数を省いた SFEN"];
    const LEGACY_CASES: GameStartCase[] = [
        ...BACKEND_CASES.filter(({ name }) => !REJECTED_BY_LEGACY.includes(name)),
        {
            name: "5 フィールドの SFEN",
            create: {},
            startSfen: "4k4/9/4p4/9/9/9/4P4/9/4K4 w - 1 extra",
        },
    ];

    it.each(
        LEGACY_CASES.filter(({ name }) => !NOT_BUILT_LOCALLY.includes(name)),
    )("$name: 組み立てた snapshot がサーバーの snapshot と一致する", async (legacyCase) => {
        const { rejected, gameStart, snapshot } = await startOnLegacy(legacyCase);

        expect(rejected).toBe(false);
        expect(gameStart.settings.startSfen).toBe(
            legacyCase.startSfen ?? legacyCase.create.startSfen ?? "startpos",
        );
        expect(snapshot.status).toBe("playing");
        expectSameAsServer(gameStart, snapshot);
    });

    it.each(
        LEGACY_CASES.filter(({ name }) => NOT_BUILT_LOCALLY.includes(name)),
    )("$name: 組み立てない", async (legacyCase) => {
        const { rejected, gameStart } = await startOnLegacy(legacyCase);

        expect(rejected).toBe(false);
        expect(gameStart.settings.startSfen).toBe(legacyCase.startSfen);
        expect(snapshotAtGameStart(gameStart)).toBeNull();
    });

    it("余分な空白のある後手番の SFEN を、legacy は先手番として始める", async () => {
        const { snapshot } = await startOnLegacy({
            name: "先頭に空白のある SFEN",
            create: {},
            startSfen: " 4k4/9/4p4/9/9/9/4P4/9/4K4 w - 1",
        });

        expect(snapshot.turn).toBe("b");
    });

    it.each(REJECTED_BY_LEGACY)("%s: legacy は受け付けず、平手のまま始まる", async (name) => {
        const rejectedCase = BACKEND_CASES.find((backendCase) => backendCase.name === name);
        if (!rejectedCase) throw new Error(`記録に ${name} がありません`);

        const { rejected, gameStart } = await startOnLegacy(rejectedCase);

        expect(rejected).toBe(true);
        expect(gameStart.settings.startSfen).toBe("startpos");
    });
});
