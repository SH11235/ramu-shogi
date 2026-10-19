import { getPositionService } from "@shogi/app-core";
import { BookTreeViewer } from "@shogi/ui";
import { HeaderNav } from "../../components/HeaderNav";
import { PageContainer } from "../../components/PageContainer";
import { PageHeader } from "../../components/PageHeader";

export default function BookViewerPage() {
    return (
        <>
            <PageHeader
                items={[{ label: "ラム将棋", to: "/" }, { label: "定跡ビュアー" }]}
                right={<HeaderNav />}
            />
            <PageContainer width="wide">
                <BookTreeViewer
                    fetchLegalMoves={(sfen, moves) =>
                        getPositionService().getLegalMoves(sfen, moves)
                    }
                />
            </PageContainer>
        </>
    );
}
