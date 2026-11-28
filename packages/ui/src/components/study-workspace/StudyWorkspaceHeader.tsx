import { STUDY_LIMITS } from "@shogi/app-core";
import { cn } from "@shogi/design-system";
import type { ReactElement, ReactNode } from "react";
import { useState } from "react";
import { PlusIcon, SettingsIcon, ShareIcon } from "./StudyIcons";

const HEADER_BUTTON_CLASS =
    "flex h-10 shrink-0 items-center gap-2 rounded-md border border-border bg-background px-3 text-sm text-wafuu-sumi transition-colors hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-40";

function TitleInput({
    title,
    onCommit,
    disabled,
}: {
    title: string;
    onCommit: (title: string) => void;
    disabled: boolean;
}): ReactElement {
    const [draft, setDraft] = useState(title);
    const commit = (): void => {
        const next = Array.from(draft.trim()).slice(0, STUDY_LIMITS.titleLength).join("");
        if (next === "") {
            setDraft(title);
            return;
        }
        setDraft(next);
        if (next !== title) onCommit(next);
    };
    return (
        <input
            type="text"
            aria-label="研究ノートの表題"
            title="クリックして表題を編集"
            value={draft}
            readOnly={disabled}
            onChange={(event) => setDraft(event.target.value)}
            onBlur={() => {
                // 編集できない間は、保存を試みない（入力は元に戻す）。
                if (disabled) setDraft(title);
                else commit();
            }}
            onKeyDown={(event) => {
                if (event.key === "Enter") {
                    event.currentTarget.blur();
                } else if (event.key === "Escape") {
                    setDraft(title);
                    event.currentTarget.blur();
                }
            }}
            className="min-w-0 flex-1 truncate rounded-md border border-transparent bg-transparent px-1.5 py-0.5 font-display text-lg font-bold text-wafuu-sumi transition-colors hover:border-border focus:border-border focus:bg-background focus:outline-none focus:ring-2 focus:ring-ring md:text-xl"
        />
    );
}

/** PC・タブレットの表題の行（表題・共有・解析の設定）と、出典・保存先の行。 */
export function StudyWorkspaceHeader({
    title,
    locked,
    readOnly,
    layerPicker,
    onCommitTitle,
    onOpenShare,
    onOpenNewNote,
    settingsLabel,
    onOpenSettings,
    metaRow,
}: {
    title: string;
    locked: boolean;
    readOnly: boolean;
    layerPicker?: ReactNode;
    onCommitTitle: (title: string) => void;
    /** 公開設定・共有リンクを開く。渡さなければ出さない（閲覧のみのノートなど）。 */
    onOpenShare?: () => void;
    /** 「新しいノート」のモーダルを開く。渡さなければ出さない。 */
    onOpenNewNote?: () => void;
    settingsLabel: string;
    onOpenSettings: () => void;
    metaRow: ReactNode;
}): ReactElement {
    return (
        <header className="flex flex-col gap-1">
            <div className="flex items-center gap-2">
                {readOnly ? (
                    <h1 className="min-w-0 flex-1 truncate font-display text-lg font-bold text-wafuu-sumi md:text-xl">
                        {title}
                    </h1>
                ) : (
                    <TitleInput
                        key={title}
                        title={title}
                        disabled={locked}
                        onCommit={onCommitTitle}
                    />
                )}
                {onOpenNewNote && (
                    <button
                        type="button"
                        onClick={onOpenNewNote}
                        aria-haspopup="dialog"
                        className={HEADER_BUTTON_CLASS}
                    >
                        <PlusIcon />
                        新しいノート
                    </button>
                )}
                {onOpenShare && (
                    <button
                        type="button"
                        onClick={onOpenShare}
                        aria-haspopup="dialog"
                        className={HEADER_BUTTON_CLASS}
                    >
                        <ShareIcon />
                        共有
                    </button>
                )}
                {/* 解析に使う AI と 1 局面の時間は結果を大きく左右するので、アイコンだけにせず
                    いまの値を見せ、押せば変えられるようにする。 */}
                {readOnly ? (
                    layerPicker
                ) : (
                    <button
                        type="button"
                        onClick={onOpenSettings}
                        aria-haspopup="dialog"
                        disabled={locked}
                        className={cn(HEADER_BUTTON_CLASS, "max-w-[45%]")}
                    >
                        <SettingsIcon />
                        <span className="text-xs text-muted-foreground">解析の設定</span>
                        <span className="truncate font-medium">{settingsLabel}</span>
                    </button>
                )}
            </div>
            {/* 出典・保存先は表題の下の行に置く（表題の行は、表題と解析の設定で使う）。 */}
            {metaRow}
        </header>
    );
}
