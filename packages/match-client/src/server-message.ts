import type { ErrorCode, ErrorMessage } from "@shogi/match-protocol";
import type { ServerMessage } from "./types";

const errorCodes: Record<ErrorCode, true> = {
    ROOM_FULL: true,
    ROOM_NOT_FOUND: true,
    ROOM_FINISHED: true,
    ROOM_EXPIRED: true,
    INVALID_TOKEN: true,
    DESYNC: true,
    ILLEGAL_MOVE: true,
    CHECKMATE_NOT_CONFIRMED: true,
    NOT_YOUR_TURN: true,
    RATE_LIMITED: true,
    SPECTATOR_FORBIDDEN: true,
    ANALYSIS_LIMIT_EXCEEDED: true,
    AI_SUPPORT_DISABLED: true,
    TAKEBACK_DISABLED: true,
    TAKEBACK_NOT_PENDING: true,
    TAKEBACK_ALREADY_PENDING: true,
    TAKEBACK_NO_MOVES: true,
    UNKNOWN: true,
};

type ReceivedErrorMessage = Omit<ErrorMessage, "payload"> & {
    payload: Omit<ErrorMessage["payload"], "code"> & { code: string };
};

function isErrorCode(code: string): code is ErrorCode {
    return Object.hasOwn(errorCodes, code);
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isNumber(value: unknown): boolean {
    return typeof value === "number" && Number.isFinite(value);
}

function isEventId(value: unknown): boolean {
    return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function isSide(value: unknown): boolean {
    return value === "b" || value === "w";
}

function isSeat(value: unknown): boolean {
    return isSide(value) || value === "s";
}

function isNullableNumber(value: unknown): boolean {
    return value === null || isNumber(value);
}

function isOptionalNumber(value: unknown): boolean {
    return value === undefined || isNumber(value);
}

function isOptionalString(value: unknown): boolean {
    return value === undefined || typeof value === "string";
}

function isClockSide(value: unknown): boolean {
    return isRecord(value) && isNumber(value.remainMs);
}

function isClock(value: unknown): boolean {
    return (
        isRecord(value) &&
        isClockSide(value.b) &&
        isClockSide(value.w) &&
        (value.running === null || isSide(value.running)) &&
        isNumber(value.lastTickTs)
    );
}

function isPassRights(value: unknown): boolean {
    return value === null || (isRecord(value) && isNumber(value.b) && isNumber(value.w));
}

function isPlayer(value: unknown): boolean {
    return isRecord(value) && typeof value.name === "string" && typeof value.online === "boolean";
}

function isTimeControl(value: unknown): boolean {
    return (
        isRecord(value) &&
        (value.type === "byoyomi" || value.type === "fischer") &&
        isNumber(value.initialMs) &&
        isOptionalNumber(value.byoyomiMs) &&
        isOptionalNumber(value.fischerIncrementMs)
    );
}

function isAiSupportPlayer(value: unknown): boolean {
    return (
        isRecord(value) &&
        (value.mode === "unlimited" || value.mode === "limited") &&
        isNullableNumber(value.limitCount)
    );
}

function isAiSupport(value: unknown): boolean {
    return (
        value === null ||
        (isRecord(value) &&
            isAiSupportPlayer(value.b) &&
            isAiSupportPlayer(value.w) &&
            isNullableNumber(value.searchDepth) &&
            isNullableNumber(value.searchTimeMs))
    );
}

function isSettings(value: unknown): boolean {
    return (
        isRecord(value) &&
        typeof value.startSfen === "string" &&
        isTimeControl(value.timeControl) &&
        (value.passRights === null ||
            (isRecord(value.passRights) && isNumber(value.passRights.initialCount))) &&
        isAiSupport(value.aiSupport) &&
        typeof value.takeback === "boolean"
    );
}

function isResult(value: unknown): boolean {
    return (
        isRecord(value) &&
        (value.winner === null || isSide(value.winner)) &&
        typeof value.reason === "string"
    );
}

function isSideAtPly(value: unknown): boolean {
    return isRecord(value) && isSide(value.seat) && isNumber(value.ply);
}

function isAnalysisRemaining(value: unknown): boolean {
    return isRecord(value) && isNullableNumber(value.b) && isNullableNumber(value.w);
}

function isSnapshot(payload: Record<string, unknown>): boolean {
    return (
        isEventId(payload.eventId) &&
        (payload.status === "waiting" ||
            payload.status === "playing" ||
            payload.status === "finished") &&
        typeof payload.sfen === "string" &&
        Array.isArray(payload.moves) &&
        payload.moves.every((move) => typeof move === "string") &&
        isPositionUpdate(payload) &&
        isRecord(payload.players) &&
        (payload.players.b === null || isPlayer(payload.players.b)) &&
        (payload.players.w === null || isPlayer(payload.players.w)) &&
        isNumber(payload.spectators) &&
        isSettings(payload.settings) &&
        (payload.result === undefined || isResult(payload.result)) &&
        isOptionalString(payload.gameRecordId) &&
        (payload.pendingTakeback === undefined ||
            payload.pendingTakeback === null ||
            isSideAtPly(payload.pendingTakeback)) &&
        (payload.analysisRemaining === undefined ||
            isAnalysisRemaining(payload.analysisRemaining)) &&
        (payload.analysisLog === undefined ||
            (Array.isArray(payload.analysisLog) && payload.analysisLog.every(isSideAtPly))) &&
        (payload.moveElapsedMs === undefined ||
            (Array.isArray(payload.moveElapsedMs) && payload.moveElapsedMs.every(isNumber)))
    );
}

function isPositionUpdate(payload: Record<string, unknown>): boolean {
    return isSide(payload.turn) && isClock(payload.clock) && isPassRights(payload.passRights);
}

function isEvent(payload: Record<string, unknown>): boolean {
    if (
        !isEventId(payload.eventId) ||
        !isNumber(payload.serverTs) ||
        typeof payload.kind !== "string"
    ) {
        return false;
    }
    switch (payload.kind) {
        case "game_start":
            return (
                isSettings(payload.settings) &&
                isRecord(payload.players) &&
                isPlayer(payload.players.b) &&
                isPlayer(payload.players.w)
            );
        case "move":
            return (
                isPositionUpdate(payload) &&
                typeof payload.usi === "string" &&
                isOptionalNumber(payload.elapsedMs)
            );
        case "resign":
        case "timeout":
        case "disconnect_loss":
            return isSeat(payload.seat) && isResult(payload.result);
        case "checkmate":
        case "sennichite":
            return isResult(payload.result);
        case "illegal_move":
            return (
                isSeat(payload.seat) && typeof payload.usi === "string" && isResult(payload.result)
            );
        case "game_end":
            return (
                isResult(payload.result) &&
                typeof payload.kifu === "string" &&
                isOptionalString(payload.gameRecordId)
            );
        case "player_online":
        case "player_offline":
            return isSeat(payload.seat);
        case "analysis_used":
            return isSeat(payload.seat) && isNullableNumber(payload.analysisRemaining);
        case "settings_updated":
            return isRecord(payload.settings) && typeof payload.settings.startSfen === "string";
        case "takeback_requested":
            return isSeat(payload.seat) && isNumber(payload.ply);
        case "takeback_accepted":
            return isPositionUpdate(payload) && typeof payload.sfen === "string";
        default:
            // The game handler still advances the event cursor for unrecognized kinds.
            return true;
    }
}

function isServerMessage(
    value: unknown,
): value is Exclude<ServerMessage, ErrorMessage> | ReceivedErrorMessage {
    if (!isRecord(value) || value.v !== 1 || !isRecord(value.payload)) return false;
    const { payload } = value;
    switch (value.t) {
        case "joined":
            return (
                typeof payload.roomId === "string" &&
                isSeat(payload.seat) &&
                (payload.youAre === "player" || payload.youAre === "spectator") &&
                isOptionalString(payload.resumeToken)
            );
        case "snapshot":
            return isSnapshot(payload);
        case "event":
            return isEvent(payload);
        case "error":
            return (
                typeof payload.code === "string" &&
                typeof payload.message === "string" &&
                isOptionalNumber(payload.clientMsgId)
            );
        case "pong":
            return isNumber(payload.ts) && isNumber(payload.serverTs);
        default:
            return false;
    }
}

export function parseServerMessage(value: unknown): ServerMessage | undefined {
    if (!isServerMessage(value)) return undefined;
    if (value.t !== "error") return value;
    const { code } = value.payload;
    return { ...value, payload: { ...value.payload, code: isErrorCode(code) ? code : "UNKNOWN" } };
}
