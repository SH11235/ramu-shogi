// オンライン対局画面のゲーム状態（局面・指し手の記録・終局結果）と、その更新規則

import { applyMoveWithState, getPositionService, type PositionState } from "@shogi/app-core";
import type {
    AiSupportPlayerSettings,
    ClockState,
    GameResult,
    GameStartEvent,
    PassRightsState,
    SnapshotPayload,
} from "@shogi/match-client";
import { exportToKifString } from "./shogi-match/utils/kifFormat";

export interface GameState {
    position: PositionState | null;
    /** 開始局面から現局面まで。常に usiMoveLog より 1 件多い */
    positionHistory: PositionState[];
    turn: "b" | "w";
    clockState: ClockState;
    gameResult: GameResult | null;
    offlineSeats: Set<string>;
    passRights: PassRightsState | null;
    myAnalysisRemaining: number | null;
    analysisLog: Array<{ seat: "b" | "w"; ply: number }>;
    /** elapsedMs は対局中に受信した指し手にだけ付く（snapshot は消費時間を持たない） */
    usiMoveLog: Array<{ usi: string; elapsedMs?: number }>;
    pendingTakeback: { seat: "b" | "w"; ply: number } | null;
}

/** snapshot から復元した局面。history は指し手を再生できた場合の全局面（開始局面〜現局面） */
interface RestoredPosition {
    position: PositionState;
    history: PositionState[] | null;
    moves: string[];
}

type GameAction =
    | ({ type: "init" } & RestoredPosition)
    | {
          type: "move";
          usi: string;
          turn: "b" | "w";
          clock: ClockState;
          passRights: PassRightsState | null;
      }
    | { type: "result"; result: GameResult }
    | { type: "player_offline"; seat: string }
    | { type: "player_online"; seat: string }
    | {
          type: "analysis_used";
          isMySeat: boolean;
          seat: "b" | "w";
          analysisRemaining: number | null;
          ply: number;
      }
    | ({
          type: "resync";
          turn: "b" | "w";
          clock: ClockState;
          passRights: PassRightsState | null;
      } & RestoredPosition)
    | { type: "takeback_requested"; seat: "b" | "w"; ply: number }
    | {
          type: "takeback_accepted";
          position: PositionState;
          turn: "b" | "w";
          clock: ClockState;
          passRights: PassRightsState | null;
      }
    | { type: "takeback_rejected" }
    | { type: "takeback_cancelled" };

export function makeInitialGameState(
    snapshot: SnapshotPayload,
    myAiSettings: AiSupportPlayerSettings | null,
): GameState {
    return {
        position: null,
        positionHistory: [],
        turn: snapshot.turn,
        clockState: snapshot.clock,
        gameResult: snapshot.result ?? null,
        offlineSeats: new Set(),
        passRights: snapshot.passRights,
        myAnalysisRemaining:
            myAiSettings?.mode === "limited" ? (myAiSettings.limitCount ?? 0) : null,
        analysisLog: [],
        usiMoveLog: [],
        pendingTakeback: null,
    };
}

// パス手は局面変化なし（手番のみ交代）。
// PositionState に passRights が未設定のため applyMoveWithState は使わない
function passTurn(position: PositionState): PositionState {
    return { ...position, turn: position.turn === "sente" ? "gote" : "sente" };
}

/** 指し手を再生できた場合だけ記録を復元する。できなければ現局面だけを持つ */
function restoredRecord(
    restored: RestoredPosition,
    knownLog: GameState["usiMoveLog"],
): Pick<GameState, "position" | "positionHistory" | "usiMoveLog"> {
    if (!restored.history) {
        return {
            position: restored.position,
            positionHistory: [restored.position],
            usiMoveLog: [],
        };
    }
    return {
        position: restored.position,
        positionHistory: restored.history,
        usiMoveLog: restored.moves.map((usi, i) => {
            const known = knownLog[i];
            return known?.usi === usi ? known : { usi };
        }),
    };
}

