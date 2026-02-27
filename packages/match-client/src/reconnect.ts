// 自動再接続ロジック（指数バックオフ）と resumeToken/seat の sessionStorage 管理

import type { Seat } from "./types";

/** バックオフ時間（ms）: 1s → 2s → 4s → 8s → 16s */
const BACKOFF_DELAYS_MS = [1000, 2000, 4000, 8000, 16000] as const;

interface ReconnectManager {
    /** 次の再接続を予約する。最大試行数を超えた場合は onMaxRetriesReached を呼ぶ */
    schedule(connect: () => void): void;
    /** 再接続に成功したときに呼ぶ（試行回数をリセット） */
    reset(): void;
    /** 予約済みの再接続をキャンセルする */
    cancel(): void;
    /** 現在の試行回数 */
    getAttempt(): number;
}

export function createReconnectManager(options: {
    maxRetries: number;
    onAttempt?: (attempt: number, delayMs: number) => void;
    onMaxRetriesReached: () => void;
}): ReconnectManager {
    let attempt = 0;
    let timeoutId: ReturnType<typeof setTimeout> | null = null;

    return {
        schedule(connect: () => void): void {
            if (attempt >= options.maxRetries) {
                options.onMaxRetriesReached();
                return;
            }

            const delayMs = BACKOFF_DELAYS_MS[Math.min(attempt, BACKOFF_DELAYS_MS.length - 1)];
            options.onAttempt?.(attempt + 1, delayMs);
            attempt++;

            timeoutId = setTimeout(connect, delayMs);
        },

        reset(): void {
            attempt = 0;
            if (timeoutId !== null) {
                clearTimeout(timeoutId);
                timeoutId = null;
            }
        },

        cancel(): void {
            if (timeoutId !== null) {
                clearTimeout(timeoutId);
                timeoutId = null;
            }
        },

        getAttempt(): number {
            return attempt;
        },
    };
}

/** sessionStorage のキー名 */
function resumeTokenKey(roomId: string): string {
    return `ramu_resume_token_${roomId}`;
}

/** resumeToken を sessionStorage から取得する */
export function getStoredResumeToken(roomId: string): string | null {
    try {
        return sessionStorage.getItem(resumeTokenKey(roomId));
    } catch {
        // sessionStorage が利用できない環境では null を返す
        return null;
    }
}

/** resumeToken を sessionStorage に保存する */
export function storeResumeToken(roomId: string, token: string): void {
    try {
        sessionStorage.setItem(resumeTokenKey(roomId), token);
    } catch {
        // 保存できない場合は無視
    }
}

/** resumeToken を sessionStorage から削除する */
export function removeStoredResumeToken(roomId: string): void {
    try {
        sessionStorage.removeItem(resumeTokenKey(roomId));
    } catch {
        // 無視
    }
}

// ─── seat の sessionStorage 管理 ──────────────────────────────────────────────

function seatKey(roomId: string): string {
    return `ramu_seat_${roomId}`;
}

/** seat を sessionStorage から取得する */
export function getStoredSeat(roomId: string): Seat | null {
    try {
        const s = sessionStorage.getItem(seatKey(roomId));
        if (s === "b" || s === "w" || s === "s") return s;
        return null;
    } catch {
        return null;
    }
}

/** seat を sessionStorage に保存する */
export function storeSeat(roomId: string, seat: Seat): void {
    try {
        sessionStorage.setItem(seatKey(roomId), seat);
    } catch {
        // 保存できない場合は無視
    }
}

/** seat を sessionStorage から削除する */
export function removeStoredSeat(roomId: string): void {
    try {
        sessionStorage.removeItem(seatKey(roomId));
    } catch {
        // 無視
    }
}
