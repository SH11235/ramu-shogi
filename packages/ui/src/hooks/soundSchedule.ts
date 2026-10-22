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
    if (pending && pending.when > now) {
        pending.cancel();
        const { when } = pending;
        pending = null;
        lastStart = when;
        return when;
    }
    pending = null;
    const when = Math.max(now, lastStart + MIN_GAP_SEC);
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
