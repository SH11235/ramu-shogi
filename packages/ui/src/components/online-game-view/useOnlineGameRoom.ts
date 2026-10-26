import { getPositionService } from "@shogi/app-core";
import type {
    AiSupportSettings,
    ErrorCode,
    RoomClient,
    RoomClientStatus,
    RoomEvent,
    Seat,
    SnapshotPayload,
} from "@shogi/match-client";
import {
    getStoredResumeToken,
    isResumeTokenRejected,
    removeStoredResumeToken,
    removeStoredSeat,
} from "@shogi/match-client";
import type { RefObject } from "react";
import { useEffect, useEffectEvent, useReducer, useRef, useState } from "react";
import {
    createSerialQueue,
    type GameState,
    gameReducer,
    makeInitialGameState,
    resolveStartSfen,
    restorePosition,
    type SerialQueue,
    snapshotAnalysisRemaining,
} from "../online-game-state";

/** 局面も手番も終局も変えないイベント。指し手を送る準備の途中に届いても、その指し手は有効 */
const POSITION_KEEPING_EVENTS: ReadonlySet<RoomEvent["kind"]> = new Set([
    "player_offline",
    "player_online",
    "analysis_used",
    "settings_updated",
    "takeback_requested",
    "takeback_rejected",
    "takeback_cancelled",
]);

/** 再接続後、席へ戻った結果の snapshot を待つ上限。過ぎたら要求を送り直す */
const RESYNC_TIMEOUT_MS = 15_000;
/** snapshot の要求を送り直す回数の上限。尽きたら再読み込みを案内する */
const RESYNC_MAX_RETRIES = 2;

/**
 * 同期を待つ間にこれらが返ったら、送り直しても同じ席へは戻れない。ROOM_FINISHED は、切断中に
 * 終局した部屋へ参加し直そうとした観戦者（と、トークンを持たない対局者）に返る
 */
const SEAT_LOST_CODES: ReadonlySet<ErrorCode> = new Set([
    "INVALID_TOKEN",
    "ROOM_NOT_FOUND",
    "ROOM_EXPIRED",
    "ROOM_FULL",
    "ROOM_FINISHED",
]);

/**
 * 対局中の接続。reconnecting は WebSocket を開き直している間と、開いた後に席へ戻って
 * サーバーの snapshot を反映し終えるまで。lost は再接続か再同期を諦め、再読み込みを案内する状態。
 * rejected はサーバーが席への復帰を拒んだ状態で、finished は拒んだ理由が終局だったとき
 */
export type GameConnection =
    | { state: "connected" }
    | { state: "reconnecting" }
    | { state: "lost"; canResume: boolean }
    | { state: "rejected"; finished: boolean };

/**
 * 届いた順に反映するサーバーからのメッセージ。initial は画面を開いたときの snapshot。
 * resync は、再接続後の同期を待っている間に届いた snapshot に付く、その再接続の番号
 */
type Incoming =
    | { t: "snapshot"; payload: SnapshotPayload; initial: boolean; resync?: number }
    | { t: "event"; payload: RoomEvent };

interface UseOnlineGameRoomOptions {
    client: RoomClient;
    snapshot: SnapshotPayload;
    seat: Seat;
    roomId: string;
    myAiSettings: AiSupportSettings["b"] | null;
    /** 参加した席のまま、サーバーが必ず snapshot を返す要求を送る。送る手段が無ければ false */
    requestFullSnapshot?: () => boolean;
    /** 再同期や待ったで、見ている局面ごと置き換わった */
    onPositionReset: () => void;
    /** 指し手を反映した。nextTurn は着手後の手番 */
    onMoveApplied: (usi: string, nextTurn: Seat) => void;
    /** サーバーが操作を拒んだ。appliedMovesKey は、その時点で反映し終えた指し手列 */
    onCommandRejected: (code: ErrorCode, appliedMovesKey: string) => void;
}

interface OnlineGameRoom {
    gameState: GameState;
    connection: GameConnection;
    /** 画面を開いたときの局面を読み込めなかった */
    loadFailed: boolean;
    startSfenRef: RefObject<string>;
    /** 反映し終えた指し手列（USI） */
    movesRef: RefObject<string[]>;
    gameRecordIdRef: RefObject<string | null>;
    appliedEventIdRef: RefObject<number>;
    connectionEpochRef: RefObject<number>;
    positionVersionRef: RefObject<number>;
}

