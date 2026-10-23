import { NnueLibrary } from "@shogi/ui";
import { getRouteApi, Link } from "@tanstack/react-router";
import type { ReactElement } from "react";
import { useState } from "react";
import { HeaderNav } from "../../components/HeaderNav";
import { PageContainer } from "../../components/PageContainer";
import { PageHeader } from "../../components/PageHeader";
import { PageHeading } from "../../components/PageHeading";
import { useAccountNnue } from "../../hooks/useAccountNnue";
import { sanitizeReturnPath } from "../../lib/loginReturn";

const routeApi = getRouteApi("/nnue");

function returnLabel(path: string): string {
    if (path.startsWith("/play")) return "対局の設定に戻る";
    if (path.startsWith("/studies")) return "研究ノートに戻る";
    return "前の画面に戻る";
}

export default function NnueFilesPage(): ReactElement {
    const { from } = routeApi.useSearch();
    const returnPath = sanitizeReturnPath(from);
    const account = useAccountNnue();
    const [isReady, setIsReady] = useState(false);

    return (
        <>
            <PageHeader
                items={[{ label: "ラム将棋", to: "/" }, { label: "AI（評価関数）" }]}
                right={<HeaderNav />}
            />
            <PageContainer>
                <PageHeading
                    title="AI（評価関数）"
                    description="対局の相手や研究の解析に使う AI を、ここでそろえます。"
                >
                    {returnPath && (
                        <Link
                            to={returnPath}
                            className={
                                isReady
                                    ? "self-start rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground shadow transition-colors hover:bg-primary/90"
                                    : "self-start text-sm text-wafuu-ai underline underline-offset-2 hover:text-wafuu-ai-light"
                            }
                        >
                            ← {returnLabel(returnPath)}
                        </Link>
                    )}
                </PageHeading>
                <NnueLibrary
                    manifestUrl={import.meta.env.VITE_NNUE_MANIFEST_URL as string}
                    fallbackIconUrl={`${import.meta.env.BASE_URL}ramu.jpeg`}
                    account={account}
                    deviceLabel="このブラウザ"
                    onReady={() => setIsReady(true)}
                />
            </PageContainer>
        </>
    );
}
