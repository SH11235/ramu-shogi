/**
 * 研究ノートの「その他の操作」（書き出しと、いまの局面から対局）。
 *
 * どれも主役の操作ではないので、表題の右の 1 つのボタンにまとめる。スマートフォンの低い画面でも
 * 収まるよう、項目は 1 行にし、形式の選び分け（KIF・CSA）は同じ行のボタンで出す。
 */

import type { ReactElement, ReactNode } from "react";
import { useState } from "react";
import { Popover, PopoverContent, PopoverTrigger } from "../popover";
import { MoreIcon } from "./StudyIcons";

export type StudyKifuFormat = "kif" | "csa";

interface StudyMoreMenuProps {
    /** 表示している手順を、表示中の解析の評価値とコメントつきでコピーする。 */
    onCopyKifu: (format: StudyKifuFormat) => void;
    /** 表示している手順をファイルに保存する。渡さなければ項目を出さない（保存できない環境）。 */
    onSaveKifu?: (format: StudyKifuFormat) => void;
    /** CSA で書き出せない理由（パスを含む手順など）。あれば CSA のボタンを押せなくして添える。 */
    csaUnavailableReason?: string;
    /** いま見ている局面までの手順を SFEN でコピーする。 */
    onCopySfen: () => void;
    /** いま見ている局面を対局ページで開く。渡さなければ項目を出さない。 */
    onPlayFromPosition?: () => void;
    /**
     * いまの局面でパスを指す（変則ルール「パス権」の棋譜の研究用）。渡さなければ項目を出さない
     * （編集できないとき）。
     */
    onPass?: () => void;
    /** 開いているかどうかを知らせる（開いている間、画面側は矢印キーでの局面の移動を止める）。 */
    onOpenChange?: (open: boolean) => void;
    /**
     * 操作の上に出す、ノートの情報（出典・保存先など）。画面に常に出すほどではない情報を、
     * スマートフォンでここにまとめる。
     */
    info?: ReactNode;
    /** 末尾に足す項目（スマートフォンで画面から外した操作: 表題の変更・解析の設定・盤の反転など）。 */
    extraItems?: Array<{ label: string; note?: string; run: () => void }>;
}

const ITEM_CLASS =
    "flex h-10 w-full items-center justify-between gap-2 rounded-md px-3 text-left text-sm text-wafuu-sumi transition-colors hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";
const FORMAT_BUTTON_CLASS =
    "h-8 min-w-12 rounded-md border border-wafuu-border bg-card px-2 text-xs font-medium text-wafuu-sumi transition-colors hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-card";
const HEADING_CLASS = "px-3 pb-0.5 pt-1 text-xs text-muted-foreground";

export function StudyMoreMenu({
    onCopyKifu,
    onSaveKifu,
    csaUnavailableReason,
    onCopySfen,
    onPlayFromPosition,
    onPass,
    onOpenChange,
    info,
    extraItems = [],
}: StudyMoreMenuProps): ReactElement {
    const [open, setOpenState] = useState(false);
    const setOpen = (next: boolean): void => {
        setOpenState(next);
        onOpenChange?.(next);
    };
    const run = (fn: () => void) => () => {
        setOpen(false);
        fn();
    };
    const formatRow = (label: string, action: (format: StudyKifuFormat) => void): ReactElement => (
        <div className="flex h-10 items-center gap-1.5 px-3">
            <span className="flex-1 text-sm text-wafuu-sumi">{label}</span>
            <button
                type="button"
                aria-label={`${label}（KIF）`}
                className={FORMAT_BUTTON_CLASS}
                onClick={run(() => action("kif"))}
            >
                KIF
            </button>
            <button
                type="button"
                aria-label={`${label}（CSA）`}
                title={csaUnavailableReason}
                disabled={csaUnavailableReason !== undefined}
                className={FORMAT_BUTTON_CLASS}
                onClick={run(() => action("csa"))}
            >
                CSA
            </button>
        </div>
    );
    return (
        <Popover open={open} onOpenChange={setOpen}>
            <PopoverTrigger asChild>
                <button
                    type="button"
                    aria-label="その他の操作"
                    title="その他の操作"
                    className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-md border border-transparent text-wafuu-sumi-light transition-colors hover:bg-muted/60 hover:text-wafuu-sumi focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring data-[state=open]:border-wafuu-border data-[state=open]:bg-wafuu-kin/20"
                >
                    <MoreIcon />
                </button>
            </PopoverTrigger>
            {/* 低い画面では、画面に収まる高さまでにして中で送る（下の項目が画面の外に切れない）。 */}
            <PopoverContent
                align="end"
                collisionPadding={8}
                className="max-h-[var(--radix-popover-content-available-height)] w-72 overflow-y-auto overscroll-contain p-1.5"
                aria-label="その他の操作"
            >
                {info && (
                    <div className="mb-1.5 border-b border-border px-1.5 pb-2 pt-1">{info}</div>
                )}
                <p className={HEADING_CLASS}>棋譜（表示中の手順・評価値とコメントつき）</p>
                {formatRow("コピー", onCopyKifu)}
                {onSaveKifu && formatRow("ファイルに保存", onSaveKifu)}
                {csaUnavailableReason && (
                    <p className="px-3 pb-1 text-xs text-muted-foreground">
                        {csaUnavailableReason}
                    </p>
                )}
                <button type="button" className={ITEM_CLASS} onClick={run(onCopySfen)}>
                    局面をコピー（SFEN）
                </button>
                {(onPlayFromPosition || onPass) && (
                    <>
                        <div className="my-0.5 border-t border-border" />
                        <p className={HEADING_CLASS}>いまの局面から</p>
                        {onPlayFromPosition && (
                            <button
                                type="button"
                                className={ITEM_CLASS}
                                onClick={run(onPlayFromPosition)}
                            >
                                対局する
                            </button>
                        )}
                        {onPass && (
                            <button type="button" className={ITEM_CLASS} onClick={run(onPass)}>
                                <span>パスを指す</span>
                                <span className="text-xs text-muted-foreground">
                                    パス権の研究用
                                </span>
                            </button>
                        )}
                    </>
                )}
                {extraItems.length > 0 && (
                    <>
                        <div className="my-0.5 border-t border-border" />
                        <p className={HEADING_CLASS}>ノートと表示</p>
                        {extraItems.map((item) => (
                            <button
                                key={item.label}
                                type="button"
                                className={ITEM_CLASS}
                                onClick={run(item.run)}
                            >
                                <span>{item.label}</span>
                                {item.note && (
                                    <span className="truncate text-xs text-muted-foreground">
                                        {item.note}
                                    </span>
                                )}
                            </button>
                        ))}
                    </>
                )}
            </PopoverContent>
        </Popover>
    );
}
