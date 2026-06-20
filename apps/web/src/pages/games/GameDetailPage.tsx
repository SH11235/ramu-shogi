import type {
    GameRecordDetail,
    GameRecordVisibility,
    UpdateGameVisibilityResponse,
} from "@shogi/api-contract";
import { getRouteApi, Link, useParams } from "@tanstack/react-router";
import type { ReactElement } from "react";
import { useState } from "react";
import { HeaderNav } from "../../components/HeaderNav";
import { PageContainer } from "../../components/PageContainer";
import { PageHeader } from "../../components/PageHeader";
import { Section } from "../../components/Section";
import { StatusBanner } from "../../components/StatusBanner";
import { parseApiError } from "../../hooks/useAuthSession";
import { formatGameResult } from "./gameResultUtils";

function buildPublicUrl(publicId: string): string {
    return `${window.location.origin}/public/games/${publicId}`;
}

const routeApi = getRouteApi("/games/$gameId");

export default function GameDetailPage(): ReactElement {
    const { gameId } = useParams({ from: "/games/$gameId" });
    const loaderGame = routeApi.useLoaderData() as GameRecordDetail;
    const [game, setGame] = useState(loaderGame);
    const [isUpdatingVisibility, setIsUpdatingVisibility] = useState(false);
    const [status, setStatus] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);

    const publicUrl =
        game.publicId && game.visibility !== "private" ? buildPublicUrl(game.publicId) : null;

    async function handleUpdateVisibility(visibility: GameRecordVisibility): Promise<void> {
        if (isUpdatingVisibility) return;

        setIsUpdatingVisibility(true);
        setStatus(null);
        setError(null);

        const response = await fetch(`/api/games/${game.id}/visibility`, {
            method: "PATCH",
            headers: {
                "Content-Type": "application/json",
            },
            credentials: "same-origin",
            body: JSON.stringify({ visibility }),
        });

        if (!response.ok) {
            setError(await parseApiError(response));
            setIsUpdatingVisibility(false);
            return;
        }

        const payload = (await response.json()) as UpdateGameVisibilityResponse;
        setGame((prev) => ({ ...prev, ...payload.game }));
        setStatus("公開設定を更新しました。");
        setIsUpdatingVisibility(false);
    }

    return (
        <>
            <PageHeader
                items={[
                    { label: "ラム将棋", to: "/" },
                    { label: "棋譜一覧", to: "/games" },
                    { label: "棋譜詳細" },
                ]}
                right={<HeaderNav />}
            />
            <PageContainer>
                {status && <StatusBanner variant="success">{status}</StatusBanner>}

                {error && <StatusBanner variant="error">{error}</StatusBanner>}

                <Section>
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

                        <div className="flex flex-wrap gap-4 text-sm text-muted-foreground">
                            <span>
                                開始:{" "}
                                {game.startedAt
                                    ? new Date(game.startedAt).toLocaleString("ja-JP")
                                    : "不明"}
                            </span>
                            <span>
                                終了:{" "}
                                {game.finishedAt
                                    ? new Date(game.finishedAt).toLocaleString("ja-JP")
                                    : "不明"}
                            </span>
                        </div>
                    </div>
                </Section>

                <Section>
                    <div>
                        <h2 className="text-lg font-semibold text-foreground">公開設定</h2>
                        <p className="text-sm text-muted-foreground">
                            限定公開・公開への変更はメール確認済みアカウントのみできます。
                        </p>
                    </div>
                    <div className="flex flex-col gap-2">
                        {(
                            [
                                {
                                    value: "private",
                                    label: "非公開",
                                    description: "自分だけが閲覧できます。",
                                },
                                {
                                    value: "unlisted",
                                    label: "限定公開",
                                    description:
                                        "共有リンクを知っている人が閲覧できます。公開棋譜一覧には掲載されません。",
                                },
                                {
                                    value: "public",
                                    label: "公開",
                                    description: "公開棋譜一覧に掲載され、誰でも閲覧できます。",
                                },
                            ] as const
                        ).map(({ value, label, description }) => (
                            <button
                                key={value}
                                type="button"
                                onClick={() => void handleUpdateVisibility(value)}
                                disabled={isUpdatingVisibility || game.visibility === value}
                                className="flex items-start gap-3 rounded-md border border-input px-4 py-3 text-left transition-colors hover:bg-muted/50 disabled:pointer-events-none disabled:opacity-50"
                            >
                                <span className="mt-0.5 text-sm font-medium text-foreground">
                                    {label}
                                </span>
                                <span className="text-sm text-muted-foreground">{description}</span>
                            </button>
                        ))}
                    </div>
                </Section>

                {publicUrl && game.publicId && (
                    <Section>
                        <div>
                            <h2 className="text-lg font-semibold text-foreground">共有リンク</h2>
                            <p className="text-sm text-muted-foreground">
                                このリンクを知っている人は棋譜を閲覧できます。
                            </p>
                        </div>
                        <div className="flex items-center gap-2">
                            <span className="flex-1 truncate rounded-md bg-muted/40 px-3 py-2 text-sm text-foreground">
                                {publicUrl}
                            </span>
                            <button
                                type="button"
                                onClick={() => {
                                    navigator.clipboard
                                        .writeText(publicUrl)
                                        .then(() => {
                                            setStatus("共有リンクをコピーしました。");
                                        })
                                        .catch(() => {
                                            setError("共有リンクのコピーに失敗しました。");
                                        });
                                }}
                                className="shrink-0 rounded-md border border-input px-3 py-2 text-sm font-medium text-foreground transition-colors hover:bg-muted/50"
                            >
                                コピー
                            </button>
                            <Link
                                to="/public/games/$publicId"
                                params={{ publicId: game.publicId }}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="shrink-0 rounded-md border border-input px-3 py-2 text-sm font-medium text-foreground transition-colors hover:bg-muted/50"
                            >
                                開く
                            </Link>
                        </div>
                    </Section>
                )}

                <Section>
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                        <div>
                            <h2 className="text-lg font-semibold text-foreground">検討</h2>
                            <p className="text-sm text-muted-foreground">
                                この棋譜を検討室で開き、解析結果 snapshot を保存できます。
                            </p>
                        </div>
                        <Link
                            to="/games/$gameId/review"
                            params={{ gameId }}
                            className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground shadow transition-colors hover:bg-primary/90"
                        >
                            棋譜を検討する
                        </Link>
                    </div>
                </Section>

                <Section>
                    <h2 className="text-lg font-semibold text-foreground">指し手</h2>
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
                </Section>

                <Section>
                    <div className="flex items-center justify-between gap-3">
                        <h2 className="text-lg font-semibold text-foreground">KIF テキスト</h2>
                        <button
                            type="button"
                            onClick={() => {
                                navigator.clipboard
                                    .writeText(game.kifuText)
                                    .then(() => {
                                        setStatus("棋譜をコピーしました。");
                                    })
                                    .catch(() => {
                                        setError("棋譜のコピーに失敗しました。");
                                    });
                            }}
                            className="rounded-md border border-input px-3 py-2 text-sm font-medium text-foreground transition-colors hover:bg-muted/50"
                        >
                            コピー
                        </button>
                    </div>
                    <pre className="overflow-x-auto rounded-md bg-muted/40 p-4 text-xs text-foreground">
                        {game.kifuText}
                    </pre>
                </Section>
            </PageContainer>
        </>
    );
}
