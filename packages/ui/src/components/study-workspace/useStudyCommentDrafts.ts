import { useRef, useState } from "react";
import { isStudyCommentOverLimit, type StudyCommentDraftChange } from "./StudyCommentBox";

/** 保存できていないコメントの入力。 */
export interface StudyCommentDraft {
    /** コメントを書いていた手（保存用の `nodeId`）。 */
    nodeId: string;
    text: string;
    /**
     * この下書きを書き始めたときの、保存済みのコメント。開き直したときに保存済みのコメントが
     * ここから変わっていたら、自動では保存せず、利用者に選んでもらう。分からなければ省略。
     */
    base?: string | null;
}

interface HeldCommentDraft {
    text: string;
    base?: string | null;
    /** 開いたときに戻した（前回までの）書きかけ。 */
    fromStorage?: boolean;
}

const toggleInSet = (
    previous: ReadonlySet<string>,
    nodeId: string,
    present: boolean,
): ReadonlySet<string> => {
    if (previous.has(nodeId) === present) return previous;
    const next = new Set(previous);
    if (present) next.add(nodeId);
    else next.delete(nodeId);
    return next;
};

/**
 * まだ保存できていないコメントの入力（手ごと）。コメント欄は手を移るたびに作り直すので、上限を
 * 超えていて保存できない入力も、ここに残しておき、その手へ戻ったときに戻す。
 */
export function useStudyCommentDrafts({
    initialDrafts,
    onDraftChange,
}: {
    initialDrafts: readonly StudyCommentDraft[] | null | undefined;
    onDraftChange?: (nodeId: string, change: StudyCommentDraftChange) => void;
}) {
    const draftsRef = useRef<Map<string, HeldCommentDraft> | null>(null);
    if (!draftsRef.current) {
        draftsRef.current = new Map(
            (initialDrafts ?? []).map((draft) => [
                draft.nodeId,
                { text: draft.text, base: draft.base, fromStorage: true },
            ]),
        );
    }
    const drafts = draftsRef.current;
    // 保存できていない書きかけがある手（コメントのボタンに印を付ける。欄を畳んでいても気づけるように）。
    const [draftIds, setDraftIds] = useState<ReadonlySet<string>>(() => new Set(drafts.keys()));
    // コメントが長すぎて保存できていない手（棋譜に印を付ける）。
    const [overLimitIds, setOverLimitIds] = useState<ReadonlySet<string>>(
        () =>
            new Set(
                (initialDrafts ?? [])
                    .filter((draft) => isStudyCommentOverLimit(draft.text))
                    .map((draft) => draft.nodeId),
            ),
    );
    // 書きかけが別の画面での変更とぶつかり、利用者の選択を待っている手（棋譜に印を付ける）。
    const [conflictIds, setConflictIds] = useState<ReadonlySet<string>>(() => new Set());

    const changeDraft = (nodeId: string, change: StudyCommentDraftChange): void => {
        if (change.type === "set") {
            drafts.set(nodeId, { text: change.text, base: change.base });
        } else if (
            // 消すのは、持っている下書きが、保存できた内容と同じときだけ。作り直す前のコメント欄の
            // 保存があとから終わっても、そのあとに書いた新しい下書きは消さない。
            change.savedText === null ||
            drafts.get(nodeId)?.text === change.savedText
        ) {
            drafts.delete(nodeId);
        }
        const held = drafts.get(nodeId);
        setDraftIds((previous) => toggleInSet(previous, nodeId, held !== undefined));
        const isOver = held !== undefined && isStudyCommentOverLimit(held.text);
        setOverLimitIds((previous) => toggleInSet(previous, nodeId, isOver));
        onDraftChange?.(nodeId, change);
    };
    const changeConflict = (nodeId: string, conflicted: boolean): void => {
        setConflictIds((previous) => toggleInSet(previous, nodeId, conflicted));
    };

    // 棋譜に付ける「未保存」の印（選択待ちの書きかけと、長すぎて保存できない書きかけ）。
    const unsaved = new Map<string, "over_limit" | "conflict">();
    for (const nodeId of overLimitIds) unsaved.set(nodeId, "over_limit");
    for (const nodeId of conflictIds) unsaved.set(nodeId, "conflict");

    return {
        /** 手ごとの書きかけ（コメント欄を作り直したときに戻す）。 */
        drafts,
        /** 保存できていない書きかけがある手。 */
        draftIds,
        /** 棋譜に「未保存」の印を付ける手と、その理由。 */
        unsaved,
        changeDraft,
        changeConflict,
    };
}
