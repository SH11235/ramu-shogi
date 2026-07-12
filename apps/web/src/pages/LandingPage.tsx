import { Link } from "@tanstack/react-router";
import type { ReactElement, ReactNode } from "react";
import { AuthBadge } from "../components/AuthBadge";
import { HeaderNav } from "../components/HeaderNav";
import { HeroBoard } from "../components/HeroBoard";
import { PageHeader } from "../components/PageHeader";

// トップ（迎える面 / T0）。低密度・暖。盤をヒーローに置き、余白と明朝見出しで
// 「何のページで、次に何をするか」を一目で伝える入口。対局盤そのものは /play。
// 色はすべて design-system の wafuu-*/shogi-* トークン経由（ハードコード禁止）。

interface EntryCardProps {
    to: "/play" | "/online" | "/rshogi-viewer/live" | "/games";
    heading: string;
    tone: "shu" | "ai";
    requiresAuth?: boolean;
    children: ReactNode;
}

function EntryCard({ to, heading, tone, requiresAuth, children }: EntryCardProps): ReactElement {
    return (
        <Link
            to={to}
            className="group flex flex-col gap-2 rounded-xl border border-wafuu-border bg-wafuu-washi-warm p-4 transition-colors hover:border-wafuu-shu/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
        >
            <span className="flex items-center gap-2">
                <h2
                    className={
                        tone === "shu"
                            ? "font-display text-xl font-semibold text-wafuu-shu"
                            : "font-display text-xl font-semibold text-wafuu-ai"
                    }
                >
                    {heading}
                </h2>
                {requiresAuth && <AuthBadge />}
            </span>
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

                <section aria-label="はじめ方" className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                    <EntryCard to="/play" heading="対局・検討" tone="shu">
                        内蔵 NNUE エンジンと指す。検討モードに切り替えられる。ログイン不要。
                    </EntryCard>
                    <EntryCard to="/online" heading="オンライン対局" tone="shu">
                        部屋を作り、招待リンクで人と指す。名前を入れるだけで参加できる。
                    </EntryCard>
                    <EntryCard to="/rshogi-viewer/live" heading="観戦" tone="ai">
                        進行中のエンジン対局をリアルタイムで見る。
                    </EntryCard>
                    <EntryCard to="/games" heading="マイ棋譜" tone="ai" requiresAuth>
                        指した対局を保存して振り返る。
                    </EntryCard>
                </section>
            </main>
        </>
    );
}
