import { NnueLibrary } from "@shogi/ui";
import type { ReactElement } from "react";
import { HeaderNav } from "../../components/HeaderNav";
import { PageContainer } from "../../components/PageContainer";
import { PageHeader } from "../../components/PageHeader";
import { PageHeading } from "../../components/PageHeading";
import { useAccountNnue } from "../../hooks/useAccountNnue";

export default function NnueFilesPage(): ReactElement {
    const account = useAccountNnue();

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
                />
                <NnueLibrary
                    manifestUrl={import.meta.env.VITE_NNUE_MANIFEST_URL as string}
                    fallbackIconUrl={`${import.meta.env.BASE_URL}ramu.jpeg`}
                    account={account}
                />
            </PageContainer>
        </>
    );
}