/**
 * 対局中のルームの購読。サーバーからのメッセージを届いた順に対局の状態へ反映し、
 * 切断・再接続と、再接続後に席へ戻るまでの同期を受け持つ
 */
export function useOnlineGameRoom({
    client,
    snapshot,
    seat,
    roomId,
    myAiSettings,
    requestFullSnapshot,
    onPositionReset,
    onMoveApplied,
    onCommandRejected,
}: UseOnlineGameRoomOptions): OnlineGameRoom {
    const [gameState, dispatch] = useReducer(gameReducer, undefined, () =>
        makeInitialGameState(snapshot, myAiSettings, seat),
    );

    const startSfenRef = useRef(resolveStartSfen(snapshot.settings.startSfen));
    const movesRef = useRef<string[]>([...snapshot.moves]);
    const gameRecordIdRef = useRef<string | null>(snapshot.gameRecordId ?? null);
    // 画面に反映し終えた最新のイベント。操作の送信にはこの番号を使う: 受信しただけで
    // まだ反映していないイベントの番号を送ると、古い局面を見て選んだ操作がサーバーを通ってしまう
    const appliedEventIdRef = useRef(snapshot.eventId);

    const [connection, setConnection] = useState<GameConnection>({ state: "connected" });
    // 切断・再接続のたびに進む。非同期処理の前後で比べ、その間に接続が替わったかを知る
    const connectionEpochRef = useRef(0);
    // 再接続後、席へ戻った結果の snapshot を待っている間だけ、その再接続の番号を持つ
    const resyncRef = useRef<number | null>(null);
    const resyncRetriesRef = useRef(0);
    const resyncTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    // 局面を変えるイベントや snapshot を反映するたびに進む
    const positionVersionRef = useRef(0);
    // 復帰を拒まれた後に開き直しても、同じトークンでは席へ戻れない
    const rejectedRef = useRef(false);

    const positionReset = useEffectEvent(onPositionReset);
    const moveApplied = useEffectEvent(onMoveApplied);

    const commandRejected = useEffectEvent((code: ErrorCode): void => {
        onCommandRejected(code, movesRef.current.join(" "));
        // 見ている局面が古いと指し直しても通らないので、取りこぼしたイベントを取り直す。
        // 詰みの申告が拒まれるのも、手元の局面がサーバーと食い違っているとき
        if (code === "DESYNC" || code === "CHECKMATE_NOT_CONFIRMED") {
            client.sync({ sinceEventId: appliedEventIdRef.current });
        }
    });

    const stopResync = useEffectEvent((): void => {
        resyncRef.current = null;
        if (resyncTimerRef.current !== null) {
            clearTimeout(resyncTimerRef.current);
            resyncTimerRef.current = null;
        }
    });

    const showConnectionLost = (): void => {
        setConnection({
            state: "lost",
            canResume: seat !== "s" && getStoredResumeToken(roomId) !== null,
        });
    };

    // snapshot を求め直せたら true。待ちが終わっていれば何もせず、回数を使い切ったら諦める
    const requestResyncSnapshot = useEffectEvent((resync: number): boolean => {
        if (resyncRef.current !== resync) return false;
        if (resyncRetriesRef.current >= RESYNC_MAX_RETRIES || !requestFullSnapshot?.()) {
            stopResync();
            showConnectionLost();
            return false;
        }
        resyncRetriesRef.current += 1;
        return true;
    });

    const waitForResync = (resync: number): void => {
        if (resyncTimerRef.current !== null) clearTimeout(resyncTimerRef.current);
        resyncTimerRef.current = setTimeout(() => {
            if (requestResyncSnapshot(resync)) waitForResync(resync);
        }, RESYNC_TIMEOUT_MS);
    };

    const retryResync = useEffectEvent((resync: number): void => {
        if (requestResyncSnapshot(resync)) waitForResync(resync);
    });

    const rejectResync = useEffectEvent((code: ErrorCode): void => {
        stopResync();
        // useRoomConnection は対局開始で購読をやめていて、この応答を見ない。二度と使えない
        // トークンをここで捨てないと、再読み込みのたびに同じ resume が拒まれる
        if (isResumeTokenRejected(code)) {
            removeStoredResumeToken(roomId);
            removeStoredSeat(roomId);
        }
        rejectedRef.current = true;
        setConnection({ state: "rejected", finished: code === "ROOM_FINISHED" });
    });

    const applyStatus = useEffectEvent((status: RoomClientStatus): void => {
        connectionEpochRef.current += 1;
        stopResync();
        if (rejectedRef.current) return;
        if (status === "reconnecting") {
            setConnection({ state: "reconnecting" });
        } else if (status === "disconnected") {
            showConnectionLost();
        } else if (status === "connected") {
            // WebSocket が開いても、席へ戻れたかは分からない。対局者は RoomClient が必ず snapshot の
            // 返る resume を送り、観戦者は useRoomConnection が開き直した接続で参加し直すので、
            // どちらも応答の snapshot を反映し終えたら戻す
            const resync = connectionEpochRef.current;
            resyncRef.current = resync;
            resyncRetriesRef.current = 0;
            waitForResync(resync);
        }
    });

    // ─── サーバーからのメッセージの反映 ──────────────────────────────────────

    // 局面の解析は非同期なので、メッセージごとに別々に進めると、後から届いたものが先に
    // 反映されたり、古い snapshot が新しい指し手を巻き戻したりする。画面を開いたときの
    // snapshot も含めて 1 本の列に並べ、届いた順に 1 件ずつ反映し終えてから次へ進む
    const incomingRef = useRef<SerialQueue<Incoming> | null>(null);
    const initialSnapshotRef = useRef(snapshot);
    const isListeningRef = useRef(false);
    const [loadFailed, setLoadFailed] = useState(false);

    const applyIncoming = useEffectEvent((incoming: Incoming): void | Promise<void> => {
        if (incoming.t === "snapshot") {
            const { payload, initial } = incoming;
            // 画面を開いたときの snapshot を復元できないと盤面を出せないので、1 度だけやり直す
            const restoring = initial
                ? restorePosition(payload).catch(() => restorePosition(payload))
                : restorePosition(payload);
            return restoring.then(
                (restored) => {
                    if (!isListeningRef.current) return;
                    setLoadFailed(false);
                    appliedEventIdRef.current = payload.eventId;
                    startSfenRef.current = resolveStartSfen(payload.settings.startSfen);
                    movesRef.current = [...payload.moves];
                    // 終局イベントは購読開始より前に配信済みのことがあるので、snapshot からも復元する
                    if (payload.result) {
                        dispatch({ type: "result", result: payload.result });
                    }
                    if (payload.gameRecordId) {
                        gameRecordIdRef.current = payload.gameRecordId;
                    }
                    if (initial) {
                        dispatch({ type: "init", ...restored });
                        return;
                    }
                    positionVersionRef.current += 1;
                    if (incoming.resync !== undefined && incoming.resync === resyncRef.current) {
                        stopResync();
                        setConnection({ state: "connected" });
                    }
                    dispatch({
                        type: "resync",
                        ...restored,
                        turn: payload.turn,
                        clock: payload.clock,
                        passRights: payload.passRights,
                        pendingTakeback: payload.pendingTakeback,
                        myAnalysisRemaining: snapshotAnalysisRemaining(payload, seat),
                        analysisLog: payload.analysisLog,
                    });
                    // 再接続後は最新局面に戻す
                    positionReset();
                },
                (err) => {
                    console.error("[OnlineGameView] Failed to parse SFEN from snapshot:", err);
                    if (!isListeningRef.current) return;
                    if (initial) {
                        setLoadFailed(true);
                        // 局面が無いままでは指せず、snapshot が届くまで待つしかないので取り寄せる。
                        // 届いた snapshot も読めなければ、再接続後の同期と同じく回数を区切って諦める。
                        // 再接続後の同期が既に待っていれば、その snapshot で作り直せるので引き継ぐ
                        const resync = connectionEpochRef.current;
                        if (resyncRef.current === resync) return;
                        resyncRef.current = resync;
                        resyncRetriesRef.current = 0;
                        if (requestFullSnapshot?.()) {
                            waitForResync(resync);
                        } else {
                            stopResync();
                        }
                        return;
                    }
                    // sync の応答は差分イベントだけのことがあるので、同期待ちなら snapshot を求め直す
                    if (incoming.resync !== undefined && incoming.resync === resyncRef.current) {
                        retryResync(incoming.resync);
                        return;
                    }
                    // サーバーに再同期リクエストを送信して最新状態を取得する
                    client.sync({ sinceEventId: appliedEventIdRef.current });
                },
            );
        }

        const e = incoming.payload;
        // 終局済みルームへ再接続すると、snapshot に反映済みのイベントが後から届く。
        // 二重に適用しないよう、終局の通知以外は読み飛ばす
        const alreadyApplied = e.eventId <= appliedEventIdRef.current;
        // サーバーは指し手以外のイベントでもイベント番号を増やすので、すべてのイベントで更新する
        const markApplied = (): void => {
            appliedEventIdRef.current = Math.max(appliedEventIdRef.current, e.eventId);
            if (!POSITION_KEEPING_EVENTS.has(e.kind)) {
                positionVersionRef.current += 1;
            }
        };

        if (e.kind === "game_end") {
            if (e.gameRecordId) {
                gameRecordIdRef.current = e.gameRecordId;
            }
            dispatch({ type: "result", result: e.result });
        } else if (
            e.kind === "resign" ||
            e.kind === "timeout" ||
            e.kind === "checkmate" ||
            e.kind === "sennichite" ||
            e.kind === "illegal_move" ||
            e.kind === "disconnect_loss"
        ) {
            dispatch({ type: "result", result: e.result });
        } else if (alreadyApplied) {
            return;
        } else if (e.kind === "takeback_accepted") {
            return getPositionService()
                .parseSfen(e.sfen)
                .then((pos) => {
                    if (!isListeningRef.current) return;
                    movesRef.current = movesRef.current.slice(0, -1);
                    dispatch({
                        type: "takeback_accepted",
                        position: pos,
                        turn: e.turn,
                        clock: e.clock,
                        passRights: e.passRights,
                    });
                    positionReset();
                    markApplied();
                });
        } else if (e.kind === "move") {
            dispatch({
                type: "move",
                usi: e.usi,
                turn: e.turn,
                clock: e.clock,
                passRights: e.passRights,
                elapsedMs: e.elapsedMs,
            });
            movesRef.current = [...movesRef.current, e.usi];
            moveApplied(e.usi, e.turn);
        } else if (e.kind === "player_offline") {
            dispatch({ type: "player_offline", seat: e.seat });
        } else if (e.kind === "player_online") {
            dispatch({ type: "player_online", seat: e.seat });
        } else if (e.kind === "analysis_used" && (e.seat === "b" || e.seat === "w")) {
            dispatch({
                type: "analysis_used",
                isMySeat: e.seat === seat,
                seat: e.seat,
                analysisRemaining: e.analysisRemaining,
                ply: movesRef.current.length,
            });
        } else if (e.kind === "takeback_requested" && (e.seat === "b" || e.seat === "w")) {
            dispatch({ type: "takeback_requested", seat: e.seat, ply: e.ply });
        } else if (e.kind === "takeback_rejected") {
            dispatch({ type: "takeback_rejected" });
        } else if (e.kind === "takeback_cancelled") {
            dispatch({ type: "takeback_cancelled" });
        }
        markApplied();
    });

    useEffect(() => {
        isListeningRef.current = true;
        if (!incomingRef.current) {
            incomingRef.current = createSerialQueue<Incoming>(
                (incoming) => applyIncoming(incoming),
                () => isListeningRef.current,
            );
            incomingRef.current.push({
                t: "snapshot",
                payload: initialSnapshotRef.current,
                initial: true,
            });
        } else {
            incomingRef.current.resume();
        }
        const incoming = incomingRef.current;
        const unsub = client.subscribe((msg) => {
            if (msg.t === "event") {
                incoming.push(msg);
            } else if (msg.t === "snapshot") {
                incoming.push({
                    t: "snapshot",
                    payload: msg.payload,
                    initial: false,
                    resync: resyncRef.current ?? undefined,
                });
            } else if (msg.t === "error") {
                if (resyncRef.current !== null && SEAT_LOST_CODES.has(msg.payload.code)) {
                    rejectResync(msg.payload.code);
                    return;
                }
                commandRejected(msg.payload.code);
            }
        });
        const initialStatus = client.getStatus();
        if (initialStatus === "reconnecting" || initialStatus === "disconnected") {
            applyStatus(initialStatus);
        }
        const unsubStatus = client.subscribeStatus(applyStatus);
        return () => {
            unsub();
            unsubStatus();
            stopResync();
            // 解析の途中で画面を離れたら、その結果も残りのメッセージも反映しない
            isListeningRef.current = false;
        };
    }, [client]);

    return {
        gameState,
        connection,
        loadFailed,
        startSfenRef,
        movesRef,
        gameRecordIdRef,
        appliedEventIdRef,
        connectionEpochRef,
        positionVersionRef,
    };
}
