/**
 * PC・タブレットの盤の下に置く操作の行。
 *
 * 書き出す操作（棋譜・局面のコピー、ファイルに保存）を枠だけのボタンで左にまとめ、性質の違う
 * 「ここから対局」「パスを指す」は淡い地のボタンで右に離して置く。ボタンの名前に対象を入れて
 * 見出しを置かず、行の高さを 1 段のボタンの高さに抑える。
 */

import { cn } from "@shogi/design-system";
import type { ReactElement } from "react";
import { useEffect, useRef, useState } from "react";
import { Button } from "../button";
import { useLocalStorage } from "../shogi-match/hooks/useLocalStorage";
import { CheckIcon, CopyIcon, DownloadIcon, PlayIcon } from "./StudyIcons";
import type { StudyKifuFormat } from "./studyFile";

const KIFU_FORMAT_STORAGE_KEY = "shogi:studyKifuFormat";
const COPIED_LABEL_MS = 2000;
const COPIED_LABEL = "コピーしました";

// 共通の Button（outline / secondary）を、盤の下の 1 段の高さと文字の太さに合わせる。
const BUTTON_CLASS = "h-8 shrink-0 gap-1.5 px-2 font-normal shadow-none";

function useCopiedFlash(): { copied: string | null; flash: (label: string) => void } {
    const [copied, setCopied] = useState<string | null>(null);
    const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
    useEffect(
        () => () => {
            if (timer.current !== null) clearTimeout(timer.current);
        },
        [],
    );
    const flash = (label: string): void => {
        if (timer.current !== null) clearTimeout(timer.current);
        setCopied(label);
        timer.current = setTimeout(() => {
            timer.current = null;
            setCopied(null);
        }, COPIED_LABEL_MS);
    };
    return { copied, flash };
}

/** 最後に選んだ書き出しの形式（ノートをまたいで覚える）。 */
function useStudyKifuFormat(): [StudyKifuFormat, (format: StudyKifuFormat) => void] {
    const [stored, setStored] = useLocalStorage<StudyKifuFormat>(KIFU_FORMAT_STORAGE_KEY, "kif");
    return [stored === "csa" ? "csa" : "kif", setStored];
}

function CopyButton({
    label,
    text,
    copyKey,
    hint,
    onCopy,
}: {
    /** 読み上げ用の、何をコピーするか（「棋譜をコピー（KIF）」など）。 */
    label: string;
    /** ボタンに出す文字。 */
    text: string;
    /** コピーする中身の識別（形式・手順・局面）。 */
    copyKey: string;
    hint?: string;
    onCopy: () => Promise<boolean>;
}): ReactElement {
    const { copied: copiedKey, flash } = useCopiedFlash();
    // コピーしたあとに形式・局面が変わったら、コピーしていない中身を「コピーしました」と言わない。
    const copied = copiedKey === copyKey;
    return (
        <>
            <Button
                type="button"
                variant="outline"
                aria-label={label}
                className={BUTTON_CLASS}
                onClick={() => {
                    void onCopy().then((ok) => {
                        if (ok) flash(copyKey);
                    });
                }}
            >
                {/* 結果はアイコンだけで返し、文字と幅は変えない。幅が変わると行が折り返し、盤の大きさまで変わる。 */}
                {copied ? <CheckIcon className="text-status-success" /> : <CopyIcon />}
                {text}
                {hint && <span className="text-xs text-muted-foreground">{hint}</span>}
            </Button>
            <span role="status" className="sr-only">
                {copied ? COPIED_LABEL : ""}
            </span>
        </>
    );
}

