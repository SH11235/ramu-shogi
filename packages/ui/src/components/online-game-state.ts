// オンライン対局画面のゲーム状態（局面・指し手の記録・終局結果）と、その更新規則

import { applyMoveWithState, getPositionService, type PositionState } from "@shogi/app-core";
import type {
    AiSupportPlayerSettings,
    ClockState,
    GameResult,
    GameStartEvent,
    PassRightsState,
    Seat,
    SnapshotPayload,
} from "@shogi/match-client";
import { exportToKifString, type KifEnding } from "./shogi-match/utils/kifFormat";

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
    /** elapsedMs は対局中に受信した指し手と、消費時間を持つ snapshot から復元した指し手にだけ付く */
    usiMoveLog: Array<{ usi: string; elapsedMs?: number }>;
    pendingTakeback: { seat: "b" | "w"; ply: number } | null;
}

/** snapshot から復元した局面。history は指し手を再生できた場合の全局面（開始局面〜現局面） */
interface RestoredPosition {
    position: PositionState;
    history: PositionState[] | null;
    moves: string[];
    /** moves と同じ並びの各手の消費時間。旧サーバーの snapshot には無い */
    moveElapsedMs?: number[];
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
          /** undefined は snapshot に無い（旧サーバー）ので、今の状態を保つ */
          pendingTakeback?: GameState["pendingTakeback"];
          myAnalysisRemaining?: number | null;
          analysisLog?: GameState["analysisLog"];
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

/** snapshot が自分の席の残り回数を持たなければ（旧サーバー・観戦者）undefined */
export function snapshotAnalysisRemaining(
    snapshot: SnapshotPayload,
    seat: Seat,
): number | null | undefined {
    return seat === "s" ? undefined : snapshot.analysisRemaining?.[seat];
}

export function makeInitialGameState(
    snapshot: SnapshotPayload,
    myAiSettings: AiSupportPlayerSettings | null,
    seat: Seat,
): GameState {
    const remaining = snapshotAnalysisRemaining(snapshot, seat);
    return {
        position: null,
        positionHistory: [],
        turn: snapshot.turn,
        clockState: snapshot.clock,
        gameResult: snapshot.result ?? null,
        offlineSeats: new Set(),
        passRights: snapshot.passRights,
        myAnalysisRemaining:
            remaining !== undefined
                ? remaining
                : myAiSettings?.mode === "limited"
                  ? (myAiSettings.limitCount ?? 0)
                  : null,
        analysisLog: snapshot.analysisLog ?? [],
        usiMoveLog: [],
        pendingTakeback: snapshot.pendingTakeback ?? null,
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
            const elapsedMs = restored.moveElapsedMs?.[i];
            if (elapsedMs !== undefined) return { usi, elapsedMs };
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
                pendingTakeback:
                    action.pendingTakeback === undefined
                        ? state.pendingTakeback
                        : action.pendingTakeback,
                myAnalysisRemaining:
                    action.myAnalysisRemaining === undefined
                        ? state.myAnalysisRemaining
                        : action.myAnalysisRemaining,
                analysisLog: action.analysisLog ?? state.analysisLog,
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
 * game_start から対局開始時点の snapshot を組み立てる。空白の読み方と省かれた手数の補い方はサーバーの
 * 解釈を再現しないので、空白 1 つ区切りの 4 フィールドの開始局面以外は null を返す。
 */
export function snapshotAtGameStart(event: GameStartEvent): GameStartSnapshot | null {
    const { settings } = event;
    const sfen =
        settings.startSfen === "startpos" ? STARTPOS_SFEN : resolveStartSfen(settings.startSfen);
    const turn = /^\S+ ([bw]) \S+ \S+$/.exec(sfen)?.[1];
    if (turn !== "b" && turn !== "w") return null;

    const { timeControl, passRights } = settings;
    const isUnlimited =
        timeControl.initialMs === 0 && (timeControl.type !== "byoyomi" || !timeControl.byoyomiMs);
    return {
        eventId: event.eventId,
        status: "playing",
        sfen,
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
    const history = await positionsBeforeMoves(startSfen, moves);
    return history ? [...history, current] : null;
}

/** 各手を指す直前の局面。再生できない指し手があれば null */
async function positionsBeforeMoves(
    startSfen: string,
    moves: string[],
): Promise<PositionState[] | null> {
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
        return history;
    } catch {
        return null;
    }
}

export async function restorePosition(
    snapshot: Pick<SnapshotPayload, "sfen" | "moves" | "settings" | "moveElapsedMs">,
): Promise<RestoredPosition> {
    const position = await getPositionService().parseSfen(snapshot.sfen);
    const moveElapsedMs = matchingMoveElapsedMs(snapshot.moveElapsedMs, snapshot.moves);
    return {
        position,
        history: await replayPositions(snapshot.settings.startSfen, snapshot.moves, position),
        moves: snapshot.moves,
        ...(moveElapsedMs ? { moveElapsedMs } : {}),
    };
}

/** 数が指し手と合わない消費時間は、どの手のものか決められないので使わない */
function matchingMoveElapsedMs(
    moveElapsedMs: unknown,
    moves: readonly string[],
): number[] | undefined {
    if (!Array.isArray(moveElapsedMs) || moveElapsedMs.length !== moves.length) return undefined;
    return moveElapsedMs.every((ms) => typeof ms === "number" && Number.isFinite(ms) && ms >= 0)
        ? moveElapsedMs
        : undefined;
}

/** 終局の結果。保存された棋譜の reason はサーバーが書いた文字列のまま届く */
interface KifGameResult {
    winner: "b" | "w" | null;
    reason: string;
}

/** 対局終了後のダウンロード・コピー用の KIF。指し手も終局の結果も無ければ空文字 */
export function exportGameKif(
    state: Pick<GameState, "usiMoveLog" | "positionHistory" | "gameResult">,
    startSfen: string,
    playerNames: { b: string; w: string },
): string {
    if (state.usiMoveLog.length === 0 && !state.gameResult) return "";
    return formatKif(
        state.usiMoveLog,
        state.positionHistory.slice(0, state.usiMoveLog.length),
        HANDICAP_PRESETS[startSfen]?.kifName,
        resolveStartSfen(startSfen),
        playerNames,
        state.gameResult,
    );
}

/**
 * 保存された棋譜の KIF。保存される開始局面はサーバーがプリセットを展開した SFEN なので、手合割の名前は
 * 展開後の局面から引く。指し手が無くても手合割と開始局面は書き、再生できなければ null
 */
export async function exportGameRecordKif(
    record: {
        initialSfen: string;
        moves: string[];
        result?: KifGameResult | null;
        /** 保存時の metadata の値をそのまま渡してよい。指し手と合わなければ消費時間を書かない */
        moveElapsedMs?: unknown;
    },
    playerNames: { b: string; w: string },
): Promise<string | null> {
    const startSfen = resolveStartSfen(record.initialSfen);
    const history = await positionsBeforeMoves(startSfen, record.moves);
    if (!history) return null;
    const preset =
        HANDICAP_PRESETS[record.initialSfen] ??
        Object.values(HANDICAP_PRESETS).find((p) => p.sfen === startSfen);
    const moveElapsedMs = matchingMoveElapsedMs(record.moveElapsedMs, record.moves);
    return formatKif(
        record.moves.map((usi, i) => ({ usi, elapsedMs: moveElapsedMs?.[i] })),
        history,
        preset?.kifName,
        startSfen,
        playerNames,
        record.result,
    );
}

/** 開始局面の手番から、パスも 1 手として数えて最後の手の後の手番を求める */
function sideToMoveAfter(startSfen: string, moveCount: number): "b" | "w" {
    const startTurn = startSfen.trim().split(/\s+/)[1] === "w" ? "w" : "b";
    return moveCount % 2 === 0 ? startTurn : startTurn === "b" ? "w" : "b";
}

/**
 * 終局語と「まで」の行は Kifu for Windows が書く形に合わせる。投了・詰み・切れ負けは手番の側が
 * 負けたことを表すので、手番でない側が負けた（手番外の投了など）ときは終局語を書かない。
 * 切断に当たる語は無いので、他のソフトが勝敗を読める標準の形にして理由はコメントに残す
 */
function kifEnding(result: KifGameResult, sideToMove: "b" | "w"): KifEnding {
    const { winner, reason } = result;
    if (winner === null) {
        return reason === "sennichite"
            ? { specialMove: "千日手", summary: "千日手" }
            : { specialMove: "中断", summary: "中断" };
    }
    const winnerLabel = winner === "b" ? "先手" : "後手";
    const loserLabel = winner === "b" ? "後手" : "先手";
    const loserToMove = winner !== sideToMove;
    const onLoserTurn = (specialMove: string) => (loserToMove ? { specialMove } : {});
    switch (reason) {
        case "resign":
            return { ...onLoserTurn("投了"), summary: `${winnerLabel}の勝ち` };
        case "checkmate":
            return { ...onLoserTurn("詰み"), summary: `${winnerLabel}の勝ち` };
        case "timeout":
            return { ...onLoserTurn("切れ負け"), summary: `時間切れにより${winnerLabel}の勝ち` };
        case "illegal_move":
            return {
                specialMove: loserToMove ? "反則負け" : "反則勝ち",
                summary: `${loserLabel}の反則負け`,
            };
        case "disconnect":
            return { summary: `${winnerLabel}の勝ち`, comment: "切断" };
        default:
            return { summary: `${winnerLabel}の勝ち` };
    }
}

function formatKif(
    moves: ReadonlyArray<{ usi: string; elapsedMs?: number }>,
    positionsBefore: PositionState[],
    handicap: string | undefined,
    startSfen: string,
    playerNames: { b: string; w: string },
    result: KifGameResult | null | undefined,
): string {
    return exportToKifString(
        moves.map((entry, i) => ({
            ply: i + 1,
            usiMove: entry.usi,
            elapsedMs: entry.elapsedMs,
            kifText: "",
            displayText: "",
        })),
        positionsBefore.map((p) => p.board),
        {
            senteName: playerNames.b,
            goteName: playerNames.w,
            handicap,
            startSfen,
            ending: result
                ? kifEnding(result, sideToMoveAfter(startSfen, moves.length))
                : undefined,
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
