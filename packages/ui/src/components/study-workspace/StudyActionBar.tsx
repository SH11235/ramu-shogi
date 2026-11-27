/**
 * PC・タブレットの盤の下に置く、棋譜と、いまの局面の操作。
 *
 * 何を扱う操作かで 2 つにまとめ、まとまりの見出しに対象の名前を書く（ボタンは「コピー」「保存」と
 * 短くする）。盤の幅が足りないときは、まとまりごとに 2 段に折り返す。
 */

import { cn } from "@shogi/design-system";
import type { ReactElement, ReactNode } from "react";
import { useEffect, useRef, useState } from "react";
import { useLocalStorage } from "../shogi-match/hooks/useLocalStorage";
import { CopyIcon, DownloadIcon, PlayIcon } from "./StudyIcons";
import type { StudyKifuFormat } from "./studyFile";

const KIFU_FORMAT_STORAGE_KEY = "shogi:studyKifuFormat";
const COPIED_LABEL_MS = 2000;

const BUTTON_CLASS =
    "inline-flex h-8 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-md border border-wafuu-border bg-background px-2.5 text-sm text-wafuu-sumi transition-colors hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-40";

/** 押したボタンの文字を、しばらく「コピーしました」に変える。 */
function useCopiedFlash(): { copied: boolean; flash: () => void } {
    const [copied, setCopied] = useState(false);
    const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
    useEffect(
        () => () => {
            if (timer.current !== null) clearTimeout(timer.current);
        },
        [],
    );
    const flash = (): void => {
        if (timer.current !== null) clearTimeout(timer.current);
        setCopied(true);
        timer.current = setTimeout(() => {
            timer.current = null;
            setCopied(false);
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
    hint,
    onCopy,
}: {
    /** 読み上げ用の、何をコピーするか（「棋譜をコピー（KIF）」など）。 */
    label: string;
    hint?: string;
    onCopy: () => Promise<boolean>;
}): ReactElement {
    const { copied, flash } = useCopiedFlash();
    return (
        <button
            type="button"
            aria-label={copied ? `${label}しました` : label}
            className={BUTTON_CLASS}
            onClick={() => {
                void onCopy().then((ok) => {
                    if (ok) flash();
                });
            }}
        >
            <CopyIcon />
            <span aria-live="polite">{copied ? "コピーしました" : "コピー"}</span>
            {!copied && hint && <span className="text-xs text-muted-foreground">{hint}</span>}
        </button>
    );
}

function Group({
    heading,
    note,
    children,
}: {
    heading: string;
    note?: string;
    children: ReactNode;
}): ReactElement {
    return (
        <fieldset className="m-0 flex min-w-0 flex-col border-0 p-0">
            <legend className="mb-0.5 p-0 text-xs leading-4 text-muted-foreground">
                {heading}
                {note && <span className="block text-status-warning">{note}</span>}
            </legend>
            <div className="flex flex-wrap items-center gap-1.5">{children}</div>
        </fieldset>
    );
}

export function StudyActionBar({
    positionTitle,
    onCopyKifu,
    onSaveKifu,
    csaUnavailableReason,
    onCopySfen,
    onPlayFromPosition,
    onPass,
}: {
    /** いまの局面の手数と指し手（「23手目 ☗2六歩(27)」）。 */
    positionTitle: string;
    /** 書き出した棋譜を写す。写せたら true。 */
    onCopyKifu: (format: StudyKifuFormat) => Promise<boolean>;
    /** 渡さなければ「保存」を出さない（保存できない環境）。 */
    onSaveKifu?: (format: StudyKifuFormat) => void;
    /** CSA で書き出せない理由。あれば CSA を選べなくし、見出しの下に添える。 */
    csaUnavailableReason?: string;
    onCopySfen: () => Promise<boolean>;
    onPlayFromPosition?: () => void;
    /** 渡さなければ出さない（編集できないとき）。 */
    onPass?: () => void;
}): ReactElement {
    const [storedFormat, setFormat] = useStudyKifuFormat();
    // 選んだ形式は書き換えずに覚えておき、CSA にできる手順へ戻ったら CSA に戻す。
    const format: StudyKifuFormat = csaUnavailableReason !== undefined ? "kif" : storedFormat;
    const formatLabel = format.toUpperCase();
    return (
        <div className="flex w-full flex-wrap items-start justify-center gap-x-4 gap-y-1 border-t border-border pt-1">
            <Group heading="棋譜（表示中の手順・評価値とコメントつき）" note={csaUnavailableReason}>
                <fieldset className="m-0 inline-flex h-8 overflow-hidden rounded-md border border-wafuu-border p-0">
                    <legend className="sr-only">書き出す形式</legend>
                    {(["kif", "csa"] as const).map((option) => {
                        const disabled = option === "csa" && csaUnavailableReason !== undefined;
                        return (
                            <label
                                key={option}
                                title={disabled ? csaUnavailableReason : undefined}
                                className={cn(
                                    "flex min-w-11 cursor-pointer items-center justify-center border-r border-wafuu-border px-2.5 text-xs font-medium text-wafuu-sumi-light transition-colors last:border-r-0 hover:bg-muted/60 has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-inset has-[:focus-visible]:ring-ring",
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
                    onCopy={() => onCopyKifu(format)}
                />
                {onSaveKifu && (
                    <button
                        type="button"
                        aria-label={`棋譜をファイルに保存（${formatLabel}）`}
                        className={BUTTON_CLASS}
                        onClick={() => onSaveKifu(format)}
                    >
                        <DownloadIcon />
                        保存
                    </button>
                )}
            </Group>
            <div aria-hidden="true" className="w-px self-stretch bg-border" />
            <Group heading={`いまの局面（${positionTitle}）`}>
                <CopyButton label="局面をコピー（SFEN）" hint="SFEN" onCopy={onCopySfen} />
                {onPlayFromPosition && (
                    <button type="button" className={BUTTON_CLASS} onClick={onPlayFromPosition}>
                        <PlayIcon />
                        ここから対局
                    </button>
                )}
                {onPass && (
                    <button
                        type="button"
                        title="変則ルール「パス権」の棋譜の研究用"
                        className={BUTTON_CLASS}
                        onClick={onPass}
                    >
                        パスを指す
                    </button>
                )}
            </Group>
        </div>
    );
}
