import type { NnueMeta } from "@shogi/app-core";
import { cn } from "@shogi/design-system";
import { type ReactElement, useCallback, useId, useRef, useState } from "react";
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

function getValidationStatus(meta: NnueMeta): { label: string; color: string } {
    if (meta.format) {
        return { label: "形式確認済み", color: "hsl(var(--success, 142 76% 36%))" };
    }
    return {
        label: "未確認（動作保証なし）",
        color: "hsl(var(--warning, 38 92% 50%))",
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
    const [isEditing, setIsEditing] = useState(false);
    const [editValue, setEditValue] = useState(meta.displayName);
    const [isSaving, setIsSaving] = useState(false);

    // FV_SCALE編集状態
    const [isEditingFvScale, setIsEditingFvScale] = useState(false);
    const [fvScaleValue, setFvScaleValue] = useState(meta.fvScale?.toString() ?? "");
    const [isSavingFvScale, setIsSavingFvScale] = useState(false);

    const startEditing = useCallback(() => {
        if (!canEdit || disabled) return;
        setEditValue(meta.displayName);
        setIsEditing(true);
        // 次のレンダリング後にフォーカス
        setTimeout(() => editInputRef.current?.select(), 0);
    }, [canEdit, disabled, meta.displayName]);

    const cancelEditing = useCallback(() => {
        setIsEditing(false);
        setEditValue(meta.displayName);
    }, [meta.displayName]);

    const saveDisplayName = useCallback(async () => {
        if (!onDisplayNameChange) return;
        const trimmed = editValue.trim();
        if (trimmed === "" || trimmed === meta.displayName) {
            cancelEditing();
            return;
        }
        setIsSaving(true);
        try {
            await onDisplayNameChange(trimmed);
            setIsEditing(false);
        } catch {
            // エラーは親コンポーネントで処理される
        } finally {
            setIsSaving(false);
        }
    }, [onDisplayNameChange, editValue, meta.displayName, cancelEditing]);

    const handleKeyDown = useCallback(
        (e: React.KeyboardEvent) => {
            if (e.key === "Enter") {
                e.preventDefault();
                void saveDisplayName();
            } else if (e.key === "Escape") {
                cancelEditing();
            }
        },
        [saveDisplayName, cancelEditing],
    );

    // FV_SCALE編集関連
    const startEditingFvScale = useCallback(() => {
        if (!canEditFvScale || disabled) return;
        setFvScaleValue(meta.fvScale?.toString() ?? "");
        setIsEditingFvScale(true);
        setTimeout(() => fvScaleInputRef.current?.select(), 0);
    }, [canEditFvScale, disabled, meta.fvScale]);

    const cancelEditingFvScale = useCallback(() => {
        setIsEditingFvScale(false);
        setFvScaleValue(meta.fvScale?.toString() ?? "");
    }, [meta.fvScale]);

    const saveFvScale = useCallback(async () => {
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
        setIsSavingFvScale(true);
        try {
            await onFvScaleChange(newValue);
            setIsEditingFvScale(false);
        } catch {
            // エラーは親コンポーネントで処理される
        } finally {
            setIsSavingFvScale(false);
        }
    }, [onFvScaleChange, fvScaleValue, meta.fvScale, cancelEditingFvScale]);

    const handleFvScaleKeyDown = useCallback(
        (e: React.KeyboardEvent) => {
            if (e.key === "Enter") {
                e.preventDefault();
                void saveFvScale();
            } else if (e.key === "Escape") {
                cancelEditingFvScale();
            }
        },
        [saveFvScale, cancelEditingFvScale],
    );

    // 選択機能が無効な場合のスタイル
    const containerStyle = selectable
        ? {
              display: "flex",
              alignItems: "center",
              gap: "12px",
              padding: "12px",
              borderRadius: "8px",
              backgroundColor: isSelected ? "hsl(var(--accent, 210 40% 96%))" : "transparent",
              border: isSelected
                  ? "1px solid hsl(var(--primary, 220 90% 56%))"
                  : "1px solid hsl(var(--border, 0 0% 86%))",
              cursor: disabled ? "not-allowed" : "pointer",
              opacity: disabled ? 0.5 : 1,
              transition: "background-color 150ms, border-color 150ms",
          }
        : {
              display: "flex",
              alignItems: "center",
              gap: "12px",
              padding: "12px",
              borderRadius: "8px",
              backgroundColor: "transparent",
              border: "1px solid hsl(var(--border, 0 0% 86%))",
              opacity: disabled ? 0.5 : 1,
          };

    const containerClassName = selectable
        ? cn(
              "hover:bg-muted/50 focus-within:ring-2 focus-within:ring-ring focus-within:ring-offset-2 focus-within:ring-offset-background",
              isSelected && "bg-accent",
          )
        : "";

    return (
        <div style={containerStyle} className={containerClassName}>
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
                            style={{
                                width: "20px",
                                height: "20px",
                                borderRadius: "50%",
                                border: isSelected
                                    ? "6px solid hsl(var(--primary, 220 90% 56%))"
                                    : "2px solid hsl(var(--muted-foreground, 0 0% 45%))",
                                flexShrink: 0,
                            }}
                        />

                        {/* Content */}
                        <div style={{ flex: 1, minWidth: 0 }}>
                            <div
                                style={{
                                    display: "flex",
                                    alignItems: "center",
                                    gap: "8px",
                                    marginBottom: "4px",
                                }}
                            >
                                {isEditing ? (
                                    <Input
                                        ref={editInputRef}
                                        value={editValue}
                                        onChange={(e) => setEditValue(e.target.value)}
                                        onBlur={() => void saveDisplayName()}
                                        onKeyDown={handleKeyDown}
                                        disabled={isSaving}
                                        className="h-7 text-sm font-medium"
                                        style={{ maxWidth: "200px" }}
                                        onClick={(e) => e.stopPropagation()}
                                    />
                                ) : (
                                    <span
                                        style={{
                                            fontWeight: 500,
                                            overflow: "hidden",
                                            textOverflow: "ellipsis",
                                            whiteSpace: "nowrap",
                                        }}
                                    >
                                        {meta.displayName}
                                    </span>
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
                                        style={{
                                            background: "none",
                                            border: "none",
                                            padding: "4px",
                                            cursor: disabled ? "not-allowed" : "pointer",
                                            color: "hsl(var(--muted-foreground, 0 0% 45%))",
                                            display: "flex",
                                            alignItems: "center",
                                            borderRadius: "4px",
                                            flexShrink: 0,
                                        }}
                                        className="hover:bg-muted/50 hover:text-foreground"
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
                                    <span
                                        style={{
                                            fontSize: "11px",
                                            padding: "2px 6px",
                                            borderRadius: "4px",
                                            backgroundColor: "hsl(var(--muted, 0 0% 90%))",
                                            color: "hsl(var(--muted-foreground, 0 0% 45%))",
                                        }}
                                    >
                                        プリセット
                                    </span>
                                )}
                            </div>
                            <div
                                style={{
                                    display: "flex",
                                    alignItems: "center",
                                    gap: "12px",
                                    fontSize: "13px",
                                    color: "hsl(var(--muted-foreground, 0 0% 45%))",
                                }}
                            >
                                <span>{formatSize(meta.size)}</span>
                                <span style={{ color: validationStatus.color }}>
                                    {validationStatus.label}
                                </span>
                            </div>
                            {architectureLabel && (
                                <div
                                    style={{
                                        marginTop: "4px",
                                        fontSize: "12px",
                                        color: "hsl(var(--muted-foreground, 0 0% 45%))",
                                    }}
                                >
                                    アーキテクチャ: {architectureLabel}
                                </div>
                            )}
                            {/* FV_SCALE 表示・編集 */}
                            {canEditFvScale && (
                                <div
                                    style={{
                                        marginTop: "4px",
                                        fontSize: "12px",
                                        color: "hsl(var(--muted-foreground, 0 0% 45%))",
                                        display: "flex",
                                        alignItems: "center",
                                        gap: "4px",
                                    }}
                                >
                                    <span>FV_SCALE:</span>
                                    {isEditingFvScale ? (
                                        <Input
                                            ref={fvScaleInputRef}
                                            type="number"
                                            min={1}
                                            max={100}
                                            value={fvScaleValue}
                                            onChange={(e) => setFvScaleValue(e.target.value)}
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
                                                    style={{
                                                        fontSize: "14px",
                                                        lineHeight: 1,
                                                        color: "hsl(var(--destructive, 0 84% 60%))",
                                                    }}
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
                                                style={{
                                                    background: "none",
                                                    border: "none",
                                                    padding: "2px 4px",
                                                    cursor: disabled ? "not-allowed" : "pointer",
                                                    borderRadius: "4px",
                                                    fontSize: "12px",
                                                    color:
                                                        meta.fvScale !== undefined
                                                            ? "hsl(var(--foreground))"
                                                            : "hsl(var(--destructive, 0 84% 60%))",
                                                }}
                                                className="hover:bg-muted/50"
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
                <div style={{ flex: 1, minWidth: 0 }}>
                    <div
                        style={{
                            display: "flex",
                            alignItems: "center",
                            gap: "8px",
                            marginBottom: "4px",
                        }}
                    >
                        {isEditing ? (
                            <Input
                                ref={editInputRef}
                                value={editValue}
                                onChange={(e) => setEditValue(e.target.value)}
                                onBlur={() => void saveDisplayName()}
                                onKeyDown={handleKeyDown}
                                disabled={isSaving}
                                className="h-7 text-sm font-medium"
                                style={{ maxWidth: "200px" }}
                            />
                        ) : canEdit ? (
                            <button
                                type="button"
                                onClick={(e) => {
                                    e.stopPropagation();
                                    startEditing();
                                }}
                                disabled={disabled}
                                style={{
                                    fontWeight: 500,
                                    overflow: "hidden",
                                    textOverflow: "ellipsis",
                                    whiteSpace: "nowrap",
                                    background: "none",
                                    border: "none",
                                    padding: "2px 4px",
                                    margin: "-2px -4px",
                                    borderRadius: "4px",
                                    cursor: disabled ? "not-allowed" : "pointer",
                                    textAlign: "left",
                                }}
                                className="hover:bg-muted/50"
                                title="クリックして編集"
                            >
                                {meta.displayName}
                            </button>
                        ) : (
                            <span
                                style={{
                                    fontWeight: 500,
                                    overflow: "hidden",
                                    textOverflow: "ellipsis",
                                    whiteSpace: "nowrap",
                                }}
                            >
                                {meta.displayName}
                            </span>
                        )}
                        {isPreset && (
                            <span
                                style={{
                                    fontSize: "11px",
                                    padding: "2px 6px",
                                    borderRadius: "4px",
                                    backgroundColor: "hsl(var(--muted, 0 0% 90%))",
                                    color: "hsl(var(--muted-foreground, 0 0% 45%))",
                                }}
                            >
                                プリセット
                            </span>
                        )}
                    </div>
                    <div
                        style={{
                            display: "flex",
                            alignItems: "center",
                            gap: "12px",
                            fontSize: "13px",
                            color: "hsl(var(--muted-foreground, 0 0% 45%))",
                        }}
                    >
                        <span>{formatSize(meta.size)}</span>
                        <span style={{ color: validationStatus.color }}>
                            {validationStatus.label}
                        </span>
                    </div>
                    {architectureLabel && (
                        <div
                            style={{
                                marginTop: "4px",
                                fontSize: "12px",
                                color: "hsl(var(--muted-foreground, 0 0% 45%))",
                            }}
                        >
                            アーキテクチャ: {architectureLabel}
                        </div>
                    )}
                    {/* FV_SCALE 表示・編集 */}
                    {canEditFvScale && (
                        <div
                            style={{
                                marginTop: "4px",
                                fontSize: "12px",
                                color: "hsl(var(--muted-foreground, 0 0% 45%))",
                                display: "flex",
                                alignItems: "center",
                                gap: "4px",
                            }}
                        >
                            <span>FV_SCALE:</span>
                            {isEditingFvScale ? (
                                <Input
                                    ref={fvScaleInputRef}
                                    type="number"
                                    min={1}
                                    max={100}
                                    value={fvScaleValue}
                                    onChange={(e) => setFvScaleValue(e.target.value)}
                                    onBlur={() => void saveFvScale()}
                                    onKeyDown={handleFvScaleKeyDown}
                                    disabled={isSavingFvScale}
                                    className="h-6 w-16 text-xs"
                                />
                            ) : (
                                <>
                                    {meta.fvScale === undefined && (
                                        <span
                                            style={{
                                                fontSize: "14px",
                                                lineHeight: 1,
                                                color: "hsl(var(--destructive, 0 84% 60%))",
                                            }}
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
                                        style={{
                                            background: "none",
                                            border: "none",
                                            padding: "2px 4px",
                                            cursor: disabled ? "not-allowed" : "pointer",
                                            borderRadius: "4px",
                                            fontSize: "12px",
                                            color:
                                                meta.fvScale !== undefined
                                                    ? "hsl(var(--foreground))"
                                                    : "hsl(var(--destructive, 0 84% 60%))",
                                        }}
                                        className="hover:bg-muted/50"
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
                    style={{ flexShrink: 0 }}
                    aria-label={`${meta.displayName} を削除`}
                    title={deleteDisabledReason}
                >
                    {isDeleting ? "..." : "削除"}
                </Button>
            )}
        </div>
    );
}
