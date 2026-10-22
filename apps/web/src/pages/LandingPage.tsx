import { Link } from "@tanstack/react-router";
import type { ReactElement, ReactNode } from "react";
import { HeaderNav } from "../components/HeaderNav";
import { HeroBoard } from "../components/HeroBoard";
import { PageHeader } from "../components/PageHeader";

// トップ（迎える面 / T0）。低密度・暖。盤をヒーローに置き、余白と明朝見出しで
// 「何のページで、次に何をするか」を一目で伝える入口。対局盤そのものは /play。
// 色はすべて design-system の wafuu-*/shogi-* トークン経由（ハードコード禁止）。

interface EntryCardProps {
    to: "/play" | "/online" | "/rshogi-viewer" | "/studies";
    heading: string;
    children: ReactNode;
}

// 入口は主な導線なので、背景付きのカードにしない（上の罫線と見出しで区切る）。
function EntryCard({ to, heading, children }: EntryCardProps): ReactElement {
    return (
        <Link
            to={to}
            className="group flex flex-col gap-2 border-t-2 border-wafuu-border pt-4 transition-colors hover:border-wafuu-shu focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-4 focus-visible:ring-offset-background"
        >
            <h2 className="font-display text-xl font-semibold text-wafuu-sumi transition-colors group-hover:text-wafuu-shu">
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
            {/* 盤の後ろの光彩が画面の外へはみ出しても、ページが横にスクロールしないようにする。 */}
            <main className="mx-auto flex w-full max-w-[1100px] flex-col gap-10 overflow-x-clip px-4 py-10">
                <section className="grid items-center gap-8 md:grid-cols-[1.05fr_0.95fr]">
                    <div className="flex flex-col gap-5">
                        <h1 className="text-balance font-display text-4xl leading-tight text-wafuu-sumi sm:text-5xl">
                            ブラウザだけで、
                            <span className="text-wafuu-shu">AI と指す・調べる</span>。
                        </h1>
                        {/* 折返しは文単位に限定する（inline-block）。字数依存の ch 幅だと
                            NNUE/GUI など欧文混じりで語の途中に改行が落ちるため使わない。 */}
                        <p className="max-w-[26rem] text-[15px] leading-relaxed text-wafuu-sumi-light">
                            <span className="inline-block">
                                NNUE エンジンがブラウザ内で動きます。
                            </span>
                            <span className="inline-block">
                                インストールも GUI の設定も不要です。
                            </span>
                        </p>
                        <div className="flex flex-wrap gap-3">
                            <Link
                                to="/play"
                                className="inline-flex items-center gap-2 rounded-lg bg-wafuu-shu px-5 py-3 text-sm font-semibold text-wafuu-shu-fg shadow-card transition-colors hover:bg-wafuu-shu-light focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
                            >
                                <span aria-hidden>▲</span>
                                AI と対局する
                            </Link>
                            <Link
                                to="/studies"
                                className="inline-flex items-center gap-2 rounded-lg border border-wafuu-border bg-background px-5 py-3 text-sm font-semibold text-wafuu-sumi transition-colors hover:border-wafuu-ai/50 hover:text-wafuu-ai focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
                            >
                                棋譜を調べる
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

                <section
                    aria-label="できること"
                    className="grid gap-x-6 gap-y-6 sm:grid-cols-2 lg:grid-cols-4"
                >
                    <EntryCard to="/play" heading="AI と対局">
                        内蔵の NNUE エンジンと指す。強さと持ち時間を選べる。ログイン不要。
                    </EntryCard>
                    <EntryCard to="/studies" heading="棋譜を調べる">
                        棋譜を貼り付けて AI で解析。変化やコメントを研究ノートに残せる。
                    </EntryCard>
                    <EntryCard to="/online" heading="オンライン対局">
                        部屋を作り、招待リンクで人と指す。名前を入れるだけで参加できる。
                    </EntryCard>
                    <EntryCard to="/rshogi-viewer" heading="観戦">
                        進行中のエンジン対局をリアルタイムで見る。終局した棋譜も再生できる。
                    </EntryCard>
                </section>
            </main>
        </>
    );
}
