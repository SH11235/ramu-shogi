import type { NnueMeta } from "@shogi/app-core";
import { cn } from "@shogi/design-system";
import type { ReactElement } from "react";
import { useId, useReducer, useRef } from "react";
import { Button } from "../button";
import { Input } from "../input";

interface NnueListItemProps {
    /** NNUE メタデータ */
    meta: NnueMeta;
    /** 選択されているか */
    isSelected?: boolean;
    /** 選択時のコールバック */
    onSelect?: () => void;
    /** 削除時のコールバック */
    onDelete?: () => void;
    /** 削除ボタンを表示するか（プリセットも削除可・再ダウンロード可能） */
    showDelete?: boolean;
    /** 削除中かどうか */
    isDeleting?: boolean;
    /** 無効化 */
    disabled?: boolean;
    /** 削除が無効な理由（対局中など） */
    deleteDisabledReason?: string;
    /** ラジオグループ名（選択機能使用時に必要） */
    name?: string;
    /** 選択機能を有効にするか（デフォルト: true） */
    selectable?: boolean;
    /** 表示名変更時のコールバック（指定時、インライン編集が有効になる） */
    onDisplayNameChange?: (newName: string) => Promise<void>;
    /** FV_SCALE変更時のコールバック（指定時、インライン編集が有効になる） */
    onFvScaleChange?: (fvScale: number | undefined) => Promise<void>;
}

// ---- インライン編集フィールド用 reducer ----

type EditFieldState = { isEditing: boolean; value: string; isSaving: boolean };
type EditFieldAction =
    | { type: "START_EDIT"; value: string }
    | { type: "CHANGE"; value: string }
    | { type: "START_SAVE" }
    | { type: "DONE_SAVE" }
    | { type: "SAVE_FAILED" }
    | { type: "CANCEL"; value: string };

function editFieldReducer(state: EditFieldState, action: EditFieldAction): EditFieldState {
    switch (action.type) {
        case "START_EDIT":
            return { isEditing: true, value: action.value, isSaving: false };
        case "CHANGE":
            return { ...state, value: action.value };
        case "START_SAVE":
            return { ...state, isSaving: true };
        case "DONE_SAVE":
            return { isEditing: false, value: state.value, isSaving: false };
        case "SAVE_FAILED":
            return { ...state, isSaving: false };
        case "CANCEL":
            return { isEditing: false, value: action.value, isSaving: false };
    }
}

