/**
 * いま見ている手のコメント。入力が止まったら自動で保存する。
 *
 * コメントには上限（UTF-8 で 4 KiB）がある。黙って切らず、上限に近づいたら残りを出し、
 * 超えたら保存を止めてその場で知らせる（入力した内容は残す）。上限を超えたまま別の手へ移っても、
 * 入力は呼び出し側が手ごとに持っておき、その手へ戻ると `initialDraft` で戻る。
 *
 * まだ保存できていない入力（下書き）は `onDraftChange` で呼び出し側に知らせる。保存できない間
 * （セッションが切れた、など）も入力を失わないよう、呼び出し側が別の場所に残せるようにするため。
 */

import { STUDY_LIMITS } from "@shogi/app-core";
import { cn } from "@shogi/design-system";
import type { ReactElement } from "react";
import { useEffect, useRef, useState } from "react";

interface StudyCommentBoxProps {
    /** 保存されているコメント。 */
    value: string;
    /**
     * コメントを保存する（上限に収まっているときだけ呼ばれる）。保存できなかったとき `false` で
     * 解決する Promise を返すと、入力を「まだ保存していない」扱いに戻す。
     */
    // biome-ignore lint/suspicious/noConfusingVoidType: 何も返さないコールバックもそのまま渡せるようにする
    onChange: (value: string) => void | Promise<boolean>;
    /** 最初に入れておく下書き（前回、保存できないまま残っていた入力）。 */
    initialDraft?: string;
    /** 保存していない入力が変わった。保存できたら null。 */
    onDraftChange?: (draft: string | null) => void;
    /** 保存できない状態（入力は残すが、保存はしない）。 */
    disabled?: boolean;
    className?: string;
}

const COMMENT_SAVE_DELAY_MS = 700;
/** 残りがこのバイト数を下回ったら、残りを表示する。 */
const REMAINING_NOTICE_BYTES = 600;

const utf8Length = (text: string): number => new TextEncoder().encode(text).length;

/** コメントが保存できる長さの上限を超えているか。 */
export function isStudyCommentOverLimit(text: string): boolean {
    return utf8Length(text) > STUDY_LIMITS.commentBytes;
}

/**
 * コメント欄。別の局面へ移るときは `key` を変えて作り直すこと（書きかけは、そのとき保存する）。
 */
export function StudyCommentBox({
    value,
    onChange,
    initialDraft,
    onDraftChange,
    disabled = false,
    className,
}: StudyCommentBoxProps): ReactElement {
    const [draft, setDraft] = useState(initialDraft ?? value);
    const lastSavedRef = useRef(value);
    const draftRef = useRef(initialDraft ?? value);
    const disabledRef = useRef(disabled);
    disabledRef.current = disabled;
    const callbacksRef = useRef({ onChange, onDraftChange });
    useEffect(() => {
        callbacksRef.current = { onChange, onDraftChange };
    }, [onChange, onDraftChange]);

    // 他のタブ・端末で変わったコメントを取り込む（こちらで編集中でなければ）。
    useEffect(() => {
        if (value === lastSavedRef.current) return;
        if (draftRef.current === lastSavedRef.current) {
            draftRef.current = value;
            setDraft(value);
        }
        lastSavedRef.current = value;
    }, [value]);

    /** 保存していない入力があれば、その内容を呼び出し側に知らせる。 */
    const reportDraft = (): void => {
        callbacksRef.current.onDraftChange?.(
            draftRef.current === lastSavedRef.current ? null : draftRef.current,
        );
    };

    const save = (): void => {
        if (disabledRef.current) return;
        if (draftRef.current === lastSavedRef.current) return;
        // 上限を超えている間は保存しない（入力は残し、下の案内で知らせる）。
        if (isStudyCommentOverLimit(draftRef.current)) return;
        const previous = lastSavedRef.current;
        const attempted = draftRef.current;
        lastSavedRef.current = attempted;
        const outcome = callbacksRef.current.onChange(attempted);
        if (!(outcome instanceof Promise)) {
            reportDraft();
            return;
        }
        void outcome.then((saved) => {
            // 保存できなかったら、まだ保存していない入力として扱い直す（下書きとして残る）。
            if (!saved && lastSavedRef.current === attempted) lastSavedRef.current = previous;
            reportDraft();
        });
    };
    const saveRef = useRef(save);
    saveRef.current = save;

    // 入力が止まったら保存する。保存できない状態が解けたときも、残っていた入力を保存する。
    // biome-ignore lint/correctness/useExhaustiveDependencies: disabled が変わったときにも保存を試みる
    useEffect(() => {
        if (draft === lastSavedRef.current) return;
        const timer = setTimeout(() => saveRef.current(), COMMENT_SAVE_DELAY_MS);
        return () => clearTimeout(timer);
    }, [draft, disabled]);

    // 最初から下書きが入っているとき（前回の入力の復元）は、その旨を知らせる。
    // 別の局面へ移るとき（このコンポーネントが作り直されるとき）に、書きかけを保存する。
    // biome-ignore lint/correctness/useExhaustiveDependencies: マウント時と、アンマウント時にだけ行う
    useEffect(() => {
        if (draftRef.current !== lastSavedRef.current) reportDraft();
        return () => saveRef.current();
    }, []);

    const remaining = STUDY_LIMITS.commentBytes - utf8Length(draft);
    const isOver = remaining < 0;
    // かな・漢字は 1 文字 3 バイトなので、目安の文字数はバイト数の 1/3。
    const approxChars = Math.ceil(Math.abs(remaining) / 3);

    return (
        <section
            aria-label="コメント"
            className={cn(
                "flex flex-col gap-1 rounded-xl border border-wafuu-border bg-card p-3 shadow-sm",
                className,
            )}
        >
            <label className="flex flex-col gap-1 text-xs text-muted-foreground">
                コメント
                <textarea
                    value={draft}
                    onChange={(event) => {
                        draftRef.current = event.target.value;
                        setDraft(event.target.value);
                        reportDraft();
                    }}
                    onBlur={save}
                    rows={2}
                    aria-invalid={isOver}
                    placeholder="この手について気づいたことを書けます（自動で保存されます）"
                    className={cn(
                        "w-full resize-y rounded-md border bg-background p-2 text-base text-foreground placeholder:text-muted-foreground/70 focus:outline-none focus:ring-2 focus:ring-ring md:text-sm",
                        isOver ? "border-destructive" : "border-border",
                    )}
                />
            </label>
            {isOver ? (
                <p role="alert" className="text-xs text-destructive">
                    コメントが長すぎます。あと約 {approxChars}{" "}
                    文字ぶん短くしてください（短くするまで保存されません）。
                </p>
            ) : (
                remaining < REMAINING_NOTICE_BYTES && (
                    <p className="text-xs text-muted-foreground">
                        あと約 {approxChars} 文字まで書けます。
                    </p>
                )
            )}
        </section>
    );
}
