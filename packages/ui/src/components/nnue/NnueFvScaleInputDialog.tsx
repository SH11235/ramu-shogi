import type { ReactElement } from "react";
import { useCallback, useState } from "react";
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
    onConfirm: (fvScale: number) => void;
    /** キャンセル時のコールバック */
    onCancel: () => void;
}

/**
 * FV_SCALE 入力ダイアログ
 *
 * NNUE ファイルインポート時に FV_SCALE の入力を求める。
 */
export function NnueFvScaleInputDialog({
    open,
    fileName,
    onConfirm,
    onCancel,
}: NnueFvScaleInputDialogProps): ReactElement {
    const [value, setValue] = useState("");
    const [error, setError] = useState<string | null>(null);

    const handleValueChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
        setValue(e.target.value);
        setError(null);
    }, []);

    const handleConfirm = useCallback(() => {
        const num = Number(value);
        if (value === "" || Number.isNaN(num)) {
            setError("数値を入力してください");
            return;
        }
        if (!Number.isInteger(num) || num < 1 || num > 100) {
            setError("1〜100 の整数を入力してください");
            return;
        }
        onConfirm(num);
        setValue("");
        setError(null);
    }, [value, onConfirm]);

    const handleCancel = useCallback(() => {
        onCancel();
        setValue("");
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
                    <AlertDialogTitle>FV_SCALE の設定</AlertDialogTitle>
                    <AlertDialogDescription>
                        「{fileName}」をインポートするには FV_SCALE の設定が必要です。
                        <br />
                        FV_SCALE は NNUE ファイルの開発者が公開している値を入力してください。
                        正しい値が不明な場合はインポートできません。
                    </AlertDialogDescription>
                </AlertDialogHeader>
                <div style={{ padding: "8px 0" }}>
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
                    {error && (
                        <p
                            style={{
                                color: "hsl(var(--destructive))",
                                fontSize: "12px",
                                marginTop: "4px",
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
