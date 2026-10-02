import { Link } from "@tanstack/react-router";
import type { CSSProperties, ReactElement, ReactNode } from "react";
import { useRef, useState } from "react";
import { AuthBadge } from "../components/AuthBadge";
import { HeaderNav } from "../components/HeaderNav";
import { DEMO_MOVES, HeroBoard } from "../components/HeroBoard";
import { PageHeader } from "../components/PageHeader";
import { RamMascot } from "../components/RamMascot";
import { Reveal } from "../components/Reveal";

// トップ（迎える面 / T0）。ラムが出迎える、丸くてふわっとした入口。
// 盤は実盤 ShogiBoard の静的描画、ラムは盤の縁から顔をのぞかせる。
// 色はすべて design-system のトークン経由（ハードコード禁止）。

interface EntryCardProps {
    to: "/play" | "/online" | "/rshogi-viewer/live" | "/games";
    heading: string;
    glyph: string;
    tone: "shu" | "ai" | "kin";
    delay: number;
    requiresAuth?: boolean;
    children: ReactNode;
}

const TILE_TONE: Record<EntryCardProps["tone"], string> = {
    shu: "bg-wafuu-shu text-wafuu-shu-fg",
    ai: "bg-wafuu-ai text-wafuu-ai-fg",
    kin: "bg-ram-fur text-ram-ink",
};

function EntryCard({
    to,
    heading,
    glyph,
    tone,
    delay,
    requiresAuth,
    children,
}: EntryCardProps): ReactElement {
    return (
        <Link
            to={to}
            style={{ "--d": `${delay}ms` } as CSSProperties}
            className="ram-rise group relative flex flex-col gap-4 rounded-[28px] border border-card-edge bg-card/80 p-5 shadow-puffy backdrop-blur-sm transition-[transform,box-shadow] duration-300 ease-out hover:-translate-y-1.5 hover:shadow-puffy-lift focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background motion-reduce:transition-none motion-reduce:hover:translate-y-0"
        >
            <span
                aria-hidden
                className={`grid size-14 place-items-center rounded-[20px] font-display text-3xl font-black shadow-puffy transition-transform duration-300 group-hover:-rotate-6 group-hover:scale-110 motion-reduce:transition-none motion-reduce:group-hover:transform-none ${TILE_TONE[tone]}`}
            >
                {glyph}
            </span>
            <span className="flex flex-col gap-1.5">
                <span className="flex items-center gap-2">
                    <h2 className="font-display text-xl font-bold text-wafuu-sumi">{heading}</h2>
                    {requiresAuth && <AuthBadge />}
                </span>
                <span className="text-pretty text-[13px] leading-relaxed text-wafuu-sumi-light">
                    {children}
                </span>
            </span>
            <span
                aria-hidden
                className="absolute right-5 top-5 grid size-8 place-items-center rounded-full bg-ram-cream text-sm text-wafuu-sumi opacity-0 transition-all duration-300 group-hover:translate-x-0.5 group-hover:opacity-100 motion-reduce:transition-none"
            >
                →
            </span>
        </Link>
    );
}

const FEATURES = [
    {
        no: "01",
        title: "セットアップ不要の NNUE",
        body: "NNUE エンジンがブラウザ内で動きます。評価関数ファイルを読み込めば、手元のモデルでも指せます。",
    },
    {
        no: "02",
        title: "評価値で振り返る",
        body: "評価値グラフと読み筋を見ながら、指した棋譜をその場で検討。分岐を作って試すこともできます。",
    },
    {
        no: "03",
        title: "人とも、エンジンとも",
        body: "招待リンクで部屋を作って対局。進行中のエンジン対局は、リアルタイムで観戦できます。",
    },
] as const;

// 手数ごとの台詞 (0 = 初期局面)。DEMO_MOVES と同じ長さ + 1
const RAM_LINES = [
    "どこに指す？",
    "ふむふむ…",
    "なるほど",
    "飛車先、いくよ",
    "そう来る？",
    "ぐいぐい来るね",
    "金を寄せて…",
    "落ち着いて",
    "突き捨て！",
    "取るよ",
    "同飛車！",
] as const satisfies readonly string[] & { length: 11 };

