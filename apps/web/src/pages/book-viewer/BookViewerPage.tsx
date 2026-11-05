import { getPositionService } from "@shogi/app-core";
import { BookTreeViewer } from "@shogi/ui";
import { HeaderNav } from "../../components/HeaderNav";
import { PageHeader } from "../../components/PageHeader";

/** 盤を見せたまま木を送れるよう、ページは画面の高さに収め、送るのは木と指し手の一覧の中だけにする。 */
export default function BookViewerPage() {
    return (
        <div className="flex h-dvh flex-col">
            <PageHeader
                items={[{ label: "ラム将棋", to: "/" }, { label: "定跡ビュアー" }]}
                right={<HeaderNav />}
            />
            <main className="mx-auto flex min-h-0 w-full max-w-[1600px] flex-1 flex-col px-3 py-2 md:px-4 md:py-3">
                <BookTreeViewer
                    className="flex-1"
                    fetchLegalMoves={(sfen, moves) =>
                        getPositionService().getLegalMoves(sfen, moves)
                    }
                />
            </main>
        </div>
    );
}
