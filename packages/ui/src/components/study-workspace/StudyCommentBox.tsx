/**
 * いま見ている手のコメント。入力が止まったら自動で保存する。
 *
 * コメントには上限（UTF-8 で 4 KiB）がある。黙って切らず、上限に近づいたら残りを出し、
 * 超えたら保存を止めてその場で知らせる（入力した内容は残す）。
 */

import { STUDY_LIMITS } from "@shogi/app-core";
import { cn } from "@shogi/design-system";
import type { ReactElement } from "react";
import { useEffect, useRef, useState } from "react";

interface StudyCommentBoxProps {
    /** 保存されているコメント。 */
    value: string;
    /** コメントを保存する（上限に収まっているときだけ呼ばれる）。 */
    onChange: (value: string) => void;
    className?: string;
}

const COMMENT_SAVE_DELAY_MS = 700;
/** 残りがこのバイト数を下回ったら、残りを表示する。 */
const REMAINING_NOTICE_BYTES = 600;

const utf8Length = (text: string): number => new TextEncoder().encode(text).length;

/**
 * コメント欄。別の局面へ移るときは `key` を変えて作り直すこと（書きかけは、そのとき保存する）。
 */
export function StudyCommentBox({
    value,
    onChange,
    className,
}: StudyCommentBoxProps): ReactElement {
    const [draft, setDraft] = useState(value);
    const lastSavedRef = useRef(value);
    const draftRef = useRef(value);
    const onChangeRef = useRef(onChange);
    useEffect(() => {
        onChangeRef.current = onChange;
    }, [onChange]);

    // 他のタブ・端末で変わったコメントを取り込む（こちらで編集中でなければ）。
    useEffect(() => {
        if (value === lastSavedRef.current) return;
        if (draftRef.current === lastSavedRef.current) {
            draftRef.current = value;
            setDraft(value);
        }
        lastSavedRef.current = value;
    }, [value]);

    const save = (): void => {
        if (draftRef.current === lastSavedRef.current) return;
        // 上限を超えている間は保存しない（入力は残し、下の案内で知らせる）。
        if (utf8Length(draftRef.current) > STUDY_LIMITS.commentBytes) return;
        lastSavedRef.current = draftRef.current;
        onChangeRef.current(draftRef.current);
    };
    const saveRef = useRef(save);
    saveRef.current = save;

    // 入力が止まったら保存する。
    useEffect(() => {
        if (draft === lastSavedRef.current) return;
        const timer = setTimeout(() => saveRef.current(), COMMENT_SAVE_DELAY_MS);
        return () => clearTimeout(timer);
    }, [draft]);

    // 別の局面へ移るとき（このコンポーネントが作り直されるとき）に、書きかけを保存する。
    useEffect(() => () => saveRef.current(), []);

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