// ヒーロー: 盤が序盤を自動で指し、ラムが直近の一手を目で追って台詞を返す。
function HeroDemo(): ReactElement {
    const boardRef = useRef<HTMLDivElement>(null);
    const [ply, setPly] = useState(0);
    const [gaze, setGaze] = useState<{ x: number; y: number } | null>(null);

    const handleStep = (nextPly: number, to: string | null): void => {
        setPly(nextPly);
        const cell = to ? boardRef.current?.querySelector(`[data-square="${to}"]`) : null;
        if (!cell) {
            setGaze(null);
            return;
        }
        const rect = cell.getBoundingClientRect();
        setGaze({ x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 });
    };

    return (
        <>
            <div
                aria-hidden
                className="pointer-events-none absolute inset-x-2 bottom-0 top-28 rounded-[44px] bg-ram-fur/25 blur-2xl"
            />
            <div className="ram-bob absolute left-1/2 top-0 z-20 w-44 -translate-x-1/2 sm:w-48">
                <RamMascot
                    gaze={gaze}
                    className="drop-shadow-[0_10px_14px_hsl(var(--ram-shadow)/0.25)]"
                />
            </div>
            <div
                aria-hidden
                key={ply}
                className="ram-pop absolute -right-1 top-6 z-30 rounded-2xl rounded-bl-sm bg-card px-3.5 py-2 font-display text-sm font-bold text-wafuu-sumi shadow-puffy sm:-right-6"
            >
                {RAM_LINES[Math.min(ply, DEMO_MOVES.length)]}
            </div>
            <div
                ref={boardRef}
                className="relative z-10 rotate-[1.5deg] rounded-[34px] bg-card/60 p-3 pt-5 shadow-puffy-lift ring-1 ring-card-edge backdrop-blur"
            >
                <HeroBoard onStep={handleStep} />
            </div>
        </>
    );
}

function Paw({ className }: { className?: string }): ReactElement {
    return (
        <svg aria-hidden viewBox="0 0 32 32" className={className}>
            <title>肉球</title>
            <ellipse cx="16" cy="21" rx="7.5" ry="6" />
            <ellipse cx="6.5" cy="14" rx="3" ry="4" transform="rotate(-18 6.5 14)" />
            <ellipse cx="12.5" cy="7.5" rx="3" ry="4.2" transform="rotate(-6 12.5 7.5)" />
            <ellipse cx="19.5" cy="7.5" rx="3" ry="4.2" transform="rotate(6 19.5 7.5)" />
            <ellipse cx="25.5" cy="14" rx="3" ry="4" transform="rotate(18 25.5 14)" />
        </svg>
    );
}