export function StudyActionBar({
    positionKey,
    lineKey,
    onCopyKifu,
    onSaveKifu,
    csaUnavailableReason,
    onCopySfen,
    onPlayFromPosition,
    onPass,
}: {
    /** いまの局面の識別（ノードの ID）。 */
    positionKey: string;
    /** 表示中の手順の識別（手順の末端のノードの ID）。 */
    lineKey: string;
    /** 書き出した棋譜を写す。写せたら true。 */
    onCopyKifu: (format: StudyKifuFormat) => Promise<boolean>;
    /** 渡さなければ「ファイルに保存」を出さない（保存できない環境）。 */
    onSaveKifu?: (format: StudyKifuFormat) => void;
    /** CSA で書き出せない理由。あれば CSA を選べなくし、行の下に添える。 */
    csaUnavailableReason?: string;
    onCopySfen: () => Promise<boolean>;
    /** 確認を出してから対局の画面へ移る。 */
    onPlayFromPosition?: () => void;
    /** 渡さなければ出さない（編集できないとき）。 */
    onPass?: () => void;
}): ReactElement {
    const [storedFormat, setFormat] = useStudyKifuFormat();
    // 選んだ形式は書き換えずに覚えておき、CSA にできる手順へ戻ったら CSA に戻す。
    const format: StudyKifuFormat = csaUnavailableReason !== undefined ? "kif" : storedFormat;
    const formatLabel = format.toUpperCase();
    const hasPositionActions = onPlayFromPosition !== undefined || onPass !== undefined;
    return (
        <div className="flex w-full flex-wrap items-center justify-center gap-x-4 gap-y-1.5 border-t border-border pt-1.5">
            <div
                role="group"
                aria-label="書き出す（棋譜は表示中の手順を評価値とコメントつきで）"
                className="flex flex-wrap items-center justify-center gap-1"
            >
                <fieldset className="m-0 inline-flex h-8 overflow-hidden rounded-md border border-border p-0">
                    <legend className="sr-only">棋譜の形式</legend>
                    {(["kif", "csa"] as const).map((option) => {
                        const disabled = option === "csa" && csaUnavailableReason !== undefined;
                        return (
                            <label
                                key={option}
                                title={disabled ? csaUnavailableReason : undefined}
                                className={cn(
                                    "flex min-w-10 cursor-pointer items-center justify-center border-r border-border px-2 text-xs font-medium text-wafuu-sumi-light transition-colors last:border-r-0 hover:bg-muted/60 has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-inset has-[:focus-visible]:ring-ring",
                                    format === option &&
                                        "bg-wafuu-kin/20 font-bold text-wafuu-sumi hover:bg-wafuu-kin/20",
                                    disabled &&
                                        "cursor-not-allowed opacity-40 hover:bg-transparent",
                                )}
                            >
                                <input
                                    type="radio"
                                    name="study-kifu-format"
                                    className="sr-only"
                                    checked={format === option}
                                    disabled={disabled}
                                    onChange={() => setFormat(option)}
                                />
                                {option.toUpperCase()}
                            </label>
                        );
                    })}
                </fieldset>
                <CopyButton
                    label={`棋譜をコピー（${formatLabel}）`}
                    text="棋譜をコピー"
                    copyKey={`${format}:${lineKey}`}
                    onCopy={() => onCopyKifu(format)}
                />
                {onSaveKifu && (
                    <Button
                        type="button"
                        variant="outline"
                        aria-label={`棋譜をファイルに保存（${formatLabel}）`}
                        className={BUTTON_CLASS}
                        onClick={() => onSaveKifu(format)}
                    >
                        <DownloadIcon />
                        ファイルに保存
                    </Button>
                )}
                <CopyButton
                    label="局面をコピー（SFEN）"
                    text="局面をコピー"
                    copyKey={positionKey}
                    hint="SFEN"
                    onCopy={onCopySfen}
                />
            </div>
            {hasPositionActions && (
                <>
                    {/* 対局とパスは 1 つの塊にし、折り返すときもパスだけが次の行へ落ちないようにする。
                        区切り線は折り返すと行末に取り残されるので置かず、まとまりの間を空けて分ける。 */}
                    <div
                        role="group"
                        aria-label="この局面で"
                        className="flex shrink-0 items-center gap-1"
                    >
                        {onPlayFromPosition && (
                            <Button
                                type="button"
                                variant="secondary"
                                className={BUTTON_CLASS}
                                onClick={onPlayFromPosition}
                            >
                                <PlayIcon />
                                ここから対局…
                            </Button>
                        )}
                        {onPass && (
                            <Button
                                type="button"
                                variant="secondary"
                                title="変則ルール「パス権」の棋譜の研究用"
                                className={BUTTON_CLASS}
                                onClick={onPass}
                            >
                                パスを指す
                            </Button>
                        )}
                    </div>
                </>
            )}
            {csaUnavailableReason && (
                <p className="basis-full text-center text-xs text-status-warning">
                    {csaUnavailableReason}
                </p>
            )}
        </div>
    );
}
