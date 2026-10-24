// CPU 戦の「犬」の着手音。音源はアプリの public/sounds/dog/v1/ に置き、URL の基点はアプリから受け取る。

import { registerScheduledSound, reserveSoundSlot, reserveSoundSlotAfter } from "./soundSchedule";

/** 着手の場面。王手 > 駒取り > 成り > 通常 の順に優先する */
export type MoveScene = "move" | "capture" | "promote" | "check";

// 番号は元の動画で鳴いた順。bark3 は bark5 と高さ・長さが近く、聴き分けられないので入れていない
const CLIP_NAMES = [
    "bark1",
    "bark2",
    "bark4",
    "bark5",
    "bark6",
    "bark6_full",
    "strong1",
    "strong2",
    "strong3",
    "strong4",
    "weak",
    "v3_01",
    "v3_02",
    "v3_03",
    "v3_04",
    "v3_05",
    "v3_06",
] as const;
type ClipName = (typeof CLIP_NAMES)[number];

// 毎手鳴る「通常」は刺さり（高域）が弱く澄んだ声、王手は立ち上がりが速く刺さりの強い声を当てる。
const SCENE_CLIPS: Record<MoveScene, readonly ClipName[]> = {
    move: ["bark2", "bark5"],
    capture: ["strong2", "strong3", "strong4"],
    promote: ["bark6"],
    check: ["bark1", "strong1"],
};
const SCENE_GAIN: Record<MoveScene, number> = { move: 0.7, capture: 0.9, promote: 0.9, check: 1 };
const PITCH_JITTER = 0.03;

// 終局の合図。勝ち負けでは変えない（犬が喜ぶ・悲しむにすると、誰の気持ちなのかがずれる）。
// 着手音の bark6 は先頭 320ms に切ってあり 1 回目の「わん」だけなので、2 回鳴く全長を使う
const END_CLIP: ClipName = "bark6_full";
const END_GAIN = 0.9;

// CPU が劣勢のときの弱い声。毎手鳴ると効果が薄れるので一部の手だけ置き換える。
// v3_01〜06 も 1 秒を超える長い声なので、weak と同じ扱いにする
const WEAK_PROBABILITY = 0.25;
const WEAK_CLIPS: readonly ClipName[] = [
    "weak",
    "v3_01",
    "v3_02",
    "v3_03",
    "v3_04",
    "v3_05",
    "v3_06",
];
// 弱い声は 1〜1.5 秒あり、人がすぐ指し返しても切らずに鳴らし切る。その間の声は小さくして重ねる。
const DUCK_GAIN_WHILE_WEAK = 0.5;

const LOAD_TIMEOUT_MS = 15_000;
const loadingBases = new Set<string>();
const loadedBuffers = new Map<string, Map<ClipName, AudioBuffer>>();

async function decodeClip(
    ctx: BaseAudioContext,
    baseUrl: string,
    name: ClipName,
): Promise<AudioBuffer | null> {
    // Safari の版によっては Ogg Opus を decodeAudioData できないので、そのときは AAC を使う。
    for (const ext of ["opus", "m4a"]) {
        try {
            const response = await fetch(`${baseUrl}${name}.${ext}`);
            if (!response.ok) continue;
            return await ctx.decodeAudioData(await response.arrayBuffer());
        } catch {
            // 次の形式を試す
        }
    }
    return null;
}

export function setDogBuffersForTest(baseUrl: string, buffers: Map<string, AudioBuffer>): void {
    loadedBuffers.set(baseUrl, buffers as Map<ClipName, AudioBuffer>);
    current = null;
    weakPlaying = null;
    weakGain = null;
}

/** 音源を読み込んでデコードしておく。同じ基点 URL では 1 回だけ読む */
export function preloadDogSounds(baseUrl: string): void {
    if (loadingBases.has(baseUrl) || loadedBuffers.has(baseUrl)) return;
    if (typeof window === "undefined" || !window.OfflineAudioContext) {
        loadedBuffers.set(baseUrl, new Map());
        return;
    }
    // 再生用の AudioContext は利用者の操作の前に作ると止まったままになるので、デコードは別の文脈で行う。
    // AudioBuffer は文脈をまたいで使え、サンプリング周波数の違いは再生時に変換される。
    let ctx: OfflineAudioContext;
    try {
        ctx = new OfflineAudioContext(1, 1, 48000);
    } catch {
        loadedBuffers.set(baseUrl, new Map());
        return;
    }
    loadingBases.add(baseUrl);
    void Promise.all(
        CLIP_NAMES.map(async (name) => [name, await decodeClip(ctx, baseUrl, name)] as const),
    ).then((entries) => {
        const buffers = new Map<ClipName, AudioBuffer>();
        for (const [name, buffer] of entries) if (buffer) buffers.set(name, buffer);
        loadedBuffers.set(baseUrl, buffers);
        loadingBases.delete(baseUrl);
    });
    // 回線が止まりかけていたり、デコードが返ってこなかったりしても、ずっと無音のままにしない。
    // 時間切れのあとは通常の駒音で鳴らし、遅れて読み終われば犬の声に戻す。
    setTimeout(() => {
        if (!loadedBuffers.has(baseUrl)) loadedBuffers.set(baseUrl, new Map());
        loadingBases.delete(baseUrl);
    }, LOAD_TIMEOUT_MS);
}