export function gameReducer(state: GameState, action: GameAction): GameState {
    switch (action.type) {
        case "init":
            return { ...state, ...restoredRecord(action, []) };
        case "move": {
            if (!state.position) return state;
            // 消費時間: 動いた側の残り時間の差分（手番交代前の turn が動いた側）
            const movedSeat = state.turn;
            const elapsedMs = Math.max(
                0,
                state.clockState[movedSeat].remainMs - action.clock[movedSeat].remainMs,
            );
            const next =
                action.usi === "pass"
                    ? passTurn(state.position)
                    : applyMoveWithState(state.position, action.usi).next;
            return {
                ...state,
                position: next,
                positionHistory: [...state.positionHistory, next],
                turn: action.turn,
                clockState: action.clock,
                passRights: action.passRights,
                usiMoveLog: [...state.usiMoveLog, { usi: action.usi, elapsedMs }],
            };
        }
        case "result":
            // 終局は終局イベント・game_end・棋譜 ID 付きの game_end・snapshot と複数回届く。
            // 最初の結果を保ち、gameResult に依存する処理が終局後に再実行されないようにする
            return state.gameResult ? state : { ...state, gameResult: action.result };
        case "player_offline":
            return {
                ...state,
                offlineSeats: new Set([...state.offlineSeats, action.seat]),
            };
        case "player_online": {
            const next = new Set(state.offlineSeats);
            next.delete(action.seat);
            return { ...state, offlineSeats: next };
        }
        case "analysis_used":
            return {
                ...state,
                myAnalysisRemaining: action.isMySeat
                    ? action.analysisRemaining
                    : state.myAnalysisRemaining,
                analysisLog: [...state.analysisLog, { seat: action.seat, ply: action.ply }],
            };
        case "resync":
            return {
                ...state,
                ...restoredRecord(action, state.usiMoveLog),
                turn: action.turn,
                clockState: action.clock,
                passRights: action.passRights,
            };
        case "takeback_requested":
            return { ...state, pendingTakeback: { seat: action.seat, ply: action.ply } };
        case "takeback_accepted":
            return {
                ...state,
                position: action.position,
                // 取り消された手の後の局面を落とし、その前の局面をサーバーが通知した局面に置き換える
                positionHistory: [...state.positionHistory.slice(0, -2), action.position],
                turn: action.turn,
                clockState: action.clock,
                passRights: action.passRights,
                usiMoveLog: state.usiMoveLog.slice(0, -1),
                pendingTakeback: null,
            };
        case "takeback_rejected":
            return { ...state, pendingTakeback: null };
        case "takeback_cancelled":
            return { ...state, pendingTakeback: null };
    }
}

// ルーム設定の startSfen に入る駒落ちプリセットの名前と、サーバーがそれを展開する局面。
// 局面の解析や合法手の生成はプリセットの名前を受け付けないので、同じ対応をここにも持つ
const HANDICAP_PRESETS: Record<string, { sfen: string; kifName: string }> = {
    "handicap:bishop": {
        sfen: "lnsgkgsnl/1r7/ppppppppp/9/9/9/PPPPPPPPP/1B5R1/LNSGKGSNL w - 1",
        kifName: "角落ち",
    },
    "handicap:rook": {
        sfen: "lnsgkgsnl/7b1/ppppppppp/9/9/9/PPPPPPPPP/1B5R1/LNSGKGSNL w - 1",
        kifName: "飛車落ち",
    },
    "handicap:rook-bishop": {
        sfen: "lnsgkgsnl/9/ppppppppp/9/9/9/PPPPPPPPP/1B5R1/LNSGKGSNL w - 1",
        kifName: "飛車角落ち",
    },
};

/** ルーム設定の startSfen を局面として解釈できる文字列にする */
export function resolveStartSfen(startSfen: string): string {
    return HANDICAP_PRESETS[startSfen]?.sfen ?? startSfen;
}

// サーバーが startSfen の "startpos" を展開する局面
const STARTPOS_SFEN = "lnsgkgsnl/1r5b1/ppppppppp/9/9/9/PPPPPPPPP/1B5R1/LNSGKGSNL b - 1";

/** 観戦者数は game_start に含まれないので、対局開始時点の snapshot からは除く */
export type GameStartSnapshot = Omit<SnapshotPayload, "spectators">;

/**
 * game_start イベントから、対局開始時点の snapshot を組み立てる。
 * サーバーは対局開始時に snapshot を送らず、待機中に受け取った snapshot はその後の開始局面の
 * 変更を反映していない。game_start の設定はサーバーが対局に使うものなので、局面・手番・時計を
 * サーバーと同じ規則でそこから求める。
 * 開始局面を解釈できなければ（この画面が知らないプリセット名など）null を返す。
 */
