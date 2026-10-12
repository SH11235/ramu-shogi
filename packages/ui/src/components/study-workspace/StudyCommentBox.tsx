/**
 * いま見ている手のコメント。入力が止まったら自動で保存する。
 *
 * コメントには上限（UTF-8 で 4 KiB）がある。黙って切らず、上限に近づいたら残りを出し、
 * 超えたら保存を止めてその場で知らせる（入力した内容は残す）。上限を超えたまま別の手へ移っても、
 * 入力は呼び出し側が手ごとに持っておき、その手へ戻ると `initialDraft` で戻る。
 *
 * まだ保存できていない入力（書きかけ）は `onDraftChange` で呼び出し側に知らせる。保存できない間
 * （セッションが切れた、など）も入力を失わないよう、呼び出し側が別の場所に残せるようにするため。
 *
 * 書きかけの通知は「どの入力についてのものか」を持つ:
 * - 置く（`set`）: 入力の内容と、その入力を書き始めたときの保存済みコメント（`base`）。
 * - 消す（`clear`）: 保存できた内容（`savedText`）。呼び出し側は、持っている書きかけがその内容と
 *   同じときだけ消す（この欄が作り直されたあとに届いた古い保存の完了が、新しい書きかけを
 *   消さないように）。`savedText` が null なら、内容に関わらず消す（利用者が捨てた）。
 *
 * 書きかけと、保存済みのコメントの変更（別の画面・別の端末での保存）がぶつかったときの規則は
 * 1 つだけ: **書きかけがある手で、保存済みのコメントが、書きかけを書き始めたときの内容
 * （`base`）から変わっていたら、書きかけを捨てず、黙って保存もせず、利用者に選んでもらう。**
 * フォーカスの有無、上限を超えているか、開き直して戻した書きかけか、は問わない。例外は、
 * 書きかけの内容が新しい保存済みコメントと同じ場合だけ（書きかけを消す）。
 *
 * - 書きかけは入力欄に残す（入力中なら、打鍵を妨げない）。保存済みのコメントは帯に出す。
 * - 利用者が「書きかけを使う」（保存済みのコメントを書きかけで置き換える）か「捨てる」を選ぶまで、
 *   自動では保存しない。
 * - 保存済みのコメントが最新か分からない間（`baseConfirmed` が false。ノートを開いた直後で、
 *   サーバーの最新の内容をまだ取り込めていない）も、自動では保存しない。最新の内容を取り込めた
 *   時点で、上の規則で決める。取り込めないままのときは、利用者が明示的に保存を選べる。
 */

import { STUDY_LIMITS } from "@shogi/app-core";
import { cn } from "@shogi/design-system";
import type { ReactElement } from "react";
import { useEffect, useRef, useState } from "react";

