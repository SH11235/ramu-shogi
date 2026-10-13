import { getPositionService } from "@shogi/app-core";
import { BookTreeViewer } from "@shogi/ui";
import { HeaderNav } from "../../components/HeaderNav";
import { PageHeader } from "../../components/PageHeader";

export default function BookViewerPage() {
    return (
        <div className="flex flex-col gap-4">
            <PageHeader
                items={[{ label: "ラム将棋", to: "/" }, { label: "定跡ビュアー" }]}
                right={<HeaderNav />}
            />
            <BookTreeViewer
                fetchLegalMoves={(sfen, moves) => getPositionService().getLegalMoves(sfen, moves)}
            />
        </div>
    );
}
