import { type ChangeEvent, useEffect, useRef, useState } from "react";
import {
    decodeKifuFileBytes,
    type ImportKifHandler,
    type ImportSfenHandler,
    importKifuText,
} from "../utils/kifuImport";

const SUCCESS_DISPLAY_MS = 2000;

interface UseKifuTextImportProps {
    onImportSfen: ImportSfenHandler;
    onImportKif: ImportKifHandler;
}

interface UseKifuTextImportResult {
    /** 貼り付け欄の内容。 */
    inputValue: string;
    error: string | null;
    /** 直前の取り込みが成功した直後だけ true。 */
    success: boolean;
    /** 貼り付け欄の変更。 */
    handleInputChange: (value: string) => void;
    /** 貼り付け欄の内容を取り込む。 */
    handleImport: () => Promise<void>;
    /** `<input type="file">` の onChange。選んだファイルをその場で取り込む。 */
    handleFileChange: (event: ChangeEvent<HTMLInputElement>) => Promise<void>;
}

/**
 * 棋譜取り込み (貼り付け・ファイル選択) の状態と操作。
 *
 * PC の `KifuImportPanel` とモバイルの設定シートで共有する。形式 (CSA / KIF / SFEN) は
 * 自動判別し、ファイルは UTF-8 / Shift_JIS を判別して読む。読んだ内容は端末内で
 * 盤面へ反映するだけで、サーバーには送らない。
 */
export function useKifuTextImport({
    onImportSfen,
    onImportKif,
}: UseKifuTextImportProps): UseKifuTextImportResult {
    const [inputValue, setInputValue] = useState("");
    const [error, setError] = useState<string | null>(null);
    const [success, setSuccess] = useState(false);
    const successTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    // アンマウント時にタイマーを片付ける
    useEffect(() => {
        return () => {
            if (successTimerRef.current) {
                clearTimeout(successTimerRef.current);
            }
        };
    }, []);

    const runImport = async (text: string): Promise<void> => {
        setError(null);
        setSuccess(false);
        if (successTimerRef.current) {
            clearTimeout(successTimerRef.current);
            successTimerRef.current = null;
        }
        try {
            await importKifuText(text, { onImportSfen, onImportKif });
            setSuccess(true);
            setInputValue("");
            successTimerRef.current = setTimeout(() => setSuccess(false), SUCCESS_DISPLAY_MS);
        } catch (e) {
            setError(e instanceof Error ? e.message : "インポートに失敗しました");
        }
    };

    const handleInputChange = (value: string): void => {
        setInputValue(value);
        setError(null);
        setSuccess(false);
    };

    const handleFileChange = async (event: ChangeEvent<HTMLInputElement>): Promise<void> => {
        const input = event.target;
        const file = input.files?.[0];
        // 同じファイルを続けて選び直しても change が発火するよう、選択を消しておく。
        input.value = "";
        if (!file) return;
        let text: string;
        try {
            text = decodeKifuFileBytes(await file.arrayBuffer());
        } catch (e) {
            setSuccess(false);
            setError(
                `ファイルを読み込めませんでした: ${e instanceof Error ? e.message : String(e)}`,
            );
            return;
        }
        await runImport(text);
    };

    return {
        inputValue,
        error,
        success,
        handleInputChange,
        handleImport: () => runImport(inputValue),
        handleFileChange,
    };
}