/** 書きかけの変化（呼び出し側が、手ごとの書きかけの置き場所に反映する）。 */
export type StudyCommentDraftChange =
    | {
          type: "set";
          text: string;
          /** この入力を書き始めたときの、保存済みのコメント（分からなければ null）。 */
          base: string | null;
      }
    | {
          type: "clear";
          /**
           * 保存できた内容。持っている書きかけがこの内容と同じときだけ消す。
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
     * 最初に戻す書きかけ（保存できないまま残っていた入力）。`base` は、その書きかけを書き始めた
     * ときの保存済みのコメント（分からなければ省略。その場合は、利用者に選んでもらう）。
     * `fromStorage` は、ノートを開いたときに戻した（前回までの）書きかけか。
     */
    initialDraft?: { text: string; base?: string | null; fromStorage?: boolean };
    /** 書きかけが変わった。 */
    onDraftChange?: (change: StudyCommentDraftChange) => void;
    /**
     * 書きかけが、保存済みのコメントの変更とぶつかって、利用者の選択を待っているかが変わった
     * （棋譜に印を付けるのに使う）。
     */
    onConflictChange?: (conflicted: boolean) => void;
    /** 保存できない状態（入力は残すが、保存はしない）。 */
    disabled?: boolean;
    /**
     * `value`（保存済みのコメント）が最新だと確かめられているか。false の間（ノートを開いた直後で、
     * サーバーの最新の内容をまだ取り込めていない）は、書きかけを自動では保存しない。省略時は true。
     */
    baseConfirmed?: boolean;
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

/** 書きかけと保存済みのコメントがぶつかった理由（帯の文言を変える）。 */
type Conflict =
    /** 開き直して戻した書きかけ。そのあとにコメントが変わっていた。 */
    | "restored"
    /** 書いている間・書きかけを置いている間に、別の画面で変更された。 */
    | "changed";

const CONFLICT_TEXT: Record<Conflict, string> = {
    restored:
        "以前の書きかけがあります。そのあとにコメントが変わっているため、自動では保存していません。",
    changed:
        "このコメントは別の画面で変更されました。書きかけがあります（自動では保存していません）。",
};

/**
 * コメント欄。別の局面へ移るときは `key` を変えて作り直すこと（書きかけは、そのとき保存する）。
 */
export function StudyCommentBox({
    value,
    onChange,
    initialDraft,
    onDraftChange,
    onConflictChange,
    disabled = false,
    baseConfirmed = true,
    className,
}: StudyCommentBoxProps): ReactElement {
    // 戻す書きかけ（保存済みのコメントと同じなら、戻さずに消すだけ）。最初に 1 回だけ決める。
    const [restored] = useState<{ text: string; base: string | null } | null>(() =>
        initialDraft && initialDraft.text !== value
            ? { text: initialDraft.text, base: initialDraft.base ?? null }
            : null,
    );
    const [draft, setDraft] = useState(restored?.text ?? value);
    const lastSavedRef = useRef(value);
    const draftRef = useRef(restored?.text ?? value);
    /**
     * いまの入力を書き始めたときの、保存済みのコメント（分からなければ null）。
     * 保存済みのコメントがここから変わっていたら、利用者の選択なしには保存しない。
     */
    const baseRef = useRef<string | null>(restored ? restored.base : value);
    /** 利用者が、いまの保存済みのコメントを書きかけで置き換えることを選んだ。 */
    const forcedRef = useRef(false);
    /** いまの入力が、開き直して戻した書きかけのままか（帯の文言を選ぶのに使う）。 */
    const untouchedRestoreRef = useRef(restored !== null && initialDraft?.fromStorage === true);
    const baseConfirmedRef = useRef(baseConfirmed);
    baseConfirmedRef.current = baseConfirmed;
    const disabledRef = useRef(disabled);
    disabledRef.current = disabled;
    const callbacksRef = useRef({ onChange, onDraftChange, onConflictChange });
    useEffect(() => {
        callbacksRef.current = { onChange, onDraftChange, onConflictChange };
    }, [onChange, onDraftChange, onConflictChange]);

    /** 書きかけが、保存済みのコメントの変更とぶつかっているか。 */
    const isConflicted = (): boolean =>
        draftRef.current !== lastSavedRef.current &&
        !forcedRef.current &&
        baseRef.current !== lastSavedRef.current;

    // 利用者の選択を待っている、ぶつかった書きかけ（帯を出す）。
    const [conflict, setConflict] = useState<Conflict | null>(() =>
        baseConfirmed && restored !== null && restored.base !== value
            ? untouchedRestoreRef.current
                ? "restored"
                : "changed"
            : null,
    );
    // 保存済みのコメントが最新か確かめている間、保存を保留している書きかけがあるか。
    const [isHeld, setIsHeld] = useState(false);

    /** ぶつかっているかを確かめ直し、帯の表示に反映する（最新か分からない間は、まだ決めない）。 */
    const syncConflict = (): void => {
        if (!baseConfirmedRef.current) return;
        if (!isConflicted()) {
            setConflict(null);
            return;
        }
        setConflict((current) => current ?? (untouchedRestoreRef.current ? "restored" : "changed"));
    };

    /** いまの入力を、書きかけとして知らせる（保存済みと同じなら、書きかけは要らない）。 */
    const reportDraft = (): void => {
        const text = draftRef.current;
        callbacksRef.current.onDraftChange?.(
            text === lastSavedRef.current
                ? { type: "clear", savedText: text }
                : { type: "set", text, base: baseRef.current },
        );
    };

    // 保存済みのコメントが変わった（別の画面・別の端末での保存の取り込み）。
    // biome-ignore lint/correctness/useExhaustiveDependencies: 保存済みのコメントが変わったときにだけ確かめる
    useEffect(() => {
        if (value === lastSavedRef.current) return;
        const isDirty = draftRef.current !== lastSavedRef.current;
        lastSavedRef.current = value;
        if (!isDirty) {
            // 書きかけは無い。取り込んだ内容をそのまま出す。
            draftRef.current = value;
            baseRef.current = value;
            setDraft(value);
            return;
        }
        if (draftRef.current === value) {
            // 書きかけと同じ内容が保存された。書きかけは要らない。
            baseRef.current = value;
            forcedRef.current = false;
            setConflict(null);
            setIsHeld(false);
            callbacksRef.current.onDraftChange?.({ type: "clear", savedText: value });
            return;
        }
        // 書きかけがあり、保存済みのコメントが別の内容に変わった。書きかけは入力欄に残したまま
        // （入力中の打鍵を妨げない）、利用者の選択を待つ。前に「書きかけを使う」を選んでいても、
        // そのあとにまた変わったのなら、選び直してもらう。
        forcedRef.current = false;
        syncConflict();
    }, [value]);

    const save = (): void => {
        if (disabledRef.current) return;
        if (draftRef.current === lastSavedRef.current) return;
        // 上限を超えている間は保存しない（入力は残し、下の案内で知らせる）。
        if (isStudyCommentOverLimit(draftRef.current)) return;
        if (!forcedRef.current) {
            // 保存済みのコメントが最新か分からない間は、保存しない（他の端末のコメントを、
            // 確かめずに上書きしないため）。書きかけは置いたままなので、入力は失われない。
            if (!baseConfirmedRef.current) return;
            // 書き始めたあとに保存済みのコメントが変わっていたら、利用者が選ぶまで保存しない。
            if (isConflicted()) {
                syncConflict();
                return;
            }
        }
        const previous = lastSavedRef.current;
        const previousBase = baseRef.current;
        const attempted = draftRef.current;
        lastSavedRef.current = attempted;
        baseRef.current = attempted;
        forcedRef.current = false;
        untouchedRestoreRef.current = false;
        const outcome = callbacksRef.current.onChange(attempted);
        const reportSaved = (): void =>
            callbacksRef.current.onDraftChange?.({ type: "clear", savedText: attempted });
        if (!(outcome instanceof Promise)) {
            reportSaved();
            return;
        }
        void outcome.then((saved) => {
            if (saved) {
                // 保存できた内容を添えて知らせる（この間に書かれた新しい書きかけは、消されない）。
                reportSaved();
                return;
            }
            // 保存できなかったら、まだ保存していない入力として扱い直す。書きかけは置いたままなので、
            // 置き直さない（この間に書かれた新しい書きかけを、古い内容で上書きしない）。
            if (lastSavedRef.current === attempted) {
                lastSavedRef.current = previous;
                baseRef.current = previousBase;
            }
        });
    };
    const saveRef = useRef(save);
    saveRef.current = save;

    // 保存済みのコメントが最新だと確かめられた時点で、持っていた書きかけをどうするか決める
    // （書き始めたときのコメントのままなら保存に進み、変わっていたら利用者に選んでもらう）。
    // biome-ignore lint/correctness/useExhaustiveDependencies: 最新かどうかが変わったときにだけ確かめる
    useEffect(() => {
        if (!baseConfirmed) {
            setIsHeld(draftRef.current !== lastSavedRef.current && !forcedRef.current);
            return;
        }
        setIsHeld(false);
        syncConflict();
    }, [baseConfirmed]);

    // 入力が止まったら保存する。保存できない状態が解けたとき・保存済みのコメントが最新だと
    // 確かめられたときも、残っていた入力を保存する（ぶつかっていれば、保存せずに帯を出す）。
    // biome-ignore lint/correctness/useExhaustiveDependencies: disabled・baseConfirmed が変わったときにも保存を試みる
    useEffect(() => {
        if (draft === lastSavedRef.current) return;
        const timer = setTimeout(() => saveRef.current(), COMMENT_SAVE_DELAY_MS);
        return () => clearTimeout(timer);
    }, [draft, disabled, baseConfirmed]);

    // 最初に戻した書きかけの後始末と、別の局面へ移るとき（作り直されるとき）の保存。
    //
    // 開発時（React の StrictMode）は、マウントの直後にこの後始末が 1 回余分に走るので、戻した
    // 書きかけが（保存してよい状態なら）700 ms を待たずにすぐ保存される。本番では走らない。
    // 保存してよいかの判定（最新か・ぶつかっていないか）は `save` の中にあるので、どちらでも
    // 保存される内容と条件は同じ。
    // biome-ignore lint/correctness/useExhaustiveDependencies: マウント時と、アンマウント時にだけ行う
    useEffect(() => {
        if (initialDraft && restored === null) {
            // 保存済みと同じ書きかけは、消すだけ（あとで別の内容が保存されたときに、上書きしない）。
            callbacksRef.current.onDraftChange?.({ type: "clear", savedText: value });
        }
        return () => saveRef.current();
    }, []);

    // 選択を待っているかを、呼び出し側に知らせる（棋譜に印を付ける）。
    const isWaitingForChoice = conflict !== null;
    useEffect(() => {
        callbacksRef.current.onConflictChange?.(isWaitingForChoice);
    }, [isWaitingForChoice]);

    /** 書きかけを使う: いまの保存済みのコメントを、書きかけで置き換える。 */
    const keepDraft = (): void => {
        forcedRef.current = true;
        baseRef.current = lastSavedRef.current;
        setConflict(null);
        setIsHeld(false);
        reportDraft();
        save();
    };
    /** 書きかけを捨てる: 保存済みのコメントに戻す。 */
    const discardDraft = (): void => {
        draftRef.current = lastSavedRef.current;
        baseRef.current = lastSavedRef.current;
        forcedRef.current = false;
        untouchedRestoreRef.current = false;
        setDraft(lastSavedRef.current);
        setConflict(null);
        setIsHeld(false);
        callbacksRef.current.onDraftChange?.({ type: "clear", savedText: null });
    };

    const remaining = STUDY_LIMITS.commentBytes - utf8Length(draft);
    const isOver = remaining < 0;
    // かな・漢字は 1 文字 3 バイトなので、目安の文字数はバイト数の 1/3。
    const approxChars = Math.ceil(Math.abs(remaining) / 3);
    const choiceButtonClass =
        "min-h-10 rounded-md px-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 md:min-h-8";

    return (
        <section
            aria-label="コメント"
            className={cn(
                "flex flex-col gap-1 rounded-xl border border-wafuu-border bg-card p-3 shadow-sm",
                className,
            )}
        >
            {conflict !== null && (
                <fieldset
                    aria-label="書きかけの扱い"
                    className="flex min-w-0 flex-col gap-1.5 rounded-md border border-status-warning-border bg-status-warning-bg px-2 py-2 text-xs text-status-warning"
                >
                    <p>{CONFLICT_TEXT[conflict]}</p>
                    <div className="flex flex-col gap-0.5">
                        <span>保存されているコメント</span>
                        <p className="max-h-24 overflow-y-auto whitespace-pre-wrap rounded border border-status-warning-border bg-background px-2 py-1 text-foreground">
                            {value === "" ? "（コメントなし）" : value}
                        </p>
                    </div>
                    <p>書きかけは、下の入力欄に残っています。</p>
                    <div className="flex flex-wrap gap-2">
                        <button
                            type="button"
                            onClick={keepDraft}
                            disabled={disabled || isOver}
                            className={cn(
                                choiceButtonClass,
                                "border border-current font-medium transition-colors hover:bg-background/60",
                            )}
                        >
                            書きかけを使う
                        </button>
                        <button
                            type="button"
                            onClick={discardDraft}
                            disabled={disabled}
                            className={cn(choiceButtonClass, "underline underline-offset-2")}
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
                        // 保存済みの内容から書き始めるとき、その内容を覚える。
                        if (draftRef.current === lastSavedRef.current) {
                            baseRef.current = lastSavedRef.current;
                            forcedRef.current = false;
                        }
                        untouchedRestoreRef.current = false;
                        draftRef.current = event.target.value;
                        setDraft(event.target.value);
                        if (!baseConfirmedRef.current) {
                            setIsHeld(
                                event.target.value !== lastSavedRef.current && !forcedRef.current,
                            );
                        }
                        // 保存済みの内容に書き戻したら、ぶつかりは無くなる。
                        if (event.target.value === lastSavedRef.current) setConflict(null);
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
            {isHeld && conflict === null && !isOver && (
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
                    <p className="min-w-0 flex-1">
                        最新のコメントを確認しています。確認できるまで、この書きかけは自動では保存しません。
                    </p>
                    <button
                        type="button"
                        onClick={keepDraft}
                        disabled={disabled}
                        className={cn(
                            choiceButtonClass,
                            "shrink-0 border border-input bg-background font-medium text-wafuu-sumi transition-colors hover:bg-muted/60",
                        )}
                    >
                        書きかけを使う
                    </button>
                </div>
            )}
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
