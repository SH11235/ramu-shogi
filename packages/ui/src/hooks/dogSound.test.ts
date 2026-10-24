import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { chooseDogClip, playDogEndSound, playDogSound, setDogBuffersForTest } from "./dogSound";
import { resetSoundScheduleForTest } from "./soundSchedule";

const always = (value: number) => () => value;

describe("chooseDogClip", () => {
    it("picks from the scene's clips", () => {
        expect(chooseDogClip("check", false, always(0))).toBe("bark1");
        expect(chooseDogClip("capture", false, always(0.99))).toBe("strong4");
        expect(chooseDogClip("promote", false, always(0.5))).toBe("bark6");
    });

    it("sometimes replaces a quiet CPU move with the weak voice while the CPU is losing", () => {
        expect(chooseDogClip("move", true, always(0.1))).toBe("weak");
        expect(chooseDogClip("promote", true, always(0.1))).toBe("weak");
        expect(chooseDogClip("move", true, always(0.9))).not.toBe("weak");
        expect(chooseDogClip("move", false, always(0.1))).not.toBe("weak");
    });

    it("keeps check and capture voices even while the CPU is losing", () => {
        expect(chooseDogClip("check", true, always(0.1))).not.toBe("weak");
        expect(chooseDogClip("capture", true, always(0.1))).not.toBe("weak");
    });
});

function fakeAudioContext() {
    const voices: Array<{
        starts: number[];
        stops: Array<number | undefined>;
        gain: { value: number };
    }> = [];
    const nodes: unknown[] = [];
    const ctx = {
        currentTime: 0,
        destination: {},
        nodes,
        createBufferSource() {
            const voice = {
                starts: [] as number[],
                stops: [] as Array<number | undefined>,
                gain: { value: Number.NaN },
            };
            const node = {
                buffer: null,
                playbackRate: { value: 1 },
                onended: null as (() => void) | null,
                // 声の音量は、つないだ先の GainNode で見る
                connect: (target: { gain: { value: number } }) => {
                    voice.gain = target.gain;
                },
                start: (when: number) => voice.starts.push(when),
                stop: (when?: number) => voice.stops.push(when),
            };
            voices.push(voice);
            nodes.push(node);
            return node;
        },
        createGain() {
            return { gain: { value: 1, setTargetAtTime: vi.fn() }, connect: () => {} };
        },
    };
    return { ctx: ctx as unknown as AudioContext & { currentTime: number }, voices };
}

describe("playDogSound", () => {
    const base = "/sounds/dog/v1/";

    beforeEach(() => {
        resetSoundScheduleForTest();
        const buffer = {} as AudioBuffer;
        setDogBuffersForTest(
            base,
            new Map([
                ["weak", buffer],
                ["bark1", buffer],
            ]),
        );
        vi.spyOn(Math, "random").mockReturnValue(0.1);
    });
    afterEach(() => vi.restoreAllMocks());

    it("never cuts a playing weak voice when a later weak is replaced before it starts", () => {
        const { ctx, voices } = fakeAudioContext();
        ctx.currentTime = 1;
        playDogSound(ctx, base, "move", true);
        ctx.currentTime = 1.02;
        playDogSound(ctx, base, "move", true);
        ctx.currentTime = 1.04;
        playDogSound(ctx, base, "check", false);

        const [weakA, weakB, check] = voices;
        expect(weakA.stops).toEqual([]);
        expect(weakB.stops).toEqual([undefined]);
        expect(check.starts).toEqual(weakB.starts);
        expect(check.gain.value).toBeCloseTo(0.5);
    });

    it("restores the voice state even when cancelling throws", () => {
        const { ctx, voices } = fakeAudioContext();
        ctx.currentTime = 1;
        playDogSound(ctx, base, "move", true);
        ctx.currentTime = 1.02;
        playDogSound(ctx, base, "move", true);
        const nodes = (
            ctx as unknown as { nodes: Array<{ onended: (() => void) | null; stop: () => void }> }
        ).nodes;
        nodes[0].onended?.();
        nodes[1].stop = () => {
            throw new Error("already stopped");
        };
        ctx.currentTime = 1.04;
        playDogSound(ctx, base, "check", false);
        expect(voices[2].gain.value).toBeCloseTo(1);
    });
});

describe("playDogEndSound", () => {
    const base = "/sounds/dog/v1/";
    const full = {} as AudioBuffer;

    beforeEach(() => {
        resetSoundScheduleForTest();
        setDogBuffersForTest(
            base,
            new Map([
                ["weak", {} as AudioBuffer],
                ["bark6_full", full],
            ]),
        );
        vi.spyOn(Math, "random").mockReturnValue(0.1);
    });
    afterEach(() => vi.restoreAllMocks());

    it("plays the full double bark after the delay and fades out a playing weak voice", () => {
        const { ctx, voices } = fakeAudioContext();
        ctx.currentTime = 1;
        playDogSound(ctx, base, "move", true);
        ctx.currentTime = 1.1;
        expect(playDogEndSound(ctx, base, 0.32)).toBe("played");

        const [weak, end] = voices;
        expect(end.starts[0]).toBeCloseTo(1.42);
        expect(weak.stops[0]).toBeCloseTo(1.42 + 0.04);
        const nodes = (ctx as unknown as { nodes: Array<{ buffer: unknown }> }).nodes;
        expect(nodes[1].buffer).toBe(full);
    });

    it("reports a missing clip so nothing is played", () => {
        setDogBuffersForTest(base, new Map());
        const { ctx, voices } = fakeAudioContext();
        expect(playDogEndSound(ctx, base, 0.32)).toBe("unavailable");
        expect(voices).toEqual([]);
    });
});
