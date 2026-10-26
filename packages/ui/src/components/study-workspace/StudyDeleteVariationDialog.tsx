import type { KifuTree, StudyDocument } from "@shogi/app-core";
import type { ReactElement } from "react";
import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
} from "../alert-dialog";
import { studyMoveLabel, studySubtreeSize, studyVariationLength } from "./studyView";

/**
 * 消す変化に、取り込んだ棋譜の手（対局時の情報つき）が含まれるか。本譜を入れ替えたあとは、
 * 元の対局の手順も変化として消せるので、確認の文面で知らせる。評価値も消費時間も付いて
 * いない棋譜（`source` が無い）では見分けられないので、知らせない。
 */
const subtreeHasSource = (doc: StudyDocument, rootId: string): boolean => {
    const stack = [rootId];
    while (stack.length > 0) {
        const id = stack.pop() as string;
        if (!Object.hasOwn(doc.tree.nodes, id)) continue;
        const stored = doc.tree.nodes[id];
        if (stored.source !== null) return true;
        stack.push(...stored.children);
    }
    return false;
};

/** 変化を消す前の確認。消える手数・局面の数と、取り込んだ棋譜の手が含まれるかを知らせる。 */
export function StudyDeleteVariationDialog({
    doc,
    tree,
    open,
    targetId,
    onCancel,
    onConfirm,
}: {
    doc: StudyDocument;
    tree: KifuTree;
    open: boolean;
    /** 消す変化の最初の手。 */
    targetId: string | null;
    onCancel: () => void;
    onConfirm: () => void;
}): ReactElement {
    const target = targetId ? tree.nodes.get(targetId) : undefined;
    const hasSource = targetId ? subtreeHasSource(doc, targetId) : false;
    return (
        <AlertDialog
            open={open}
            onOpenChange={(next) => {
                if (!next) onCancel();
            }}
        >
            <AlertDialogContent>
                <AlertDialogHeader>
                    <AlertDialogTitle>この変化を削除しますか？</AlertDialogTitle>
                    <AlertDialogDescription>
                        {target && targetId
                            ? `${target.ply}手目 ${studyMoveLabel(tree, targetId)} から先の ${studyVariationLength(tree, targetId)} 手（その先の枝分かれを含めて ${studySubtreeSize(tree, targetId)} 局面）と、その解析結果・コメントを削除します。${
                                  hasSource
                                      ? "取り込んだ棋譜の手（対局時の評価値など）も含まれます。"
                                      : ""
                              }元に戻せません。`
                            : "変化と、その解析結果・コメントを削除します。"}
                    </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                    <AlertDialogCancel>やめる</AlertDialogCancel>
                    <AlertDialogAction onClick={onConfirm}>削除する</AlertDialogAction>
                </AlertDialogFooter>
            </AlertDialogContent>
        </AlertDialog>
    );
}