function formatSize(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function getArchitectureLabel(meta: NnueMeta): string | null {
    if (!meta.format) return null;
    const raw = meta.format.architecture?.trim();
    if (!raw || raw.toLowerCase() === "unknown") return "不明";
    return raw;
}

function getValidationStatus(meta: NnueMeta): { label: string; className: string } {
    if (meta.format) {
        return {
            label: "形式確認済み",
            className: "text-status-success",
        };
    }
    return {
        label: "未確認（動作保証なし）",
        className: "text-status-warning",
    };
}

/**
 * NNUE 一覧の個々のアイテム
 */
export function NnueListItem({
    meta,
    isSelected = false,
    onSelect,
    onDelete,
    showDelete = true,
    isDeleting = false,
    disabled = false,
    deleteDisabledReason,
    name,
    selectable = true,
    onDisplayNameChange,
    onFvScaleChange,
}: NnueListItemProps): ReactElement {
    const isPreset = meta.source === "preset";
    const canDelete = showDelete && onDelete;
    const canEdit = !isPreset && onDisplayNameChange;
    const canEditFvScale = onFvScaleChange;
    const inputId = useId();
    const editInputRef = useRef<HTMLInputElement>(null);
    const fvScaleInputRef = useRef<HTMLInputElement>(null);
    const validationStatus = getValidationStatus(meta);
    const architectureLabel = getArchitectureLabel(meta);

    // 表示名編集状態
    const [displayNameEdit, dispatchDisplayName] = useReducer(editFieldReducer, {
        isEditing: false,
        value: meta.displayName,
        isSaving: false,
    });
    const { isEditing, value: editValue, isSaving } = displayNameEdit;

    // FV_SCALE編集状態
    const [fvScaleEdit, dispatchFvScale] = useReducer(editFieldReducer, {
        isEditing: false,
        value: meta.fvScale?.toString() ?? "",
        isSaving: false,
    });
    const {
        isEditing: isEditingFvScale,
        value: fvScaleValue,
        isSaving: isSavingFvScale,
    } = fvScaleEdit;

    const startEditing = () => {
        if (!canEdit || disabled) return;
        dispatchDisplayName({ type: "START_EDIT", value: meta.displayName });
        // 次のレンダリング後にフォーカス
        setTimeout(() => editInputRef.current?.select(), 0);
    };

    const cancelEditing = () => {
        dispatchDisplayName({ type: "CANCEL", value: meta.displayName });
    };

    const saveDisplayName = async () => {
        if (!onDisplayNameChange) return;
        const trimmed = editValue.trim();
        if (trimmed === "" || trimmed === meta.displayName) {
            cancelEditing();
            return;
        }
        dispatchDisplayName({ type: "START_SAVE" });
        try {
            await onDisplayNameChange(trimmed);
            dispatchDisplayName({ type: "DONE_SAVE" });
        } catch {
            // エラーは親コンポーネントで処理される（編集モードは継続）
            dispatchDisplayName({ type: "SAVE_FAILED" });
        }
    };

    const handleKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === "Enter") {
            e.preventDefault();
            void saveDisplayName();
        } else if (e.key === "Escape") {
            cancelEditing();
        }
    };

    // FV_SCALE編集関連
    const startEditingFvScale = () => {
        if (!canEditFvScale || disabled) return;
        dispatchFvScale({ type: "START_EDIT", value: meta.fvScale?.toString() ?? "" });
        setTimeout(() => fvScaleInputRef.current?.select(), 0);
    };

    const cancelEditingFvScale = () => {
        dispatchFvScale({ type: "CANCEL", value: meta.fvScale?.toString() ?? "" });
    };

    const saveFvScale = async () => {
        if (!onFvScaleChange) return;
        const trimmed = fvScaleValue.trim();
        const newValue = trimmed === "" ? undefined : Number(trimmed);
        // 値が変わっていない場合はキャンセル
        if (newValue === meta.fvScale) {
            cancelEditingFvScale();
            return;
        }
        // 無効な値の場合はキャンセル（Number.isInteger で小数点や不正入力を検出）
        if (
            newValue !== undefined &&
            (Number.isNaN(newValue) ||
                !Number.isInteger(newValue) ||
                newValue < 1 ||
                newValue > 100)
        ) {
            cancelEditingFvScale();
            return;
        }
        dispatchFvScale({ type: "START_SAVE" });
        try {
            await onFvScaleChange(newValue);
            dispatchFvScale({ type: "DONE_SAVE" });
        } catch {
            // エラーは親コンポーネントで処理される（編集モードは継続）
            dispatchFvScale({ type: "SAVE_FAILED" });
        }
    };

    const handleFvScaleKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === "Enter") {
            e.preventDefault();
            void saveFvScale();
        } else if (e.key === "Escape") {
            cancelEditingFvScale();
        }
    };

    const containerClassName = cn(
        "flex items-center gap-3 rounded-md border p-3",
        selectable && "transition-colors",
        isSelected ? "bg-accent border-primary" : "border-border",
        selectable
            ? disabled
                ? "cursor-not-allowed opacity-50"
                : "cursor-pointer"
            : disabled
              ? "cursor-default opacity-50"
              : "cursor-default",
        selectable &&
            "hover:bg-muted/50 focus-within:ring-2 focus-within:ring-ring focus-within:ring-offset-2 focus-within:ring-offset-background",
    );

    return (
        <div className={containerClassName}>
            {/* ラジオボタン（選択機能有効時のみ） */}
            {selectable && (
                <>
                    <input
                        id={inputId}
                        type="radio"
                        name={name}
                        value={meta.id}
                        checked={isSelected}
                        onChange={() => onSelect?.()}
                        disabled={disabled}
                        className="sr-only"
                    />
                    <label htmlFor={inputId} className="flex flex-1 min-w-0 items-center gap-3">
                        {/* Radio indicator */}
                        <div
                            className={cn(
                                "h-5 w-5 shrink-0 rounded-full",
                                isSelected
                                    ? "border-[6px] border-primary"
                                    : "border-2 border-muted-foreground",
                            )}
                        />

                        {/* Content */}
                        <div className="min-w-0 flex-1">
                            <div className="mb-1 flex items-center gap-2">
                                {isEditing ? (
                                    <Input
                                        ref={editInputRef}
                                        value={editValue}
                                        onChange={(e) =>
                                            dispatchDisplayName({
                                                type: "CHANGE",
                                                value: e.target.value,
                                            })
                                        }
                                        onBlur={() => void saveDisplayName()}
                                        onKeyDown={handleKeyDown}
                                        disabled={isSaving}
                                        className="h-7 max-w-[200px] text-sm font-medium"
                                        onClick={(e) => e.stopPropagation()}
                                    />
                                ) : (
                                    <span className="truncate font-medium">{meta.displayName}</span>
                                )}
                                {canEdit && !isEditing && (
                                    <button
                                        type="button"
                                        onClick={(e) => {
                                            e.preventDefault();
                                            e.stopPropagation();
                                            startEditing();
                                        }}
                                        disabled={disabled}
                                        className={cn(
                                            "inline-flex shrink-0 items-center rounded p-1 text-muted-foreground hover:bg-muted/50 hover:text-foreground",
                                            disabled
                                                ? "cursor-not-allowed opacity-50"
                                                : "cursor-pointer",
                                        )}
                                        title="表示名を編集"
                                        aria-label="表示名を編集"
                                    >
                                        <svg
                                            width="14"
                                            height="14"
                                            viewBox="0 0 24 24"
                                            fill="none"
                                            stroke="currentColor"
                                            strokeWidth="2"
                                            strokeLinecap="round"
                                            strokeLinejoin="round"
                                            aria-hidden="true"
                                        >
                                            <path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" />
                                            <path d="m15 5 4 4" />
                                        </svg>
                                    </button>
                                )}
                                {isPreset && (
                                    <span className="rounded bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground">
                                        プリセット
                                    </span>
                                )}
                            </div>
                            <div className="flex items-center gap-3 text-[13px] text-muted-foreground">
                                <span>{formatSize(meta.size)}</span>
                                <span className={validationStatus.className}>
                                    {validationStatus.label}
                                </span>
                            </div>
                            {architectureLabel && (
                                <div className="mt-1 text-xs text-muted-foreground">
                                    アーキテクチャ: {architectureLabel}
                                </div>
                            )}
                            {/* FV_SCALE 表示・編集 */}
                            {canEditFvScale && (
                                <div className="mt-1 flex items-center gap-1 text-xs text-muted-foreground">
                                    <span>FV_SCALE:</span>
                                    {isEditingFvScale ? (
                                        <Input
                                            ref={fvScaleInputRef}
                                            type="number"
                                            min={1}
                                            max={100}
                                            value={fvScaleValue}
                                            onChange={(e) =>
                                                dispatchFvScale({
                                                    type: "CHANGE",
                                                    value: e.target.value,
                                                })
                                            }
                                            onBlur={() => void saveFvScale()}
                                            onKeyDown={handleFvScaleKeyDown}
                                            disabled={isSavingFvScale}
                                            className="h-6 w-16 text-xs"
                                            onClick={(e) => e.stopPropagation()}
                                        />
                                    ) : (
                                        <>
                                            {meta.fvScale === undefined && (
                                                <span
                                                    role="img"
                                                    className="text-sm leading-none text-destructive"
                                                    title="FV_SCALE が未設定です。この評価関数はエンジン起動時にエラーになります。"
                                                    aria-label="警告"
                                                >
                                                    ⚠️
                                                </span>
                                            )}
                                            <button
                                                type="button"
                                                onClick={(e) => {
                                                    e.preventDefault();
                                                    e.stopPropagation();
                                                    startEditingFvScale();
                                                }}
                                                disabled={disabled}
                                                className={cn(
                                                    "rounded border-0 bg-transparent px-1 py-0.5 text-xs hover:bg-muted/50",
                                                    disabled
                                                        ? "cursor-not-allowed opacity-50"
                                                        : "cursor-pointer",
                                                    meta.fvScale !== undefined
                                                        ? "text-foreground"
                                                        : "text-destructive",
                                                )}
                                                title={
                                                    meta.fvScale !== undefined
                                                        ? "クリックして編集"
                                                        : "未設定です。クリックして FV_SCALE を設定してください。"
                                                }
                                            >
                                                {meta.fvScale !== undefined
                                                    ? meta.fvScale
                                                    : "未設定（要設定）"}
                                            </button>
                                        </>
                                    )}
                                </div>
                            )}
                        </div>
                    </label>
                </>
            )}

            {/* コンテンツ（選択機能無効時） */}
            {!selectable && (
                <div className="min-w-0 flex-1">
                    <div className="mb-1 flex items-center gap-2">
                        {isEditing ? (
                            <Input
                                ref={editInputRef}
                                value={editValue}
                                onChange={(e) =>
                                    dispatchDisplayName({ type: "CHANGE", value: e.target.value })
                                }
                                onBlur={() => void saveDisplayName()}
                                onKeyDown={handleKeyDown}
                                disabled={isSaving}
                                className="h-7 max-w-[200px] text-sm font-medium"
                            />
                        ) : canEdit ? (
                            <button
                                type="button"
                                onClick={(e) => {
                                    e.stopPropagation();
                                    startEditing();
                                }}
                                disabled={disabled}
                                className={cn(
                                    "truncate rounded border-0 bg-transparent px-1 py-0.5 text-left font-medium hover:bg-muted/50",
                                    disabled ? "cursor-not-allowed opacity-50" : "cursor-pointer",
                                )}
                                title="クリックして編集"
                            >
                                {meta.displayName}
                            </button>
                        ) : (
                            <span className="truncate font-medium">{meta.displayName}</span>
                        )}
                        {isPreset && (
                            <span className="rounded bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground">
                                プリセット
                            </span>
                        )}
                    </div>
                    <div className="flex items-center gap-3 text-[13px] text-muted-foreground">
                        <span>{formatSize(meta.size)}</span>
                        <span className={validationStatus.className}>{validationStatus.label}</span>
                    </div>
                    {architectureLabel && (
                        <div className="mt-1 text-xs text-muted-foreground">
                            アーキテクチャ: {architectureLabel}
                        </div>
                    )}
                    {/* FV_SCALE 表示・編集 */}
                    {canEditFvScale && (
                        <div className="mt-1 flex items-center gap-1 text-xs text-muted-foreground">
                            <span>FV_SCALE:</span>
                            {isEditingFvScale ? (
                                <Input
                                    ref={fvScaleInputRef}
                                    type="number"
                                    min={1}
                                    max={100}
                                    value={fvScaleValue}
                                    onChange={(e) =>
                                        dispatchFvScale({ type: "CHANGE", value: e.target.value })
                                    }
                                    onBlur={() => void saveFvScale()}
                                    onKeyDown={handleFvScaleKeyDown}
                                    disabled={isSavingFvScale}
                                    className="h-6 w-16 text-xs"
                                />
                            ) : (
                                <>
                                    {meta.fvScale === undefined && (
                                        <span
                                            role="img"
                                            className="text-sm leading-none text-destructive"
                                            title="FV_SCALE が未設定です。この評価関数はエンジン起動時にエラーになります。"
                                            aria-label="警告"
                                        >
                                            ⚠️
                                        </span>
                                    )}
                                    <button
                                        type="button"
                                        onClick={(e) => {
                                            e.stopPropagation();
                                            startEditingFvScale();
                                        }}
                                        disabled={disabled}
                                        className={cn(
                                            "rounded border-0 bg-transparent px-1 py-0.5 text-xs hover:bg-muted/50",
                                            disabled
                                                ? "cursor-not-allowed opacity-50"
                                                : "cursor-pointer",
                                            meta.fvScale !== undefined
                                                ? "text-foreground"
                                                : "text-destructive",
                                        )}
                                        title={
                                            meta.fvScale !== undefined
                                                ? "クリックして編集"
                                                : "未設定です。クリックして FV_SCALE を設定してください。"
                                        }
                                    >
                                        {meta.fvScale !== undefined
                                            ? meta.fvScale
                                            : "未設定（要設定）"}
                                    </button>
                                </>
                            )}
                        </div>
                    )}
                </div>
            )}

            {/* Delete button */}
            {canDelete && (
                <Button
                    variant="ghost"
                    size="sm"
                    onClick={(e) => {
                        e.stopPropagation();
                        onDelete();
                    }}
                    disabled={isDeleting || disabled || !!deleteDisabledReason}
                    className="shrink-0"
                    aria-label={`${meta.displayName} を削除`}
                    title={deleteDisabledReason}
                >
                    {isDeleting ? "..." : "削除"}
                </Button>
            )}
        </div>
    );
}
