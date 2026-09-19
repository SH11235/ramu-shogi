import { type LayerStacksConfig, validateLayerStacks } from "@shogi/app-core";
import type { ReactElement } from "react";
import { useState } from "react";
import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
} from "../alert-dialog";
import { Input } from "../input";
import { LayerStacksFields } from "./LayerStacksFields";

interface NnueFvScaleInputDialogProps {
    /** インポート対象のファイル名 */
    fileName: string;
    initialFvScale?: number;
    initialLayerStacks?: LayerStacksConfig;
    editing?: boolean;
    requireLayerStacks?: boolean;
    /** 確定時のコールバック */
    onConfirm: (
        fvScale: number,
        displayName: string,
        layerStacks?: LayerStacksConfig,
    ) => void | Promise<void>;
    /** キャンセル時のコールバック */
    onCancel: () => void;
}

/**
 * FV_SCALE と表示名の入力ダイアログ
 *
 * NNUE ファイルインポート時に FV_SCALE と表示名の入力を求める。
 * 親側で条件レンダリング（`{open && <NnueFvScaleInputDialog />}`）して使う。
 */
export function NnueFvScaleInputDialog({
    fileName,
    initialFvScale,
    initialLayerStacks,
    editing = false,
    requireLayerStacks = false,
    onConfirm,
    onCancel,
}: NnueFvScaleInputDialogProps): ReactElement {
    // FV_SCALE 入力
    const [value, setValue] = useState(initialFvScale?.toString() ?? "");
    const [layerStacks, setLayerStacks] = useState(initialLayerStacks);
    const [uploading, setUploading] = useState(false);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);

    // 表示名入力（マウント時にファイル名から自動生成）
    const [displayName, setDisplayName] = useState(() => fileName.replace(/\.(nnue|bin)$/i, ""));

    const handleValueChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const inputValue = e.target.value;
        // 空文字または整数のみ許可（小数点やアルファベットを除外）
        if (inputValue === "" || /^\d+$/.test(inputValue)) {
            setValue(inputValue);
            setError(null);
        }
    };

    const handleConfirm = async () => {
        if (saving || uploading) return;
        if (requireLayerStacks && !layerStacks) return;
        // 表示名のバリデーション
        const trimmedName = displayName.trim();
        if (trimmedName === "") {
            setError("表示名を入力してください");
            return;
        }

        // FV_SCALE のバリデーション
        const num = Number(value);
        if (value === "" || Number.isNaN(num)) {
            setError("FV_SCALE を入力してください");
            return;
        }
        if (!Number.isInteger(num) || num < 1 || num > 100) {
            setError("FV_SCALE は 1〜100 の整数を入力してください");
            return;
        }

        try {
            if (layerStacks) validateLayerStacks(layerStacks);
        } catch (error) {
            setError(error instanceof Error ? error.message : String(error));
            return;
        }
        setSaving(true);
        try {
            await onConfirm(num, trimmedName, layerStacks);
        } catch (error) {
            setError(error instanceof Error ? error.message : String(error));
        } finally {
            setSaving(false);
        }
    };

    const handleKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === "Enter") {
            e.preventDefault();
            void handleConfirm();
        }
    };

    // インポートボタンの有効/無効判定
    const canConfirm = (() => {
        if (saving || uploading || (requireLayerStacks && !layerStacks)) return false;
        const trimmedName = displayName.trim();
        if (trimmedName === "") return false;
        const num = Number(value);
        if (value === "" || Number.isNaN(num)) return false;
        if (!Number.isInteger(num) || num < 1 || num > 100) return false;
        try {
            if (layerStacks) validateLayerStacks(layerStacks);
        } catch {
            return false;
        }
        return true;
    })();

    return (
        <AlertDialog defaultOpen>
            <AlertDialogContent
                className="max-h-[calc(100dvh-32px)] overflow-y-auto"
                onEscapeKeyDown={onCancel}
            >
                <AlertDialogHeader>
                    <AlertDialogTitle>
                        {editing ? "評価関数の設定" : "評価関数のインポート"}
                    </AlertDialogTitle>
                    <AlertDialogDescription>
                        「{fileName}」の表示名と FV_SCALE、LayerStacks の方式を設定してください。
                    </AlertDialogDescription>
                </AlertDialogHeader>
                <div className="flex flex-col gap-4 py-2">
                    {/* 表示名入力 */}
                    <div>
                        <label
                            htmlFor="display-name-input"
                            className="mb-1 block text-sm font-medium"
                        >
                            表示名
                        </label>
                        <Input
                            id="display-name-input"
                            type="text"
                            value={displayName}
                            onChange={(e) => {
                                setDisplayName(e.target.value);
                                setError(null);
                            }}
                            placeholder="例: 水匠5"
                        />
                    </div>

                    {/* FV_SCALE入力 */}
                    <div>
                        <label htmlFor="fv-scale-input" className="mb-1 block text-sm font-medium">
                            FV_SCALE (1〜100)
                        </label>
                        <Input
                            id="fv-scale-input"
                            type="number"
                            min={1}
                            max={100}
                            step={1}
                            value={value}
                            onChange={handleValueChange}
                            onKeyDown={handleKeyDown}
                            placeholder="例: 16, 24"
                        />
                        <p className="mt-1 text-xs text-muted-foreground">
                            FV_SCALE は NNUE ファイルの開発者が公開している値を入力してください
                        </p>
                    </div>

                    <LayerStacksFields
                        value={layerStacks}
                        onChange={setLayerStacks}
                        onLoadingChange={setUploading}
                    />
                    {error && <p className="text-xs text-destructive">{error}</p>}
                </div>
                <AlertDialogFooter>
                    <AlertDialogCancel onClick={onCancel}>キャンセル</AlertDialogCancel>
                    <AlertDialogAction
                        onClick={(event) => {
                            event.preventDefault();
                            void handleConfirm();
                        }}
                        disabled={!canConfirm}
                    >
                        {editing ? "保存" : "インポート"}
                    </AlertDialogAction>
                </AlertDialogFooter>
            </AlertDialogContent>
        </AlertDialog>
    );
}
