import type { Player } from "@shogi/app-core";
import { useEffect, useRef, useState } from "react";

// クロック更新インターバル（ms）
const CLOCK_UPDATE_INTERVAL_MS = 200;

/**
 * 各プレイヤーの時間設定
 */
export type ClockSettings = Record<
    Player,
    {
        mainMs: number;
        byoyomiMs: number;
        /** 1 手指すごとに持ち時間へ足す時間（フィッシャー）。0 なら足さない */
        incrementMs: number;
        enabled: boolean;
    }
>;

/**
 * 時計の状態
 */
interface ClockState {
    mainMs: number;
    byoyomiMs: number;
    /** 設定の加算（エンジンに渡すために時計の状態にも持つ。対局中は変わらない） */
    incrementMs: number;
}

/** 手番を移すときの加算の扱い */
export interface ClockTurnOptions {
    /** 指し終えて手番が移った。指した側の持ち時間に加算を足す */
    moved?: boolean;
    /** 「待った」で取り消した、それぞれの側の手の数。その手で得た加算を持ち時間から引く */
    undone?: Partial<Record<Player, number>>;
}

/**
 * 全体の時計状態（両プレイヤー + 現在刻んでいる側）
 */
export interface TickState {
    sente: ClockState;
    gote: ClockState;
    ticking: Player | null;
    lastUpdatedAt: number;
}

/**
 * useClockManager の props
 */
interface UseClockManagerProps {
    /** 時間設定 */
    timeSettings: ClockSettings;
    /** 対局が実行中かどうか */
    isMatchRunning: boolean;
    /** 時間切れ時に呼ばれるコールバック */
    onTimeExpired: (side: Player) => Promise<void>;
    /** matchEndedRef (時間切れ判定の重複防止用) */
    matchEndedRef: { current: boolean };
    /** 時計処理のエラー通知（任意） */
    onClockError?: (message: string) => void;
}

/**
 * useClockManager の返り値
 */
interface UseClockManagerReturn {
    /** 現在の時計状態 */
    clocks: TickState;
    /** 現在の時計状態への参照（リアルタイム参照用） */
    clocksRef: { readonly current: TickState };
    /** 時計をリセットする */
    resetClocks: (startTick: boolean) => void;
    /** 次の手番に時計を更新する（秒読み時間をリセット） */
    updateClocksForNextTurn: (nextTurn: Player, options?: ClockTurnOptions) => void;
    /** いま指した手が、指す前に時間切れになっていたか */
    hasExpiredAtMove: (mover: Player) => boolean;
    /** 時計を停止する */
    stopTicking: () => void;
    /** 時計を開始する */
    startTicking: (turn: Player) => void;
}

/**
 * TickState を初期化する
 */
export function initialTick(settings: ClockSettings): TickState {
    return {
        sente: clockStateOf(settings.sente),
        gote: clockStateOf(settings.gote),
        ticking: null,
        lastUpdatedAt: Date.now(),
    };
}

/** 経過時間を持ち時間から引き、使い切ったら秒読みから引く。両方 0 になったら時間切れ。 */
function spendTime(
    state: ClockState,
    elapsedMs: number,
): { mainMs: number; byoyomiMs: number; expired: boolean } {
    let mainMs = state.mainMs - elapsedMs;
    let byoyomiMs = state.byoyomiMs;
    if (mainMs < 0) {
        byoyomiMs = Math.max(0, byoyomiMs - Math.abs(mainMs));
        mainMs = 0;
    }
    return { mainMs, byoyomiMs, expired: mainMs <= 0 && byoyomiMs <= 0 };
}

function reportExpired(
    onTimeExpired: (side: Player) => Promise<void>,
    side: Player,
    onClockError?: (message: string) => void,
): void {
    try {
        Promise.resolve(onTimeExpired(side)).catch((err) => {
            console.error("時間切れ処理エラー:", err);
            onClockError?.(`時間切れ処理エラー: ${String(err)}`);
        });
    } catch (err) {
        console.error("時間切れ処理エラー:", err);
        onClockError?.(`時間切れ処理エラー: ${String(err)}`);
    }
}

function clockStateOf(setting: ClockSettings[Player]): ClockState {
    return {
        mainMs: setting.mainMs,
        byoyomiMs: setting.byoyomiMs,
        incrementMs: setting.enabled ? setting.incrementMs : 0,
    };
}

/**
 * 時計管理のカスタムフック
 *
 * ゲーム進行中の時間管理を行います。
 * - 持ち時間と秒読み時間の管理
 * - 定期的な時計の更新（200ms間隔）
 * - 時間切れの判定と通知
 *
 * @param props - フックの設定
 * @returns 時計状態と操作関数
 *
 * @example
 * ```typescript
 * const { clocks, resetClocks, updateClocksForNextTurn } = useClockManager({
 *   timeSettings: { sente: { mainMs: 600000, byoyomiMs: 10000, incrementMs: 0, enabled: true }, gote: { ... } },
 *   isMatchRunning: true,
 *   onTimeExpired: async (side) => {
 *     console.log(`${side} の時間切れ`);
 *   },
 *   matchEndedRef,
 * });
 * ```
 */
