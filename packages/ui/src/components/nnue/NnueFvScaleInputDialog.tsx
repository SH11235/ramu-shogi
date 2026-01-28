import type { ReactElement } from "react";
import { useCallback, useEffect, useState } from "react";
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

interface NnueFvScaleInputDialogProps {
    /** ダイアログが開いているか */
    open: boolean;
    /** インポート対象のファイル名 */
    fileName: string;
    /** 確定時のコールバック */
    onConfirm: (fvScale: number, displayName: string) => void | Promise<void>;
    /** キャンセル時のコールバック */
    onCancel: () => void;
}

/**
 * FV_SCALE と表示名の入力ダイアログ
 *
 * NNUE ファイルインポート時に FV_SCALE と表示名の入力を求める。
 */
export function NnueFvScaleInputDialog({
    open,
    fileName,
    onConfirm,
    onCancel,
}: NnueFvScaleInputDialogProps): ReactElement {
    // FV_SCALE 入力
    const [value, setValue] = useState("");
    const [error, setError] = useState<string | null>(null);

    // 表示名入力（デフォルト値: 拡張子を除去したファイル名）
    const [displayName, setDisplayName] = useState("");

    // ダイアログが開かれたときにデフォルト値を設定
    useEffect(() => {
        if (open) {
            const defaultName = fileName.replace(/\.(nnue|bin)$/i, "");
            setDisplayName(defaultName);
        }
    }, [open, fileName]);

    const handleValueChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
        const inputValue = e.target.value;
        // 空文字または整数のみ許可（小数点やアルファベットを除外）
        if (inputValue === "" || /^\d+$/.test(inputValue)) {
            setValue(inputValue);
            setError(null);
        }
    }, []);

    const handleConfirm = useCallback(() => {
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

        void onConfirm(num, trimmedName);
        setValue("");
        setDisplayName("");
        setError(null);
    }, [value, displayName, onConfirm]);

    const handleCancel = useCallback(() => {
        onCancel();
        setValue("");
        setDisplayName("");
        setError(null);
    }, [onCancel]);

    const handleKeyDown = useCallback(
        (e: React.KeyboardEvent) => {
            if (e.key === "Enter") {
                e.preventDefault();
                handleConfirm();
            }
        },
        [handleConfirm],
    );

    return (
        <AlertDialog open={open} onOpenChange={(isOpen) => !isOpen && handleCancel()}>
            <AlertDialogContent>
                <AlertDialogHeader>
                    <AlertDialogTitle>評価関数のインポート</AlertDialogTitle>
                    <AlertDialogDescription>
                        「{fileName}」をインポートします。表示名と FV_SCALE を設定してください。
                    </AlertDialogDescription>
                </AlertDialogHeader>
                <div
                    style={{
                        padding: "8px 0",
                        display: "flex",
                        flexDirection: "column",
                        gap: "16px",
                    }}
                >
                    {/* 表示名入力 */}
                    <div>
                        <label
                            htmlFor="display-name-input"
                            style={{
                                display: "block",
                                fontSize: "14px",
                                fontWeight: 500,
                                marginBottom: "4px",
                            }}
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
                        <label
                            htmlFor="fv-scale-input"
                            style={{
                                display: "block",
                                fontSize: "14px",
                                fontWeight: 500,
                                marginBottom: "4px",
                            }}
                        >
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
                        <p
                            style={{
                                fontSize: "12px",
                                color: "hsl(var(--muted-foreground))",
                                marginTop: "4px",
                            }}
                        >
                            FV_SCALE は NNUE ファイルの開発者が公開している値を入力してください
                        </p>
                    </div>

                    {error && (
                        <p
                            style={{
                                color: "hsl(var(--destructive))",
                                fontSize: "12px",
                            }}
                        >
                            {error}
                        </p>
                    )}
                </div>
                <AlertDialogFooter>
                    <AlertDialogCancel onClick={handleCancel}>キャンセル</AlertDialogCancel>
                    <AlertDialogAction onClick={handleConfirm}>インポート</AlertDialogAction>
                </AlertDialogFooter>
            </AlertDialogContent>
        </AlertDialog>
    );
}
