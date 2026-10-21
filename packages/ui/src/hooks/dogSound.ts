// CPU 戦の「犬」の着手音。音源はアプリの public/sounds/dog/v1/ に置き、URL の基点はアプリから受け取る。

/** 着手の場面。王手 > 駒取り > 成り > 通常 の順に優先する */
export type MoveScene = "move" | "capture" | "promote" | "check";

const CLIP_NAMES = [
    "bark1",
    "bark2",
    "bark4",
    "bark5",
    "bark6",
    "strong1",
    "strong2",
    "strong3",
    "strong4",
    "weak",
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

// CPU が劣勢のときの弱い声。毎手鳴ると効果が薄れるので一部の手だけ置き換える。
const WEAK_PROBABILITY = 0.25;
// weak は 1.2 秒あり、人がすぐ指し返しても切らずに鳴らし切る。その間の声は小さくして重ねる。
const DUCK_GAIN_WHILE_WEAK = 0.5;

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

/** 音源を読み込んでデコードしておく。同じ基点 URL では 1 回だけ読む */
export function preloadDogSounds(baseUrl: string): void {
    if (loadingBases.has(baseUrl) || typeof window === "undefined" || !window.OfflineAudioContext) {
        return;
    }
    loadingBases.add(baseUrl);
    // 再生用の AudioContext は利用者の操作の前に作ると止まったままになるので、デコードは別の文脈で行う。
    // AudioBuffer は文脈をまたいで使え、サンプリング周波数の違いは再生時に変換される。
    const ctx = new OfflineAudioContext(1, 1, 48000);
    void Promise.all(
        CLIP_NAMES.map(async (name) => [name, await decodeClip(ctx, baseUrl, name)] as const),
    ).then((entries) => {
        const buffers = new Map<ClipName, AudioBuffer>();
        for (const [name, buffer] of entries) if (buffer) buffers.set(name, buffer);
        loadedBuffers.set(baseUrl, buffers);
    });
}

let current: AudioBufferSourceNode | null = null;
let weakPlaying: AudioBufferSourceNode | null = null;

function pick<T>(items: readonly T[], random: () => number): T | undefined {
    return items[Math.floor(random() * items.length)];
}

/** 鳴らす声を選ぶ。CPU の手で CPU が劣勢なら、王手・駒取り以外の一部を weak に置き換える */
export function chooseDogClip(
    scene: MoveScene,
    cpuLosing: boolean,
    random: () => number = Math.random,
): ClipName | undefined {
    if (cpuLosing && (scene === "move" || scene === "promote") && random() < WEAK_PROBABILITY) {
        return "weak";
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

    const isWeak = name === "weak";
    if (current && current !== weakPlaying) {
        try {
            current.stop();
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
    source.start();
    current = source;
    if (isWeak) {
        weakPlaying = source;
        source.onended = () => {
            if (weakPlaying === source) weakPlaying = null;
        };
    }
    return "played";
}
