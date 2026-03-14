import type { GameRecordDetail } from "@shogi/api-contract";
import { getRouteApi } from "@tanstack/react-router";
import type { ReactElement } from "react";
import { HeaderNav } from "../../components/HeaderNav";
import { PageHeader } from "../../components/PageHeader";
import { formatGameResult } from "./gameResultUtils";

const routeApi = getRouteApi("/public/games/$publicId");

export default function PublicGamePage(): ReactElement {
    const game = routeApi.useLoaderData() as GameRecordDetail;

    return (
        <>
            <PageHeader
                items={[{ label: "ラム将棋", to: "/" }, { label: "公開棋譜" }]}
                right={<HeaderNav />}
            />
            <main className="mx-auto flex max-w-[960px] flex-col gap-6 px-4 py-8">
                <section className="rounded-xl border border-border bg-card p-5 shadow-sm">
                    <div className="flex flex-col gap-3">
                        <div className="flex flex-wrap items-center gap-2 text-xs">
                            <span className="rounded-full bg-muted px-2 py-1 text-muted-foreground">
                                {game.visibility}
                            </span>
                            <span className="rounded-full bg-muted px-2 py-1 text-muted-foreground">
                                {game.source}
                            </span>
                        </div>
                        <div className="flex flex-col gap-1">
                            <h1 className="text-2xl font-bold text-foreground">
                                {game.participants
                                    .map((participant) => participant.displayNameSnapshot)
                                    .join(" vs ")}
                            </h1>
                            <p className="text-sm text-muted-foreground">
                                {formatGameResult(game)}
                            </p>
                        </div>
                    </div>
                </section>

                <section className="rounded-xl border border-border bg-card p-5 shadow-sm">
                    <h2 className="mb-3 text-lg font-semibold text-foreground">指し手</h2>
                    <ol className="grid gap-2 text-sm text-foreground">
                        {game.moves.map((move, index) => {
                            const ply = index + 1;
                            return (
                                <li
                                    key={`${game.id}:${ply}:${move}`}
                                    className="rounded-md border border-border px-3 py-2"
                                >
                                    {ply}. {move}
                                </li>
                            );
                        })}
                    </ol>
                </section>

                <section className="rounded-xl border border-border bg-card p-5 shadow-sm">
                    <h2 className="mb-3 text-lg font-semibold text-foreground">KIF テキスト</h2>
                    <pre className="overflow-x-auto rounded-md bg-muted/40 p-4 text-xs text-foreground">
                        {game.kifuText}
                    </pre>
                </section>
            </main>
        </>
    );
}
