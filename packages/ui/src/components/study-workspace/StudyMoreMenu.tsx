/**
 * 研究ノートの「その他の操作」（書き出しと、いまの局面から対局）。
 *
 * どれも主役の操作ではないので、表題の右の 1 つのボタンにまとめる。
 */

import type { ReactElement, ReactNode } from "react";
import { useState } from "react";
import { Popover, PopoverContent, PopoverTrigger } from "../popover";
import { MoreIcon } from "./StudyIcons";

interface StudyMoreMenuProps {
    /** 表示している手順を KIF でコピーする。 */
    onCopyKif: () => void;
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
    /**
     * 先頭に足す項目（スマートフォンで画面から外した操作: 表題の変更・解析の設定・盤の反転など）。
     */
    extraItems?: Array<{ label: string; note: string; run: () => void }>;
}

const ITEM_CLASS =
    "flex min-h-10 w-full flex-col items-start justify-center rounded-md px-3 py-1.5 text-left text-sm text-wafuu-sumi transition-colors hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

export function StudyMoreMenu({
    onCopyKif,
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
    const items: Array<{ label: string; note: string; run: () => void }> = [
        ...extraItems,
        {
            label: "棋譜をコピー（KIF）",
            note: "表示中の手順を、表示中の解析の評価値とコメントつきで",
            run: onCopyKif,
        },
        { label: "局面をコピー（SFEN）", note: "いま見ている局面までの手順", run: onCopySfen },
        ...(onPlayFromPosition
            ? [
                  {
                      label: "この局面から対局",
                      note: "いまの局面までの手順だけを、対局ページへ引き継ぎます",
                      run: onPlayFromPosition,
                  },
              ]
            : []),
        ...(onPass
            ? [
                  {
                      label: "パスを指す",
                      note: "手番だけを相手に渡します（パス権のある対局の研究用）",
                      run: onPass,
                  },
              ]
            : []),
    ];
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
            <PopoverContent align="end" className="w-72 p-1.5" aria-label="その他の操作">
                {info && (
                    <div className="mb-1.5 border-b border-border px-1.5 pb-2 pt-1">{info}</div>
                )}
                <ul className="flex flex-col gap-0.5">
                    {items.map((item) => (
                        <li key={item.label}>
                            <button
                                type="button"
                                className={ITEM_CLASS}
                                onClick={() => {
                                    setOpen(false);
                                    item.run();
                                }}
                            >
                                <span className="font-medium">{item.label}</span>
                                <span className="text-xs text-muted-foreground">{item.note}</span>
                            </button>
                        </li>
                    ))}
                </ul>
            </PopoverContent>
        </Popover>
    );
}
