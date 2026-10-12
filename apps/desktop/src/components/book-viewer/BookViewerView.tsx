import { getPositionService } from "@shogi/app-core";
import { BookTreeViewer } from "@shogi/ui";
import { Button } from "@shogi/ui/components/button";

export function BookViewerView({ onBackToLocal }: { onBackToLocal: () => void }) {
    return (
        <div className="flex flex-col gap-3">
            <div>
                <Button variant="outline" size="sm" onClick={onBackToLocal}>
                    ← ローカル対局へ戻る
                </Button>
            </div>
            <BookTreeViewer
                fetchLegalMoves={(sfen, moves) => getPositionService().getLegalMoves(sfen, moves)}
            />
        </div>
    );
}
