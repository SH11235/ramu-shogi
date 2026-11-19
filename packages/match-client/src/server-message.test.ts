import type {
    ClockState,
    RoomEvent,
    RoomSettings,
    ServerMessage,
    SnapshotPayload,
} from "@shogi/match-protocol";
import { describe, expect, it } from "vitest";
import { parseServerMessage } from "./server-message";

const clock = {
    b: { remainMs: 60000 },
    w: { remainMs: 60000 },
    running: "b",
    lastTickTs: 0,
} satisfies ClockState;
const settings = {
    startSfen: "startpos",
    timeControl: { type: "byoyomi", initialMs: 60000, byoyomiMs: 10000 },
    passRights: { initialCount: 1 },
    aiSupport: {
        b: { mode: "limited", limitCount: 1 },
        w: { mode: "unlimited", limitCount: null },
        searchDepth: null,
        searchTimeMs: 1000,
    },
    takeback: true,
} satisfies RoomSettings;
const player = { name: "Alice", online: true };
const result = { winner: "w", reason: "resign" } as const;
const snapshot = {
    eventId: 1,
    status: "playing",
    sfen: "startpos",
    moves: ["7g7f"],
    turn: "w",
    clock,
    passRights: null,
    players: { b: player, w: null },
    spectators: 1,
    settings,
} satisfies SnapshotPayload;
const eventBase = { eventId: 2, serverTs: 100 };
const positionUpdate = { turn: "w", clock, passRights: { b: 0, w: 1 } } as const;
const events = [
    { ...eventBase, kind: "game_start", settings, players: { b: player, w: player } },
    { ...eventBase, kind: "move", usi: "3c3d", ...positionUpdate },
    { ...eventBase, kind: "resign", seat: "b", result },
    { ...eventBase, kind: "timeout", seat: "b", result },
    { ...eventBase, kind: "checkmate", result },
    { ...eventBase, kind: "sennichite", result },
    { ...eventBase, kind: "illegal_move", seat: "b", usi: "7g7f", result },
    { ...eventBase, kind: "disconnect_loss", seat: "b", result },
    { ...eventBase, kind: "game_end", result, kifu: "", gameRecordId: "record-1" },
    { ...eventBase, kind: "player_online", seat: "s" },
    { ...eventBase, kind: "player_offline", seat: "w" },
    { ...eventBase, kind: "analysis_used", seat: "w", analysisRemaining: null },
    { ...eventBase, kind: "settings_updated", settings: { startSfen: "startpos" } },
    { ...eventBase, kind: "takeback_requested", seat: "b", ply: 1 },
    { ...eventBase, kind: "takeback_accepted", sfen: "startpos", ...positionUpdate },
    { ...eventBase, kind: "takeback_rejected" },
    { ...eventBase, kind: "takeback_cancelled" },
] satisfies RoomEvent[];

