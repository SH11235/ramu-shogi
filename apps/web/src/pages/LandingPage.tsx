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
    mark: string;
    markTone: "shu" | "ai";
    title: string;
    children: ReactNode;
}

function EntryCard({ to, mark, markTone, title, children }: EntryCardProps): ReactElement {
    return (
        <Link
            to={to}
            className="group flex flex-col gap-2 rounded-xl border border-wafuu-border bg-wafuu-washi-warm p-4 transition-colors hover:border-wafuu-shu/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
        >
            <span
                aria-hidden
                className={
                    markTone === "shu"
                        ? "font-display text-xl text-wafuu-shu"
                        : "font-display text-xl text-wafuu-ai"
                }
            >
                {mark}
            </span>
            <h2 className="font-display text-[15px] font-semibold text-wafuu-sumi">{title}</h2>
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
                            今日の一局を、<span className="text-wafuu-shu">すぐに</span>。
                        </h1>
                        <p className="max-w-[34ch] text-[15px] leading-relaxed text-wafuu-sumi-light">
                            人と指す。AI
                            と指す。棋譜を並べる。迷わず盤の前に座れることだけを、この画面の仕事にする。
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
                    <EntryCard to="/play" mark="対" markTone="shu" title="人と対局">
                        同じ盤を囲む。先手・後手を選んで一手目へ。
                    </EntryCard>
                    <EntryCard to="/play" mark="析" markTone="ai" title="AI と対局・検討">
                        内蔵 NNUE エンジンと指す。そのまま検討へ持ち込める。
                    </EntryCard>
                    <EntryCard to="/rshogi-viewer/live" mark="観" markTone="shu" title="ライブ観戦">
                        進行中のエンジン対局をリアルタイムで眺める。
                    </EntryCard>
                </section>
            </main>
        </>
    );
}
