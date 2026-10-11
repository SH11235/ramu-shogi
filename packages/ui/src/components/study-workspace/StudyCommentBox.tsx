/**
 * いま見ている手のコメント。入力が止まったら自動で保存する。
 *
 * コメントには上限（UTF-8 で 4 KiB）がある。黙って切らず、上限に近づいたら残りを出し、
 * 超えたら保存を止めてその場で知らせる（入力した内容は残す）。上限を超えたまま別の手へ移っても、
 * 入力は呼び出し側が手ごとに持っておき、その手へ戻ると `initialDraft` で戻る。
 *
 * まだ保存できていない入力（下書き）は `onDraftChange` で呼び出し側に知らせる。保存できない間
 * （セッションが切れた、など）も入力を失わないよう、呼び出し側が別の場所に残せるようにするため。
 *
 * 下書きの通知は「どの入力についてのものか」を持つ:
 * - 置く（`set`）: 入力の内容と、その入力を書き始めたときの保存済みコメント（`base`）。
 * - 消す（`clear`）: 保存できた内容（`savedText`）。呼び出し側は、持っている下書きがその内容と
 *   同じときだけ消す（この欄が作り直されたあとに届いた古い保存の完了が、新しい下書きを
 *   消さないように）。`savedText` が null なら、内容に関わらず消す（利用者が捨てた、など）。
 *
 * 古い下書きが、あとから保存された新しいコメントを黙って上書きしないようにする:
 * - 戻す下書きが保存済みのコメントと同じなら、下書きを消すだけ（保存し直さない）。
 * - 下書きを書き始めたあとに保存済みのコメントが変わっていたら、自動では保存せず、
 *   「以前の書きかけがあります」と出して利用者に選んでもらう（使う / 捨てる）。
 * - 他のタブ・端末の変更を取り込んだとき、入力中でない下書きは、取り込んだ内容を優先して消す。
 */

import { STUDY_LIMITS } from "@shogi/app-core";
import { cn } from "@shogi/design-system";
import type { ReactElement } from "react";
import { useEffect, useRef, useState } from "react";

/** 下書きの変化（呼び出し側が、手ごとの下書きの置き場所に反映する）。 */
export type StudyCommentDraftChange =
    | {
          type: "set";
          text: string;
          /** この入力を書き始めたときの、保存済みのコメント。 */
          base: string;
      }
    | {
          type: "clear";
          /**
           * 保存できた内容。持っている下書きがこの内容と同じときだけ消す。
           * null なら、内容に関わらず消す。
           */
          savedText: string | null;
      };

interface StudyCommentBoxProps {
    /** 保存されているコメント。 */
    value: string;
    /**
     * コメントを保存する（上限に収まっているときだけ呼ばれる）。保存できなかったとき `false` で
     * 解決する Promise を返すと、入力を「まだ保存していない」扱いに戻す。
     */
    // biome-ignore lint/suspicious/noConfusingVoidType: 何も返さないコールバックもそのまま渡せるようにする
    onChange: (value: string) => void | Promise<boolean>;
    /**
     * 最初に戻す下書き（保存できないまま残っていた入力）。`base` は、その下書きを書き始めた
     * ときの保存済みのコメント（分からなければ省略。その場合は、利用者に選んでもらう）。
     */
    initialDraft?: { text: string; base?: string | null };
    /** 下書きが変わった。 */
    onDraftChange?: (change: StudyCommentDraftChange) => void;
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
    // 戻す下書きの扱いを、最初に 1 回だけ決める。
    const [restore] = useState<{
        /** そのまま入力として戻す内容（自動で保存される）。 */
        adopted: string | null;
        /** 利用者に選んでもらう内容（保存済みのコメントが、書き始めたときから変わっている）。 */
        pending: string | null;
        /** 保存済みと同じだったので、消すだけの下書きがあった。 */
        redundant: boolean;
    }>(() => {
        if (!initialDraft) return { adopted: null, pending: null, redundant: false };
        if (initialDraft.text === value) return { adopted: null, pending: null, redundant: true };
        return initialDraft.base === value
            ? { adopted: initialDraft.text, pending: null, redundant: false }
            : { adopted: null, pending: initialDraft.text, redundant: false };
    });
    const [draft, setDraft] = useState(restore.adopted ?? value);
    // 利用者の選択を待っている、以前の書きかけ。
    const [pendingRestore, setPendingRestore] = useState<string | null>(restore.pending);
    const lastSavedRef = useRef(value);
    const draftRef = useRef(restore.adopted ?? value);
    const focusedRef = useRef(false);
    const disabledRef = useRef(disabled);
    disabledRef.current = disabled;
    const callbacksRef = useRef({ onChange, onDraftChange });
    useEffect(() => {
        callbacksRef.current = { onChange, onDraftChange };
    }, [onChange, onDraftChange]);

