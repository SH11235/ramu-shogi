/**
 * スマートフォンの「メニュー」。盤の下に操作を並べる場所が無いので、書き出し・この局面での操作・
 * ノートの操作を、下から出す一覧にまとめる。
 */

import type { ReactElement, ReactNode } from "react";
import { useRef, useState } from "react";
import { BottomSheet } from "../shogi-match/components/BottomSheet";
import { MenuIcon } from "./StudyIcons";
import type { StudyKifuFormat } from "./studyFile";

interface StudyMobileMenuProps {
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
    /** いまの局面でパスを指す。渡さなければ項目を出さない（編集できないとき）。 */
    onPass?: () => void;
    /** 開いているかどうかを知らせる（開いている間、画面側は矢印キーでの局面の移動を止める）。 */
    onOpenChange?: (open: boolean) => void;
    /** 一覧の上に出す、ノートの情報（出典・保存先など）。 */
    info?: ReactNode;
    /** 「メニュー」のボタンの id（メニューから開いたダイアログを閉じたとき、フォーカスを戻す先）。 */
    triggerId?: string;
    /** 見出し「ノート」に並べる項目（共有・表題の変更・解析の設定・盤の反転など）。 */
    noteItems?: Array<{ label: string; note?: string; run: () => void }>;
}

const ITEM_CLASS =
    "flex min-h-11 w-full items-center justify-between gap-2 rounded-md px-3 text-left text-sm text-wafuu-sumi transition-colors hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";
const FORMAT_BUTTON_CLASS =
    "h-9 min-w-12 rounded-md border border-border bg-card px-2 text-xs font-medium text-wafuu-sumi transition-colors hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-card";
const HEADING_CLASS = "px-3 pb-0.5 pt-2 text-xs font-normal text-muted-foreground";

export function StudyMobileMenu({
    onCopyKifu,
    onSaveKifu,
    csaUnavailableReason,
    onCopySfen,
    onPlayFromPosition,
    onPass,
    onOpenChange,
    info,
    noteItems = [],
    triggerId,
}: StudyMobileMenuProps): ReactElement {
    const [open, setOpenState] = useState(false);
    // BottomSheet は開いたときに中へフォーカスを移さないので、描いたあとで最初の項目へ移す
    // （閉じたときは、Radix が「メニュー」へ戻す）。
    // 中身の更新で描き直しても、開いたときの 1 回だけにする。
    const focusOnMount = useRef(false);
    const focusFirstItem = (list: HTMLDivElement | null): void => {
        if (!list || !focusOnMount.current) return;
        focusOnMount.current = false;
        setTimeout(
            () => list.querySelector<HTMLButtonElement>("button:not(:disabled)")?.focus(),
            0,
        );
    };
    const setOpen = (next: boolean): void => {
        focusOnMount.current = next;
        setOpenState(next);
        onOpenChange?.(next);
    };
    const run = (fn: () => void) => () => {
        setOpen(false);
        fn();
    };
    const formatRow = (label: string, action: (format: StudyKifuFormat) => void): ReactElement => (
        <div className="flex min-h-11 items-center gap-1.5 px-3">
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
        <BottomSheet
            open={open}
            onOpenChange={setOpen}
            title="メニュー"
            height="auto"
            trigger={
                <button
                    id={triggerId}
                    type="button"
                    className="inline-flex h-10 shrink-0 items-center gap-1.5 rounded-md border border-border bg-background px-2.5 text-sm text-wafuu-sumi transition-colors hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                    <MenuIcon />
                    メニュー
                </button>
            }
        >
            <div ref={focusFirstItem} className="-mx-1 flex flex-col">
                {info && <div className="mb-1 border-b border-border px-1 pb-2">{info}</div>}
                <h3 className={HEADING_CLASS}>書き出す（表示中の手順・評価値とコメントつき）</h3>
                {formatRow("棋譜をコピー", onCopyKifu)}
                {onSaveKifu && formatRow("棋譜をファイルに保存", onSaveKifu)}
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
                        <h3 className={HEADING_CLASS}>この局面で</h3>
                        {onPlayFromPosition && (
                            <button
                                type="button"
                                className={ITEM_CLASS}
                                onClick={run(onPlayFromPosition)}
                            >
                                ここから対局…
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
                {noteItems.length > 0 && (
                    <>
                        <h3 className={HEADING_CLASS}>ノート</h3>
                        {noteItems.map((item) => (
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
            </div>
        </BottomSheet>
    );
}
