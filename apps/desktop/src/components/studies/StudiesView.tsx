/**
 * 研究ノートの一覧（Desktop）。
 *
 * この端末に保存してあるノートを新しい順に並べ、棋譜の取り込み（貼り付け・ファイル）で
 * 新しいノートを作る。保存はこの端末の中だけ（ログインとクラウド同期は未対応）。
 */

import type { StudyLocalSummary, StudySync } from "@shogi/study-client";
import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
} from "@shogi/ui/components/alert-dialog";
import { Button } from "@shogi/ui/components/button";
import { StudyImportForm } from "@shogi/ui/components/study-workspace/StudyImportForm";
import { createStudyFromKifuSource } from "@shogi/ui/components/study-workspace/studyEntry";
import type { StudyKifuSource } from "@shogi/ui/components/study-workspace/studyImport";
import {
    studyOriginLabel,
    studyPlayersLabel,
} from "@shogi/ui/components/study-workspace/studyView";
import type { ReactElement } from "react";
import { useEffect, useState } from "react";
import { getDesktopStudySync } from "../../studies/desktopStudySync";

interface Props {
    onBackToLocal: () => void;
    onOpenStudy: (studyId: string) => void;
    /** 同期エンジンの差し替え（テスト用）。省略時はアプリのもの。 */
    sync?: StudySync;
}

function progressLabel(item: StudyLocalSummary): string {
    if (item.resultCount <= 0) return "未解析";
    if (item.resultCount >= item.nodeCount) return "解析済み";
    return `解析 ${item.resultCount} / ${item.nodeCount} 局面`;
}

export function StudiesView({
    onBackToLocal,
    onOpenStudy,
    sync = getDesktopStudySync(),
}: Props): ReactElement {
    const [items, setItems] = useState<StudyLocalSummary[] | null>(null);
    const [loadError, setLoadError] = useState<string | null>(null);
    const [deleteTarget, setDeleteTarget] = useState<StudyLocalSummary | null>(null);

    useEffect(() => {
        let cancelled = false;
        const reload = (): void => {
            sync.listLocal().then(
                (list) => {
                    if (cancelled) return;
                    setItems([...list].sort((a, b) => b.updatedAt - a.updatedAt));
                    setLoadError(null);
                },
                (error: unknown) => {
                    if (cancelled) return;
                    setLoadError(error instanceof Error ? error.message : String(error));
                },
            );
        };
        reload();
        // ノートが増えた・変わった・消えたら、並べ直す。
        const unsubscribe = sync.subscribeEvents(() => reload());
        return () => {
            cancelled = true;
            unsubscribe();
        };
    }, [sync]);

    const handleImport = async (source: StudyKifuSource): Promise<void> => {
        const { studyId } = await createStudyFromKifuSource(source, { sync });
        onOpenStudy(studyId);
    };

    const confirmDelete = (): void => {
        const target = deleteTarget;
        setDeleteTarget(null);
        if (!target) return;
        sync.deleteStudy(target.id).catch((error: unknown) => {
            console.error("[study] ノートを削除できませんでした", error);
            setLoadError("ノートを削除できませんでした。");
        });
    };

    return (
        <div className="flex flex-col gap-4">
            <div className="flex flex-wrap items-center gap-2">
                <Button variant="outline" size="sm" onClick={onBackToLocal}>
                    ← ローカル対局へ戻る
                </Button>
                <h1 className="text-sm font-semibold text-wafuu-sumi">研究ノート</h1>
                <span className="text-xs text-muted-foreground">
                    ノートは、この端末の中に保存されます。
                </span>
            </div>

            <section className="flex flex-col gap-3 rounded-xl border border-border bg-card p-4">
                <h2 className="text-base font-semibold text-foreground">
                    棋譜を取り込んで、研究ノートを作る
                </h2>
                <p className="text-sm text-muted-foreground">
                    棋譜を取り込んで全体を解析すると、見直すべき手が自動で並びます。解析結果・変化・コメントは自動で保存されます。
                </p>
                <StudyImportForm onImport={handleImport} />
            </section>

            {loadError && (
                <p role="alert" className="text-sm text-destructive">
                    {loadError}
                </p>
            )}
            {items === null && !loadError && (
                <p aria-live="polite" className="text-sm text-muted-foreground">
                    読み込み中...
                </p>
            )}
            {items !== null && items.length > 0 && (
                <>
                    <p className="text-xs text-muted-foreground">{items.length} 件</p>
                    <ul className="grid gap-3">
                        {items.map((item) => {
                            const players = studyPlayersLabel(item.meta);
                            return (
                                <li
                                    key={item.id}
                                    className="flex items-stretch gap-2 rounded-xl border border-border bg-card pr-2 shadow-sm transition-colors hover:bg-muted/20"
                                >
                                    <button
                                        type="button"
                                        onClick={() => onOpenStudy(item.id)}
                                        className="flex min-w-0 flex-1 flex-col gap-1.5 rounded-xl p-4 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                                    >
                                        <span className="truncate text-base font-semibold text-foreground">
                                            {item.title}
                                        </span>
                                        {players && (
                                            <span className="truncate text-sm text-muted-foreground">
                                                {players}
                                            </span>
                                        )}
                                        <span className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
                                            <span>{studyOriginLabel(item.origin)}</span>
                                            <span>{progressLabel(item)}</span>
                                            <span>
                                                更新{" "}
                                                {new Date(item.updatedAt).toLocaleString("ja-JP")}
                                            </span>
                                        </span>
                                    </button>
                                    <button
                                        type="button"
                                        onClick={() => setDeleteTarget(item)}
                                        aria-label={`「${item.title}」を削除`}
                                        className="min-h-10 shrink-0 self-center rounded-md px-3 text-xs text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                                    >
                                        削除
                                    </button>
                                </li>
                            );
                        })}
                    </ul>
                </>
            )}

            <AlertDialog
                open={deleteTarget !== null}
                onOpenChange={(open) => {
                    if (!open) setDeleteTarget(null);
                }}
            >
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>この研究ノートを削除しますか？</AlertDialogTitle>
                        <AlertDialogDescription>
                            「{deleteTarget?.title}
                            」と、その解析結果・変化・コメントを、この端末から削除します。元に戻せません。
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel>やめる</AlertDialogCancel>
                        <AlertDialogAction onClick={confirmDelete}>削除する</AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
        </div>
    );
}