    /** いまの入力を、下書きとして知らせる（保存済みと同じなら、下書きは要らない）。 */
    const reportDraft = (): void => {
        const text = draftRef.current;
        callbacksRef.current.onDraftChange?.(
            text === lastSavedRef.current
                ? { type: "clear", savedText: text }
                : { type: "set", text, base: lastSavedRef.current },
        );
    };

    // 他のタブ・端末で変わったコメントを取り込む。
    useEffect(() => {
        if (value === lastSavedRef.current) return;
        const isDirty = draftRef.current !== lastSavedRef.current;
        lastSavedRef.current = value;
        if (!isDirty) {
            draftRef.current = value;
            setDraft(value);
            return;
        }
        if (draftRef.current === value) {
            // 同じ内容が保存された。下書きは要らない。
            callbacksRef.current.onDraftChange?.({ type: "clear", savedText: value });
            return;
        }
        // 入力中（フォーカスがあり、保存していない変更がある）なら、入力を残す。
        if (focusedRef.current) return;
        // 入力中でない下書きは、取り込んだ内容を優先して消す（古い下書きで上書きしない）。
        draftRef.current = value;
        setDraft(value);
        callbacksRef.current.onDraftChange?.({ type: "clear", savedText: null });
    }, [value]);

    const save = (): void => {
        if (disabledRef.current) return;
        if (draftRef.current === lastSavedRef.current) return;
        // 上限を超えている間は保存しない（入力は残し、下の案内で知らせる）。
        if (isStudyCommentOverLimit(draftRef.current)) return;
        const previous = lastSavedRef.current;
        const attempted = draftRef.current;
        lastSavedRef.current = attempted;
        const outcome = callbacksRef.current.onChange(attempted);
        const reportSaved = (): void =>
            callbacksRef.current.onDraftChange?.({ type: "clear", savedText: attempted });
        if (!(outcome instanceof Promise)) {
            reportSaved();
            return;
        }
        void outcome.then((saved) => {
            if (saved) {
                // 保存できた内容を添えて知らせる（この間に書かれた新しい下書きは、消されない）。
                reportSaved();
                return;
            }
            // 保存できなかったら、まだ保存していない入力として扱い直す。下書きは置いたままなので、
            // 置き直さない（この間に書かれた新しい下書きを、古い内容で上書きしない）。
            if (lastSavedRef.current === attempted) lastSavedRef.current = previous;
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

    // 最初に戻した下書きの後始末と、別の局面へ移るとき（作り直されるとき）の保存。
    // biome-ignore lint/correctness/useExhaustiveDependencies: マウント時と、アンマウント時にだけ行う
    useEffect(() => {
        if (restore.redundant) {
            // 保存済みと同じ下書きは、消すだけ（あとで別の内容が保存されたときに、上書きしない）。
            callbacksRef.current.onDraftChange?.({ type: "clear", savedText: value });
        } else if (restore.adopted !== null) {
            reportDraft();
        }
        return () => saveRef.current();
    }, []);

    const applyPendingRestore = (): void => {
        if (pendingRestore === null) return;
        draftRef.current = pendingRestore;
        setDraft(pendingRestore);
        setPendingRestore(null);
        reportDraft();
    };
    const discardPendingRestore = (): void => {
        setPendingRestore(null);
        callbacksRef.current.onDraftChange?.({ type: "clear", savedText: null });
    };

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
            {pendingRestore !== null && (
                <fieldset
                    aria-label="以前の書きかけ"
                    className="flex min-w-0 flex-col gap-1.5 rounded-md border border-status-warning-border bg-status-warning-bg px-2 py-2 text-xs text-status-warning"
                >
                    <p>
                        以前の書きかけがあります。そのあとにコメントが変わっているため、自動では保存していません。
                    </p>
                    <p className="line-clamp-3 whitespace-pre-wrap rounded border border-status-warning-border bg-background px-2 py-1 text-foreground">
                        {pendingRestore}
                    </p>
                    <div className="flex flex-wrap gap-2">
                        <button
                            type="button"
                            onClick={applyPendingRestore}
                            disabled={disabled}
                            className="min-h-10 rounded-md border border-current px-3 font-medium transition-colors hover:bg-background/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 md:min-h-8"
                        >
                            書きかけを使う
                        </button>
                        <button
                            type="button"
                            onClick={discardPendingRestore}
                            disabled={disabled}
                            className="min-h-10 rounded-md px-3 underline underline-offset-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 md:min-h-8"
                        >
                            捨てる
                        </button>
                    </div>
                </fieldset>
            )}
            <label className="flex flex-col gap-1 text-xs text-muted-foreground">
                コメント
                <textarea
                    value={draft}
                    onChange={(event) => {
                        draftRef.current = event.target.value;
                        setDraft(event.target.value);
                        reportDraft();
                    }}
                    onFocus={() => {
                        focusedRef.current = true;
                    }}
                    onBlur={() => {
                        focusedRef.current = false;
                        save();
                    }}
                    rows={2}
                    // 以前の書きかけをどうするか選ぶまでは、入力を始めない（書きかけを上書きしない）。
                    readOnly={pendingRestore !== null}
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