describe("parseServerMessage", () => {
    it.each([
        { v: 1, t: "joined", payload: { roomId: "room1", seat: "s", youAre: "spectator" } },
        { v: 1, t: "snapshot", payload: snapshot },
        { v: 1, t: "error", payload: { code: "DESYNC", message: "", clientMsgId: 2 } },
        { v: 1, t: "pong", payload: { ts: 100, serverTs: 120 } },
    ] satisfies ServerMessage[])("$t を受け入れる", (message) => {
        expect(parseServerMessage(message)).toEqual(message);
    });

    it.each(events)("$kind イベントを受け入れる", (payload) => {
        expect(parseServerMessage({ v: 1, t: "event", payload })).toBeDefined();
    });

    it("snapshot の任意項目を受け入れる", () => {
        const payload = {
            ...snapshot,
            result,
            gameRecordId: "record-1",
            pendingTakeback: { seat: "b", ply: 1 },
            analysisRemaining: { b: 0, w: null },
            analysisLog: [{ seat: "b", ply: 1 }],
            moveElapsedMs: [500],
        } satisfies SnapshotPayload;
        expect(parseServerMessage({ v: 1, t: "snapshot", payload })).toBeDefined();
    });

    it.each([
        ["null", null],
        ["array", []],
        ["unknown t", { v: 1, t: "future", payload: {} }],
        ["unknown v", { v: 2, t: "snapshot", payload: snapshot }],
        ["missing payload", { v: 1, t: "joined" }],
        ["array payload", { v: 1, t: "pong", payload: [] }],
        [
            "joined missing roomId",
            { v: 1, t: "joined", payload: { seat: "s", youAre: "spectator" } },
        ],
        [
            "invalid resumeToken",
            {
                v: 1,
                t: "joined",
                payload: { roomId: "room1", seat: "b", youAre: "player", resumeToken: 1 },
            },
        ],
        [
            "invalid clientMsgId",
            { v: 1, t: "error", payload: { code: "FUTURE_CODE", message: "", clientMsgId: "1" } },
        ],
        [
            "invalid error message",
            { v: 1, t: "error", payload: { code: "FUTURE_CODE", message: 1 } },
        ],
        ["invalid error code", { v: 1, t: "error", payload: { code: 1, message: "" } }],
        ["invalid pong timestamp", { v: 1, t: "pong", payload: { ts: 100, serverTs: "120" } }],
    ])("%s を拒む", (_label, message) => {
        expect(parseServerMessage(message)).toBeUndefined();
    });

    it.each([
        ["moves", { moves: ["7g7f", 1] }],
        ["clock", { clock: { ...clock, b: {} } }],
        ["settings", { settings: { ...settings, timeControl: null } }],
        ["players", { players: { b: player } }],
        ["result", { result: { reason: "resign" } }],
        ["result.reason", { result: { ...result, reason: 1 } }],
        ["analysisRemaining", { analysisRemaining: { b: 0 } }],
        ["analysisLog", { analysisLog: [null] }],
        ["pendingTakeback", { pendingTakeback: { seat: "s", ply: 1 } }],
        ["moveElapsedMs", { moveElapsedMs: [null] }],
    ])("snapshot の不正な %s を拒む", (_field, partial) => {
        expect(
            parseServerMessage({ v: 1, t: "snapshot", payload: { ...snapshot, ...partial } }),
        ).toBeUndefined();
    });

    it.each([
        { kind: "game_start", players: { b: player, w: player } },
        { kind: "move", ...positionUpdate, usi: 42 },
        { kind: "move", ...positionUpdate, usi: "3c3d", elapsedMs: "500" },
        { kind: "settings_updated", settings: {} },
        { kind: "takeback_accepted", ...positionUpdate, sfen: "startpos", clock: {} },
        { kind: "game_end", kifu: "" },
        { kind: "analysis_used", seat: "b", analysisRemaining: {} },
        { kind: "takeback_requested", seat: "b" },
        { kind: "future_kind", eventId: null },
    ])("共通項目または payload が不正な $kind を拒む", (payload) => {
        expect(
            parseServerMessage({ v: 1, t: "event", payload: { ...eventBase, ...payload } }),
        ).toBeUndefined();
    });

    it.each([
        [0, true],
        [Number.MAX_SAFE_INTEGER, true],
        [-1, false],
        [0.5, false],
        [Number.MAX_SAFE_INTEGER + 1, false],
    ])("snapshot と event の eventId %s の受理可否は %s", (eventId, accepted) => {
        const snapshotMessage = { v: 1, t: "snapshot", payload: { ...snapshot, eventId } };
        const eventMessage = {
            v: 1,
            t: "event",
            payload: { ...eventBase, kind: "player_online", seat: "b", eventId },
        };
        expect(parseServerMessage(snapshotMessage)).toEqual(accepted ? snapshotMessage : undefined);
        expect(parseServerMessage(eventMessage)).toEqual(accepted ? eventMessage : undefined);
    });

    it("追加フィールドや未知のイベント種別を受け入れる", () => {
        expect(
            parseServerMessage({
                v: 1,
                t: "snapshot",
                extra: true,
                payload: {
                    ...snapshot,
                    settings: { ...settings, extra: true },
                    extra: true,
                },
            }),
        ).toBeDefined();
        expect(
            parseServerMessage({
                v: 1,
                t: "event",
                payload: { ...eventBase, kind: "future_kind", extra: true },
            }),
        ).toBeDefined();
    });
});
