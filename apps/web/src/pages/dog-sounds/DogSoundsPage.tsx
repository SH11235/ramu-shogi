/**
 * 犬の鳴き声の素材の一覧（導線は置かない。URL を知っている人だけが開く）。
 * 音声は ▶ を押した声だけを読み込む。採用中の声は、アプリの割り当て（dogClipUsages）から色で示す。
 */

import { cn } from "@shogi/design-system";
import { type DogClipUsage, dogClipUsages } from "@shogi/ui/hooks/dogSound";
import type { ReactElement } from "react";
import { useEffect, useRef, useState } from "react";
import { HeaderNav } from "../../components/HeaderNav";
import { PageContainer } from "../../components/PageContainer";
import { PageHeader } from "../../components/PageHeader";
import { PageHeading } from "../../components/PageHeading";
import catalog from "./dogSoundCatalog.json";

interface DogSound {
    id: string;
    /** 元の録音の番号 */
    recording: number;
    startSec: number;
    durationMs: number;
    /** 聞こえ方（聴いて付けたラベル） */
    voice: string;
    note?: string;
}

const SOUNDS: DogSound[] = catalog;
const BASE_URL = `${import.meta.env.BASE_URL}sounds/dog/catalog/`;

const USAGE_LABEL: Record<DogClipUsage, string> = {
    move: "通常の手",
    capture: "駒取り",
    check: "王手",
    promote: "成り",
    losing: "CPU 劣勢",
    end: "終局",
};
// 枠線とバッジの色。行の線は最初の使い道の色にする
const USAGE_COLOR: Record<DogClipUsage, { border: string; chip: string }> = {
    move: { border: "border-l-wafuu-kincha", chip: "bg-wafuu-kincha text-wafuu-shu-fg" },
    capture: { border: "border-l-wafuu-kin", chip: "bg-wafuu-kin text-wafuu-sumi" },
    check: { border: "border-l-wafuu-shu", chip: "bg-wafuu-shu text-wafuu-shu-fg" },
    promote: { border: "border-l-wafuu-sumi", chip: "bg-wafuu-sumi text-background" },
    losing: { border: "border-l-wafuu-ai", chip: "bg-wafuu-ai text-wafuu-ai-fg" },
    end: { border: "border-l-wafuu-shu-light", chip: "bg-wafuu-shu-light text-wafuu-shu-fg" },
};
const USAGE_ORDER: DogClipUsage[] = ["move", "capture", "check", "promote", "end", "losing"];

// Safari の版によっては Ogg Opus を鳴らせないので、そのときは AAC を使う
function canPlayOpus(): boolean {
    return (
        typeof Audio !== "undefined" && new Audio().canPlayType('audio/ogg; codecs="opus"') !== ""
    );
}

function UsageChip({ usage }: { usage: DogClipUsage }): ReactElement {
    return (
        <span
            className={cn(
                "inline-flex rounded-full px-2 text-xs font-semibold leading-5",
                USAGE_COLOR[usage].chip,
            )}
        >
            {USAGE_LABEL[usage]}
        </span>
    );
}

export default function DogSoundsPage(): ReactElement {
    const usages = dogClipUsages();
    const audioRef = useRef<HTMLAudioElement | null>(null);
    const [playing, setPlaying] = useState<string | null>(null);
    useEffect(() => () => audioRef.current?.pause(), []);

    const stopShowing = (id: string) => setPlaying((current) => (current === id ? null : current));
    const start = (id: string, ext: "opus" | "m4a") => {
        audioRef.current?.pause();
        const audio = new Audio(`${BASE_URL}${id}.${ext}`);
        audioRef.current = audio;
        audio.onended = () => stopShowing(id);
        audio.play().catch((error: unknown) => {
            // 別の声に切り替えて止めたとき（AbortError）は、その声を鳴らしていないので何もしない。
            // 「鳴らせる」と答えても Opus を再生できない環境があるので、一度だけ AAC で鳴らし直す。
            if (error instanceof DOMException && error.name === "AbortError") return;
            if (ext === "opus" && audioRef.current === audio) start(id, "m4a");
            else stopShowing(id);
        });
    };
    const play = (id: string) => {
        setPlaying(id);
        start(id, canPlayOpus() ? "opus" : "m4a");
    };

    const recordings = [...new Set(SOUNDS.map((sound) => sound.recording))];

    return (
        <>
            <PageHeader
                items={[{ label: "ラム将棋", to: "/" }, { label: "犬の鳴き声" }]}
                right={<HeaderNav />}
            />
            <PageContainer width="narrow">
                <PageHeading
                    title="犬の鳴き声"
                    description={`対局の着手音に使う犬の声の素材です（${SOUNDS.length} 声）。色の付いた声は、いまアプリで鳴っている声です。`}
                />
                <ul aria-label="色の意味" className="flex flex-wrap gap-2">
                    {USAGE_ORDER.map((usage) => (
                        <li key={usage}>
                            <UsageChip usage={usage} />
                        </li>
                    ))}
                </ul>
                {recordings.map((recording) => (
                    <section key={recording} className="flex flex-col gap-2">
                        <h2 className="text-base font-semibold text-foreground">
                            録音 {recording}
                        </h2>
                        <ul className="flex flex-col divide-y divide-border border-y border-border">
                            {SOUNDS.filter((sound) => sound.recording === recording).map(
                                (sound) => {
                                    const used = usages.get(sound.id) ?? [];
                                    const first = used[0];
                                    return (
                                        <li
                                            key={sound.id}
                                            data-sound={sound.id}
                                            className={cn(
                                                "flex items-center gap-3 border-l-4 py-2 pl-3 pr-1",
                                                first
                                                    ? USAGE_COLOR[first].border
                                                    : "border-l-transparent",
                                            )}
                                        >
                                            <button
                                                type="button"
                                                onClick={() => play(sound.id)}
                                                aria-label={`${sound.id} を再生`}
                                                className={cn(
                                                    "flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-border text-sm hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                                                    playing === sound.id &&
                                                        "border-wafuu-shu text-wafuu-shu",
                                                )}
                                            >
                                                <span aria-hidden>▶</span>
                                            </button>
                                            <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                                                <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                                                    <span className="font-medium text-foreground">
                                                        {sound.voice}
                                                    </span>
                                                    {used.map((usage) => (
                                                        <UsageChip key={usage} usage={usage} />
                                                    ))}
                                                </div>
                                                <span className="text-xs text-muted-foreground tabular-nums">
                                                    {sound.id} ・ {sound.startSec.toFixed(1)} 秒から
                                                    ・ {sound.durationMs} ms
                                                    {sound.note ? ` ・ ${sound.note}` : ""}
                                                </span>
                                            </div>
                                        </li>
                                    );
                                },
                            )}
                        </ul>
                    </section>
                ))}
            </PageContainer>
        </>
    );
}