export default function LandingPage(): ReactElement {
    return (
        <div className="relative isolate overflow-hidden">
            {/* 背景: やわらかい色のかたまり + 肉球 */}
            <div aria-hidden className="pointer-events-none absolute inset-0 -z-10">
                <div className="absolute -left-24 top-24 size-[420px] rounded-full bg-ram-fur/25 blur-3xl" />
                <div className="absolute -right-20 top-0 size-[380px] rounded-full bg-ram-collar/25 blur-3xl" />
                <div className="absolute bottom-10 left-1/3 size-[320px] rounded-full bg-ram-blush/30 blur-3xl" />
                <Paw className="absolute left-[6%] top-[58%] hidden size-8 -rotate-12 fill-ram-fur/30 md:block" />
                <Paw className="absolute left-[11%] top-[66%] hidden size-6 rotate-12 fill-ram-fur/25 md:block" />
                <Paw className="absolute right-[7%] top-[62%] hidden size-7 rotate-[18deg] fill-ram-collar/35 md:block" />
            </div>

            <PageHeader items={[{ label: "ラム将棋" }]} right={<HeaderNav />} />
            <main className="mx-auto flex w-full max-w-[1120px] flex-col gap-20 px-5 pb-20 pt-10 sm:pt-14">
                <section className="grid items-center gap-10 md:grid-cols-[1.05fr_0.95fr] md:gap-6">
                    <div className="flex flex-col gap-6">
                        <p
                            className="ram-rise inline-flex w-fit items-center gap-2 rounded-full bg-card/85 px-4 py-1.5 text-[13px] font-medium text-wafuu-sumi shadow-puffy"
                            style={{ "--d": "0ms" } as CSSProperties}
                        >
                            <span className="size-2 rounded-full bg-status-online" aria-hidden />
                            ブラウザで動く NNUE 将棋
                        </p>
                        <h1
                            className="ram-rise text-balance font-display text-[2.6rem] font-black leading-[1.18] tracking-tight text-wafuu-sumi sm:text-6xl"
                            style={{ "--d": "80ms" } as CSSProperties}
                        >
                            <span className="inline-block">ラムと一緒に、</span>
                            <span className="inline-block">
                                <span className="relative inline-block text-wafuu-shu">
                                    将棋
                                    <svg
                                        aria-hidden
                                        viewBox="0 0 120 12"
                                        preserveAspectRatio="none"
                                        className="absolute -bottom-1 left-0 h-2.5 w-full"
                                    >
                                        <title>下線</title>
                                        <path
                                            d="M2 8 Q 30 1 60 6 T 118 4"
                                            fill="none"
                                            strokeWidth="4.5"
                                            strokeLinecap="round"
                                            className="stroke-ram-collar"
                                        />
                                    </svg>
                                </span>
                                を。
                            </span>
                        </h1>
                        {/* 折返しは文単位に限定する（inline-block）。字数依存の ch 幅だと
                            NNUE/GUI など欧文混じりで語の途中に改行が落ちるため使わない。 */}
                        <p
                            className="ram-rise max-w-[27rem] text-[15px] leading-[1.9] text-wafuu-sumi-light"
                            style={{ "--d": "160ms" } as CSSProperties}
                        >
                            <span className="inline-block">
                                NNUE エンジンがブラウザ内で動きます。
                            </span>
                            <span className="inline-block">
                                評価関数の導入も GUI の設定も不要。
                            </span>
                            <span className="inline-block">
                                人との対局、棋譜の再生もこの画面から。
                            </span>
                        </p>
                        <div
                            className="ram-rise flex flex-wrap items-center gap-3"
                            style={{ "--d": "240ms" } as CSSProperties}
                        >
                            <Link
                                to="/play"
                                className="group inline-flex items-center gap-2.5 rounded-full bg-wafuu-shu px-7 py-4 font-display text-base font-bold text-wafuu-shu-fg shadow-[inset_0_2px_0_hsl(0_0%_100%/0.35),0_14px_26px_-10px_hsl(var(--wafuu-shu)/0.7)] transition-[transform,box-shadow] duration-300 hover:-translate-y-0.5 hover:shadow-[inset_0_2px_0_hsl(0_0%_100%/0.35),0_20px_32px_-10px_hsl(var(--wafuu-shu)/0.8)] active:translate-y-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background motion-reduce:transition-none"
                            >
                                <span
                                    aria-hidden
                                    className="transition-transform duration-300 group-hover:rotate-[20deg] motion-reduce:transition-none"
                                >
                                    ▲
                                </span>
                                対局をはじめる
                            </Link>
                            <Link
                                to="/rshogi-viewer/live"
                                className="inline-flex items-center rounded-full bg-card/85 px-6 py-4 font-display text-base font-bold text-wafuu-sumi shadow-puffy transition-[transform,box-shadow] duration-300 hover:-translate-y-0.5 hover:shadow-puffy-lift focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background motion-reduce:transition-none"
                            >
                                観戦する
                            </Link>
                        </div>
                    </div>

                    <div
                        className="ram-rise relative mx-auto w-full max-w-[400px] pt-44"
                        style={{ "--d": "180ms" } as CSSProperties}
                    >
                        <HeroDemo />
                    </div>
                </section>

                <section aria-label="はじめ方" className="grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
                    <EntryCard to="/play" heading="対局・検討" glyph="歩" tone="shu" delay={320}>
                        内蔵 NNUE エンジンと指す。検討モードに切り替えられる。ログイン不要。
                    </EntryCard>
                    <EntryCard
                        to="/online"
                        heading="オンライン対局"
                        glyph="金"
                        tone="kin"
                        delay={400}
                    >
                        部屋を作り、招待リンクで人と指す。名前を入れるだけで参加できる。
                    </EntryCard>
                    <EntryCard
                        to="/rshogi-viewer/live"
                        heading="観戦"
                        glyph="角"
                        tone="ai"
                        delay={480}
                    >
                        進行中のエンジン対局をリアルタイムで見る。
                    </EntryCard>
                    <EntryCard
                        to="/games"
                        heading="マイ棋譜"
                        glyph="飛"
                        tone="ai"
                        delay={560}
                        requiresAuth
                    >
                        指した対局を保存して振り返る。
                    </EntryCard>
                </section>

                <section aria-labelledby="features-heading" className="flex flex-col gap-8">
                    <Reveal className="flex flex-col gap-3">
                        <h2
                            id="features-heading"
                            className="text-balance font-display text-3xl font-black leading-tight text-wafuu-sumi sm:text-4xl"
                        >
                            ブラウザひとつで、検討から対局まで。
                        </h2>
                        <p className="max-w-[34rem] text-[15px] leading-[1.9] text-wafuu-sumi-light">
                            インストールもアカウントも要りません。開いたその場で、ラムと一局。
                        </p>
                    </Reveal>
                    <div className="grid gap-5 md:grid-cols-3">
                        {FEATURES.map((f, i) => (
                            <Reveal key={f.title} delay={i * 90}>
                                <article className="flex h-full flex-col gap-4 rounded-[28px] border border-card-edge bg-card/80 p-6 shadow-puffy">
                                    <span
                                        aria-hidden
                                        className="font-display text-5xl font-black leading-none text-ram-fur"
                                    >
                                        {f.no}
                                    </span>
                                    <h3 className="font-display text-xl font-bold text-wafuu-sumi">
                                        {f.title}
                                    </h3>
                                    <p className="text-pretty text-[14px] leading-[1.9] text-wafuu-sumi-light">
                                        {f.body}
                                    </p>
                                </article>
                            </Reveal>
                        ))}
                    </div>
                </section>

                <Reveal>
                    <section
                        aria-label="対局をはじめる"
                        className="relative flex flex-col items-center gap-5 overflow-hidden rounded-[40px] border border-card-edge bg-card/70 px-6 pb-12 pt-10 text-center shadow-puffy-lift"
                    >
                        <div
                            aria-hidden
                            className="pointer-events-none absolute -bottom-16 left-1/2 size-72 -translate-x-1/2 rounded-full bg-ram-collar/25 blur-3xl"
                        />
                        <RamMascot className="relative w-28" />
                        <h2 className="relative text-balance font-display text-3xl font-black text-wafuu-sumi sm:text-4xl">
                            さあ、一局。
                        </h2>
                        <Link
                            to="/play"
                            className="group relative inline-flex items-center gap-2.5 rounded-full bg-wafuu-shu px-8 py-4 font-display text-base font-bold text-wafuu-shu-fg shadow-[inset_0_2px_0_hsl(0_0%_100%/0.35),0_14px_26px_-10px_hsl(var(--wafuu-shu)/0.7)] transition-[transform,box-shadow] duration-300 hover:-translate-y-0.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background motion-reduce:transition-none"
                        >
                            <span
                                aria-hidden
                                className="transition-transform duration-300 group-hover:rotate-[20deg] motion-reduce:transition-none"
                            >
                                ▲
                            </span>
                            対局をはじめる
                        </Link>
                    </section>
                </Reveal>
            </main>

            <footer className="mx-auto flex w-full max-w-[1120px] flex-wrap items-center justify-between gap-3 px-5 pb-10 text-[13px] text-wafuu-sumi-light">
                <span className="inline-flex items-center gap-2 font-display font-bold text-wafuu-sumi">
                    <Paw className="size-4 fill-ram-fur" />
                    ラム将棋
                </span>
                <Link
                    to="/privacy"
                    className="rounded-full px-3 py-1.5 transition-colors hover:bg-card/80 hover:text-wafuu-sumi"
                >
                    プライバシーポリシー
                </Link>
            </footer>
        </div>
    );
}
