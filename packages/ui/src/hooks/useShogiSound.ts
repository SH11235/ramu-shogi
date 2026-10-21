import { useEffect } from "react";
import { type MoveScene, playDogSound, preloadDogSounds } from "./dogSound";

// Web Audio API による着手音フック。通常は合成音、CPU 戦で「犬」を選ぶと音声ファイルの鳴き声を鳴らす

type ShogiSoundType = "move_self" | "move_opponent" | "pass";

const SOUND_VOICES = ["dog", "standard"] as const;

/** 着手音の鳴らし方（CPU 戦で選べる） */
export type SoundVoice = (typeof SOUND_VOICES)[number];

/** 手で書き換えられた保存値などの知らない声を、既定の声に戻す */
export function normalizeSoundVoice(value: unknown, fallback: SoundVoice): SoundVoice {
    return SOUND_VOICES.find((voice) => voice === value) ?? fallback;
}

interface MoveSoundDetail {
    voice: SoundVoice;
    scene: MoveScene;
    /** CPU の手で、CPU 側の評価値が大きく負けているとき */
    cpuLosing?: boolean;
    /** 犬の声を読み込み中なら通常の駒音で代わりに鳴らす（試し鳴らしで無音にしない） */
    fallbackWhileLoading?: boolean;
}

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
    // iOS では着信やバックグラウンド移行のあと "interrupted" になることもあるので、running 以外は戻す。
    if (ctx.state !== "running") {
        await ctx.resume();
    }
}

// iOS Safari などは、利用者の操作（タップ・クリック・キー入力）の中で再生を始めた AudioContext しか鳴らさない。
// 駒音は AI の応手や、合法手の確認を待った後など操作の外で鳴るので、操作のたびに止まっていれば無音を 1 回鳴らして戻す。
// 着信やバックグラウンド移行でまた止まることがあるので、リスナーは外さない（動いている間は何もしない）。
const UNLOCK_EVENTS = ["touchend", "click", "keydown"] as const;
let unlockInstalled = false;

function unlockOnUserGesture(): void {
    const ctx = getAudioContext();
    if (!ctx || ctx.state === "running") return;
    // 操作の中で先に再生を始めてから resume する（iOS は、操作の中での再生を解放の条件にしている）。
    try {
        const source = ctx.createBufferSource();
        source.buffer = ctx.createBuffer(1, 1, ctx.sampleRate);
        source.connect(ctx.destination);
        source.start();
    } catch {
        // AudioContext が使えない環境では無視
    }
    resumeIfSuspended(ctx).catch(() => {
        // 戻せなければ、次の操作でもう一度試す
    });
}

function installAudioUnlock(): void {
    if (unlockInstalled || typeof document === "undefined") return;
    unlockInstalled = true;
    for (const type of UNLOCK_EVENTS) {
        // preventDefault しないので passive にして、touchend でスクロールを待たせない。
        document.addEventListener(type, unlockOnUserGesture, { capture: true, passive: true });
    }
}

// ─── フック ───────────────────────────────────────────────────────────────────

interface UseShogiSoundOptions {
    /** 犬の声の音源を置いた URL（末尾 /）。渡したときだけ読み込む */
    dogSoundBaseUrl?: string;
}

export function useShogiSound({ dogSoundBaseUrl }: UseShogiSoundOptions = {}): {
    playSound: (type: ShogiSoundType, detail?: MoveSoundDetail) => void;
} {
    useEffect(installAudioUnlock, []);
    useEffect(() => {
        if (dogSoundBaseUrl) preloadDogSounds(dogSoundBaseUrl);
    }, [dogSoundBaseUrl]);

    function playSound(type: ShogiSoundType, detail?: MoveSoundDetail): void {
        const ctx = getAudioContext();
        if (!ctx) return;

        resumeIfSuspended(ctx).then(
            () => {
                try {
                    if (type !== "pass" && detail?.voice === "dog" && dogSoundBaseUrl) {
                        const result = playDogSound(
                            ctx,
                            dogSoundBaseUrl,
                            detail.scene,
                            detail.cpuLosing ?? false,
                        );
                        if (result === "played") return;
                        if (result === "loading" && !detail.fallbackWhileLoading) return;
                    }
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