export function useClockManager({
    timeSettings,
    isMatchRunning,
    onTimeExpired,
    matchEndedRef,
    onClockError,
}: UseClockManagerProps): UseClockManagerReturn {
    const [clocks, setClocks] = useState<TickState>(() => initialTick(timeSettings));
    const clocksRef = useRef<TickState>(clocks);
    /** hasExpiredAtMove で測った、指した時刻 */
    const moveTimeRef = useRef<{ mover: Player; at: number } | null>(null);

    // onTimeExpired を ref に保存（依存配列の安定化）
    const onTimeExpiredRef = useRef(onTimeExpired);
    useEffect(() => {
        onTimeExpiredRef.current = onTimeExpired;
    }, [onTimeExpired]);

    /**
     * 時計をリセットする
     */
    // 時計の状態は ref と state を同時に書く（200ms ごとの更新が ref から次の状態を作るため）。
    // state から ref へ書き戻す effect は置かない。遅れて走る effect が、後から書いた手番や加算を
    // 古い状態で上書きし、時計が止まる。
    const writeClocks = (next: TickState) => {
        clocksRef.current = next;
        setClocks(next);
    };

    const resetClocks = (startTick: boolean) => {
        writeClocks({
            sente: clockStateOf(timeSettings.sente),
            gote: clockStateOf(timeSettings.gote),
            ticking: startTick ? "sente" : null,
            lastUpdatedAt: Date.now(),
        });
    };

    /**
     * 次の手番に時計を更新する（秒読み時間をリセット）
     */
    const updateClocksForNextTurn = (nextTurn: Player, options?: ClockTurnOptions) => {
        const mover: Player = nextTurn === "sente" ? "gote" : "sente";
        const measured = moveTimeRef.current;
        moveTimeRef.current = null;
        const now =
            options?.moved && measured?.mover === mover
                ? Math.max(measured.at, clocksRef.current.lastUpdatedAt)
                : Date.now();
        let prev = clocksRef.current;
        // 指した側の、最後の 200ms ごとの更新から指すまでの時間も引いてから加算する（時間切れもここで判定する）。
        let expired = false;
        if (
            options?.moved &&
            isMatchRunning &&
            prev.ticking === mover &&
            timeSettings[mover].enabled
        ) {
            const spent = spendTime(prev[mover], now - prev.lastUpdatedAt);
            expired = spent.expired;
            prev = {
                ...prev,
                [mover]: { ...prev[mover], mainMs: spent.mainMs, byoyomiMs: spent.byoyomiMs },
            };
        }
        const mainAfter = (side: Player): number => {
            const increment = prev[side].incrementMs;
            const earned = options?.moved && side === mover && !expired ? increment : 0;
            const revoked = (options?.undone?.[side] ?? 0) * increment;
            return Math.max(0, prev[side].mainMs + earned - revoked);
        };
        const next: TickState = {
            ...prev,
            sente: { ...prev.sente, mainMs: mainAfter("sente") },
            gote: { ...prev.gote, mainMs: mainAfter("gote") },
            ticking: nextTurn,
            lastUpdatedAt: now,
        };
        next[nextTurn] = { ...next[nextTurn], byoyomiMs: timeSettings[nextTurn].byoyomiMs };
        writeClocks(next);
        if (expired && !matchEndedRef.current) {
            reportExpired(onTimeExpiredRef.current, mover, onClockError);
        }
    };

    /**
     * いま指した手が、指す前に時間切れになっていたか（最後の 200ms ごとの更新から指すまでの端数も含める）。
     * 時間切れの手は盤や棋譜に足さないので、手を適用する前に聞く。
     */
    const hasExpiredAtMove = (mover: Player): boolean => {
        const now = Date.now();
        // 手番を移すときの精算もこの時刻で行う（別の時刻で測り直すと、その間に切れた手が棋譜に残る）。
        moveTimeRef.current = { mover, at: now };
        const prev = clocksRef.current;
        if (!isMatchRunning || prev.ticking !== mover || !timeSettings[mover].enabled) return false;
        return spendTime(prev[mover], now - prev.lastUpdatedAt).expired;
    };

    /**
     * 時計を停止する
     */
    const stopTicking = () => {
        writeClocks({ ...clocksRef.current, ticking: null });
    };

    /**
     * 時計を開始する
     */
    const startTicking = (turn: Player) => {
        writeClocks({ ...clocksRef.current, ticking: turn, lastUpdatedAt: Date.now() });
    };

    // 時計の定期更新（200ms間隔）
    useEffect(() => {
        if (!isMatchRunning || !clocks.ticking) return;

        const timer = setInterval(() => {
            const prev = clocksRef.current;
            if (!prev.ticking) return;

            const now = Date.now();
            const delta = now - prev.lastUpdatedAt;
            const side = prev.ticking;
            const current = prev[side];

            // 時間制限が無効な場合は時計を進めない
            if (!timeSettings[side].enabled) {
                const nextState: TickState = { ...prev, lastUpdatedAt: now };
                clocksRef.current = nextState;
                setClocks(nextState);
                return;
            }

            const spent = spendTime(current, delta);
            const nextState: TickState = {
                ...prev,
                [side]: { ...current, mainMs: spent.mainMs, byoyomiMs: spent.byoyomiMs },
                lastUpdatedAt: now,
            };
            clocksRef.current = nextState;
            setClocks(nextState);

            // 注: matchEndedRef.current は endMatch 内で設定されるため、ここでは設定しない
            if (spent.expired && isMatchRunning && !matchEndedRef.current) {
                reportExpired(onTimeExpiredRef.current, side, onClockError);
            }
        }, CLOCK_UPDATE_INTERVAL_MS);

        return () => clearInterval(timer);
    }, [clocks.ticking, isMatchRunning, matchEndedRef, onClockError, timeSettings]);

    return {
        clocks,
        clocksRef,
        resetClocks,
        updateClocksForNextTurn,
        hasExpiredAtMove,
        stopTicking,
        startTicking,
    };
}