// 鳴っている声はページ全体で 1 つ。対局画面は同時に 1 つしか開かないので、再生状態はモジュールで持つ
let current: { source: AudioBufferSourceNode; gain: GainNode } | null = null;
let weakPlaying: AudioBufferSourceNode | null = null;
let weakGain: GainNode | null = null;
const endedSources = new WeakSet<AudioBufferSourceNode>();
// 次の声に切り替えるとき、ぶつ切りにすると「プツッ」と鳴るので短く絞ってから止める
const CUT_FADE_SEC = 0.02;

function pick<T>(items: readonly T[], random: () => number): T | undefined {
    return items[Math.floor(random() * items.length)];
}

/** 鳴らす声を選ぶ。CPU の手で CPU が劣勢なら、王手・駒取り以外の一部を弱い声に置き換える */
export function chooseDogClip(
    scene: MoveScene,
    cpuLosing: boolean,
    random: () => number = Math.random,
): ClipName | undefined {
    if (cpuLosing && (scene === "move" || scene === "promote") && random() < WEAK_PROBABILITY) {
        return pick(WEAK_CLIPS, random);
    }
    return pick(SCENE_CLIPS[scene], random);
}

/**
 * 犬の声を鳴らす。読み込み中は鳴らさない（待ってから鳴らすと、指した手と音がずれて聞こえるため）。
 * 読み込みに失敗した声は "unavailable" を返し、呼び出し側が通常の駒音に切り替える。
 */
export function playDogSound(
    ctx: AudioContext,
    baseUrl: string,
    scene: MoveScene,
    cpuLosing: boolean,
): "played" | "loading" | "unavailable" {
    const buffers = loadedBuffers.get(baseUrl);
    if (!buffers) return loadingBases.has(baseUrl) ? "loading" : "unavailable";
    const name = chooseDogClip(scene, cpuLosing);
    const buffer = name ? buffers.get(name) : undefined;
    if (!name || !buffer) return "unavailable";

    const isWeak = WEAK_CLIPS.includes(name);
    const now = ctx.currentTime;
    const when = reserveSoundSlot(now);
    if (current && current.source !== weakPlaying) {
        try {
            current.gain.gain.setTargetAtTime(0, when, CUT_FADE_SEC / 3);
            current.source.stop(when + CUT_FADE_SEC * 2);
        } catch {
            // 既に止まっている
        }
    }
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    if (!isWeak) source.playbackRate.value = 1 + (Math.random() * 2 - 1) * PITCH_JITTER;
    const gain = ctx.createGain();
    const duck = weakPlaying && !isWeak ? DUCK_GAIN_WHILE_WEAK : 1;
    gain.gain.value = (isWeak ? 1 : SCENE_GAIN[scene]) * duck;
    source.connect(gain);
    gain.connect(ctx.destination);
    source.start(when);
    const previous = current;
    const previousWeak = weakPlaying;
    const previousWeakGain = weakGain;
    current = { source, gain };
    source.onended = () => {
        endedSources.add(source);
        if (weakPlaying === source) weakPlaying = null;
    };
    if (isWeak) {
        weakPlaying = source;
        weakGain = gain;
    }
    registerScheduledSound(when, now, () => {
        try {
            source.stop();
        } catch {
            // stop の二度呼びで例外を投げる古い実装でも、下の状態は戻す
        }
        // 取り消した声の前の状態に戻す。戻さないと、鳴っている weak を通常の声として切ってしまい、
        // 鳴らなかった声に次の切り替えのフェードを掛けると停止時刻が後ろへ上書きされて一瞬鳴ってしまう
        if (weakPlaying === source) {
            const restored = previousWeak && !endedSources.has(previousWeak);
            weakPlaying = restored ? previousWeak : null;
            weakGain = restored ? previousWeakGain : null;
        }
        if (current?.source === source) current = previous;
    });
    return "played";
}

/**
 * 終局の声を、最後の手の音から delaySec 置いて鳴らす。鳴っている声（weak も）は絞って止める。
 * 戻り値は playDogSound と同じ。
 */
export function playDogEndSound(
    ctx: AudioContext,
    baseUrl: string,
    delaySec: number,
): "played" | "loading" | "unavailable" {
    const buffers = loadedBuffers.get(baseUrl);
    if (!buffers) return loadingBases.has(baseUrl) ? "loading" : "unavailable";
    const buffer = buffers.get(END_CLIP);
    if (!buffer) return "unavailable";

    const when = reserveSoundSlotAfter(ctx.currentTime, delaySec);
    const playingVoices = [
        current,
        weakPlaying && weakGain && { source: weakPlaying, gain: weakGain },
    ];
    for (const playing of playingVoices) {
        if (!playing) continue;
        try {
            playing.gain.gain.setTargetAtTime(0, when, CUT_FADE_SEC / 3);
            playing.source.stop(when + CUT_FADE_SEC * 2);
        } catch {
            // 既に止まっている
        }
    }
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    const gain = ctx.createGain();
    gain.gain.value = END_GAIN;
    source.connect(gain);
    gain.connect(ctx.destination);
    source.start(when);
    current = { source, gain };
    weakPlaying = null;
    weakGain = null;
    source.onended = () => {
        endedSources.add(source);
    };
    return "played";
}
