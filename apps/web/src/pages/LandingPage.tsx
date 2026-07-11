import { Link } from "@tanstack/react-router";
import type { ReactElement, ReactNode } from "react";
import { HeaderNav } from "../components/HeaderNav";
import { HeroBoard } from "../components/HeroBoard";
import { PageHeader } from "../components/PageHeader";

// トップ（迎える面 / T0）。低密度・暖。盤をヒーローに置き、余白と明朝見出しで
// 「何のページで、次に何をするか」を一目で伝える入口。対局盤そのものは /play。
// 色はすべて design-system の wafuu-*/shogi-* トークン経由（ハードコード禁止）。

interface EntryCardProps {
    to: "/play" | "/rshogi-viewer/live";
    heading: string;
    tone: "shu" | "ai";
    children: ReactNode;
}

function EntryCard({ to, heading, tone, children }: EntryCardProps): ReactElement {
    return (
        <Link
            to={to}
            className="group flex flex-col gap-2 rounded-xl border border-wafuu-border bg-wafuu-washi-warm p-4 transition-colors hover:border-wafuu-shu/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
        >
            <h2
                className={
                    tone === "shu"
                        ? "font-display text-xl font-semibold text-wafuu-shu"
                        : "font-display text-xl font-semibold text-wafuu-ai"
                }
            >
                {heading}
            </h2>
            <span className="text-[13px] leading-relaxed text-wafuu-sumi-light">{children}</span>
        </Link>
    );
}

export default function LandingPage(): ReactElement {
    return (
        <>
            <PageHeader items={[{ label: "ラム将棋" }]} right={<HeaderNav />} />
            <main className="mx-auto flex w-full max-w-[1100px] flex-col gap-10 px-4 py-10">
                <section className="grid items-center gap-8 md:grid-cols-[1.05fr_0.95fr]">
                    <div className="flex flex-col gap-5">
                        <h1 className="text-balance font-display text-4xl leading-tight text-wafuu-sumi sm:text-5xl">
                            セットアップなしで、<span className="text-wafuu-shu">NNUE 検討</span>。
                        </h1>
                        {/* 折返しは文単位に限定する（inline-block）。字数依存の ch 幅だと
                            NNUE/GUI など欧文混じりで語の途中に改行が落ちるため使わない。 */}
                        <p className="max-w-[26rem] text-[15px] leading-relaxed text-wafuu-sumi-light">
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
                        <div className="flex flex-wrap gap-3">
                            <Link
                                to="/play"
                                className="inline-flex items-center gap-2 rounded-lg bg-wafuu-shu px-5 py-3 text-sm font-semibold text-wafuu-shu-fg shadow-card transition-colors hover:bg-wafuu-shu-light focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
                            >
                                <span aria-hidden>▲</span>
                                対局をはじめる
                            </Link>
                            <Link
                                to="/games"
                                className="inline-flex items-center gap-2 rounded-lg border border-wafuu-border px-5 py-3 text-sm font-semibold text-wafuu-sumi transition-colors hover:bg-wafuu-washi-warm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
                            >
                                棋譜を開く
                            </Link>
                        </div>
                    </div>
                    <div className="relative mx-auto w-full max-w-[380px]">
                        <div
                            aria-hidden
                            className="pointer-events-none absolute -inset-6 rounded-full bg-wafuu-kin/10 blur-2xl"
                        />
                        <HeroBoard className="relative z-10" />
                    </div>
                </section>

                <section aria-label="はじめ方" className="grid gap-4 sm:grid-cols-3">
                    <EntryCard to="/play" heading="対局" tone="shu">
                        先手・後手を選んで人と指す。
                    </EntryCard>
                    <EntryCard to="/play" heading="検討" tone="ai">
                        内蔵 NNUE エンジンと指す。検討モードに切り替えられる。
                    </EntryCard>
                    <EntryCard to="/rshogi-viewer/live" heading="観戦" tone="shu">
                        進行中のエンジン対局をリアルタイムで見る。
                    </EntryCard>
                </section>
            </main>
        </>
    );
}
