// 着手音どうしの間隔をそろえる。AI どうしが詰みを読んで即座に指し合うと、数十 ms おきに
// 鳴り始めては次の音で切られ、音が乱れて聞こえるため。

const MIN_GAP_SEC = 0.18;

let lastStart = Number.NEGATIVE_INFINITY;
let pending: { when: number; cancel: () => void } | null = null;

/**
 * 次の音を鳴らす時刻（AudioContext の時計）。前の音から MIN_GAP_SEC 経っていなければ遅らせる。
 * まだ鳴っていない予約があれば取り消してその時刻を使う（連打の途中の手は鳴らさず、最後の手を鳴らす）。
 */
export function reserveSoundSlot(now: number): number {
    // AudioContext を作り直すと時計が 0 からになるので、前の時計の時刻は捨てる（残すと次の音がずっと先になる）
    if (lastStart > now + MIN_GAP_SEC) {
        lastStart = Number.NEGATIVE_INFINITY;
        pending = null;
    }
    if (pending && pending.when > now) {
        const { when, cancel } = pending;
        pending = null;
        try {
            cancel();
        } catch {
            // stop の二度呼びで例外を投げる古い実装でも、次の音は鳴らす
        }
        return when;
    }
    pending = null;
    const when = Math.max(now, lastStart + MIN_GAP_SEC);
    lastStart = when;
    return when;
}

/**
 * 今から delaySec 後（前の音から MIN_GAP_SEC 経っていなければもっと後）の時刻。まだ鳴っていない予約は
 * 取り消さない（終局の声は、最後の手の音を鳴らしてから重ねるため）。
 */
export function reserveSoundSlotAfter(now: number, delaySec: number): number {
    if (lastStart > now + MIN_GAP_SEC) {
        lastStart = Number.NEGATIVE_INFINITY;
        pending = null;
    }
    const when = Math.max(now + delaySec, lastStart + MIN_GAP_SEC);
    lastStart = when;
    return when;
}

/** reserveSoundSlot で得た時刻に鳴らす音を登録する。鳴り始める前なら、次の予約で取り消される */
export function registerScheduledSound(when: number, now: number, cancel: () => void): void {
    pending = when > now ? { when, cancel } : null;
}

export function resetSoundScheduleForTest(): void {
    lastStart = Number.NEGATIVE_INFINITY;
    pending = null;
}