export function snapshotAtGameStart(event: GameStartEvent): GameStartSnapshot | null {
    const { settings } = event;
    const fields = (
        settings.startSfen === "startpos" ? STARTPOS_SFEN : resolveStartSfen(settings.startSfen)
    )
        .trim()
        .split(/\s+/);
    const turn = fields[1];
    if (fields.length < 3 || (turn !== "b" && turn !== "w")) return null;
    // 手数を省いた局面は、サーバーが 1 手目として補う
    if (fields.length === 3) fields.push("1");

    const { timeControl, passRights } = settings;
    const isUnlimited =
        timeControl.initialMs === 0 && (timeControl.type !== "byoyomi" || !timeControl.byoyomiMs);
    return {
        eventId: event.eventId,
        status: "playing",
        sfen: fields.join(" "),
        moves: [],
        turn,
        clock: {
            b: { remainMs: timeControl.initialMs },
            w: { remainMs: timeControl.initialMs },
            running: isUnlimited ? null : turn,
            lastTickTs: event.serverTs,
        },
        passRights: passRights ? { b: passRights.initialCount, w: passRights.initialCount } : null,
        players: event.players,
        settings,
    };
}

/**
 * 開始局面から指し手を再生し、開始局面から現局面までの全局面を返す。
 * snapshot は指し手の列しか持たないため、棋譜パネルと KIF 出力に要る各手の局面はここで作る。
 * 再生できない指し手があれば null を返す。
 */
async function replayPositions(
    startSfen: string,
    moves: string[],
    current: PositionState,
): Promise<PositionState[] | null> {
    if (moves.length === 0) return [current];
    try {
        let position = await getPositionService().parseSfen(resolveStartSfen(startSfen));
        const history: PositionState[] = [];
        for (const usi of moves) {
            history.push(position);
            if (usi === "pass") {
                position = passTurn(position);
                continue;
            }
            const applied = applyMoveWithState(position, usi);
            if (!applied.ok) return null;
            position = applied.next;
        }
        return [...history, current];
    } catch {
        return null;
    }
}

export async function restorePosition(
    snapshot: Pick<SnapshotPayload, "sfen" | "moves" | "settings">,
): Promise<RestoredPosition> {
    const position = await getPositionService().parseSfen(snapshot.sfen);
    return {
        position,
        history: await replayPositions(snapshot.settings.startSfen, snapshot.moves, position),
        moves: snapshot.moves,
    };
}

/** 対局終了後のダウンロード・コピー用の KIF。指し手の記録が無ければ空文字 */
export function exportGameKif(
    state: Pick<GameState, "usiMoveLog" | "positionHistory">,
    startSfen: string,
    playerNames: { b: string; w: string },
): string {
    if (state.usiMoveLog.length === 0) return "";
    return exportToKifString(
        state.usiMoveLog.map((entry, i) => ({
            ply: i + 1,
            usiMove: entry.usi,
            elapsedMs: entry.elapsedMs,
            kifText: "",
            displayText: "",
        })),
        state.positionHistory.slice(0, state.usiMoveLog.length).map((p) => p.board),
        {
            senteName: playerNames.b,
            goteName: playerNames.w,
            handicap: HANDICAP_PRESETS[startSfen]?.kifName,
            startSfen: resolveStartSfen(startSfen),
        },
    );
}

export interface SerialQueue<T> {
    push(item: T): void;
    /** isActive が偽の間に止まっていた処理を再開する */
    resume(): void;
}

/**
 * 受け取ったものを届いた順に 1 件ずつ処理する。処理が Promise を返したら、
 * それが終わるまで次へ進まない。同期で終わる処理は push の中でそのまま実行する。
 */
export function createSerialQueue<T>(
    handle: (item: T) => void | Promise<void>,
    isActive: () => boolean,
): SerialQueue<T> {
    const items: T[] = [];
    let draining = false;

    const drain = async (): Promise<void> => {
        if (draining) return;
        draining = true;
        try {
            while (isActive()) {
                const [item] = items.splice(0, 1);
                if (item === undefined) break;
                try {
                    const pending = handle(item);
                    if (pending) await pending;
                } catch (error) {
                    console.error("[OnlineGameView] Failed to apply a server message:", error);
                }
            }
        } finally {
            draining = false;
        }
    };

    return {
        push(item) {
            items.push(item);
            void drain();
        },
        resume() {
            void drain();
        },
    };
}
