import { type ChangeEvent, useEffect, useRef, useState } from "react";
import {
    decodeKifuFileBytes,
    type ImportKifHandler,
    type ImportSfenHandler,
    importKifuText,
    MAX_KIFU_FILE_BYTES,
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

    // 取り込み要求の通し番号。新しい要求が来たら、進行中の古い読み込み・取り込みを捨てる
    // (ファイル A → B の順に選んだとき、読むのが遅い A が B を上書きしないようにする)。
    const latestRequestRef = useRef(0);
    // 盤面への反映は 1 件ずつ順に行う (2 件の反映が入り混じらないようにする)。
    const importQueueRef = useRef<Promise<void>>(Promise.resolve());

    const beginRequest = (): number => {
        latestRequestRef.current += 1;
        setError(null);
        setSuccess(false);
        if (successTimerRef.current) {
            clearTimeout(successTimerRef.current);
            successTimerRef.current = null;
        }
        return latestRequestRef.current;
    };

    const isLatest = (requestId: number): boolean => latestRequestRef.current === requestId;

    const runImport = (requestId: number, text: string): Promise<void> => {
        const run = async (): Promise<void> => {
            if (!isLatest(requestId)) return;
            try {
                await importKifuText(text, { onImportSfen, onImportKif });
            } catch (e) {
                if (isLatest(requestId)) {
                    setError(e instanceof Error ? e.message : "インポートに失敗しました");
                }
                return;
            }
            if (!isLatest(requestId)) return;
            setSuccess(true);
            setInputValue("");
            successTimerRef.current = setTimeout(() => setSuccess(false), SUCCESS_DISPLAY_MS);
        };
        const queued = importQueueRef.current.then(run);
        importQueueRef.current = queued;
        return queued;
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
        const requestId = beginRequest();
        if (file.size > MAX_KIFU_FILE_BYTES) {
            setError(`ファイルが大きすぎます（上限 ${MAX_KIFU_FILE_BYTES / (1024 * 1024)}MB）`);
            return;
        }
        let text: string;
        try {
            text = decodeKifuFileBytes(await file.arrayBuffer());
        } catch (e) {
            if (isLatest(requestId)) {
                setError(
                    `ファイルを読み込めませんでした: ${e instanceof Error ? e.message : String(e)}`,
                );
            }
            return;
        }
        if (!isLatest(requestId)) return;
        await runImport(requestId, text);
    };

    return {
        inputValue,
        error,
        success,
        handleInputChange,
        handleImport: () => runImport(beginRequest(), inputValue),
        handleFileChange,
    };
}
