import { useEffect } from "react";

// Web Audio API による合成音フック
// 後から音声ファイルに差し替える場合は playSound の実装のみ変更する

type ShogiSoundType = "move_self" | "move_opponent" | "pass";

// ─── 合成音の実装 ─────────────────────────────────────────────────────────────

// 駒を置く打撃音（ノイズバースト + バンドパスフィルタ）
function playKnockSound(ctx: AudioContext, gainValue: number): void {
    const durationSec = 0.09;
    const bufferSize = Math.floor(ctx.sampleRate * durationSec);
    const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) {
        // 指数減衰するホワイトノイズ
        const decay = (1 - i / bufferSize) ** 5;
        data[i] = (Math.random() * 2 - 1) * decay;
    }

    const source = ctx.createBufferSource();
    source.buffer = buffer;

    // 木材の打撃感を出すバンドパスフィルタ
    const filter = ctx.createBiquadFilter();
    filter.type = "bandpass";
    filter.frequency.value = 700;
    filter.Q.value = 0.8;

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(gainValue, ctx.currentTime);

    source.connect(filter);
    filter.connect(gain);
    gain.connect(ctx.destination);
    source.start();
}

// パス音（ソフトなサイン波トーン）
function playPassSound(ctx: AudioContext): void {
    const durationSec = 0.2;

    const osc = ctx.createOscillator();
    osc.type = "sine";
    osc.frequency.setValueAtTime(520, ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(380, ctx.currentTime + durationSec);

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.25, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + durationSec);

    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + durationSec);
}

// ─── AudioContext の遅延初期化 ────────────────────────────────────────────────

let sharedCtx: AudioContext | null = null;

function getAudioContext(): AudioContext | null {
    if (typeof window === "undefined" || !window.AudioContext) return null;
    if (!sharedCtx || sharedCtx.state === "closed") {
        sharedCtx = new AudioContext();
    }
    return sharedCtx;
}

async function resumeIfSuspended(ctx: AudioContext): Promise<void> {
    if (ctx.state === "suspended") {
        await ctx.resume();
    }
}

// iOS Safari などは、利用者の操作（タップ・クリック・キー入力）の中で再生を始めた AudioContext しか鳴らさない。
// 駒音は AI の応手や、合法手の確認を待った後など操作の外で鳴るので、最初の操作で無音を 1 回鳴らして使える状態にしておく。
const UNLOCK_EVENTS = ["touchend", "click", "keydown"] as const;
let unlockInstalled = false;

function unlockOnUserGesture(): void {
    const ctx = getAudioContext();
    if (!ctx) return;
    try {
        const source = ctx.createBufferSource();
        source.buffer = ctx.createBuffer(1, 1, ctx.sampleRate);
        source.connect(ctx.destination);
        source.start();
    } catch {
        // AudioContext が使えない環境では無視
    }
    resumeIfSuspended(ctx)
        .then(() => {
            if (ctx.state !== "running") return;
            for (const type of UNLOCK_EVENTS) {
                document.removeEventListener(type, unlockOnUserGesture, true);
            }
        })
        .catch(() => {
            // 解放できなければ、次の操作でもう一度試す
        });
}

function installAudioUnlock(): void {
    if (unlockInstalled || typeof document === "undefined") return;
    unlockInstalled = true;
    for (const type of UNLOCK_EVENTS) {
        document.addEventListener(type, unlockOnUserGesture, true);
    }
}

// ─── フック ───────────────────────────────────────────────────────────────────

export function useShogiSound(): { playSound: (type: ShogiSoundType) => void } {
    useEffect(installAudioUnlock, []);

    function playSound(type: ShogiSoundType): void {
        const ctx = getAudioContext();
        if (!ctx) return;

        resumeIfSuspended(ctx).then(
            () => {
                try {
                    switch (type) {
                        case "move_self":
                            // 自分の着手: やや小さめの打撃音
                            playKnockSound(ctx, 0.4);
                            break;
                        case "move_opponent":
                            // 相手の着手: 大きめの打撃音
                            playKnockSound(ctx, 0.75);
                            break;
                        case "pass":
                            playPassSound(ctx);
                            break;
                    }
                } catch {
                    // AudioContext が使えない環境では無視
                }
            },
            () => {
                // 操作の前で、まだ音を出せない
            },
        );
    }

    return { playSound };
}
