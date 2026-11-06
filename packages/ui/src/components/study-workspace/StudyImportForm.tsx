/**
 * 棋譜を取り込んで研究ノートを作るフォーム（貼り付け・ファイル選択）。
 *
 * 形式（CSA / KIF / SFEN、rshogi の連続対局の JSONL）は自動で判別する。読んだ内容をどう保存するかは
 * 呼び出し側が決める。
 */

import { cn } from "@shogi/design-system";
import type { ChangeEvent, ReactElement } from "react";
import { useRef, useState } from "react";
import { Button } from "../button";
import {
    decodeKifuFileBytes,
    KIFU_FILE_ACCEPT,
    MAX_KIFU_FILE_BYTES,
} from "../shogi-match/utils/kifuImport";
import { parseKifuTextForStudy, type StudyKifuSource } from "./studyImport";

/** 研究ノートの取り込みで受け付ける拡張子（棋譜に加えて、連続対局の JSONL）。 */
const STUDY_FILE_ACCEPT = `${KIFU_FILE_ACCEPT},.jsonl`;
/**
 * 連続対局の JSONL の大きさの上限。1 局に 200 KB 前後の探索の記録が付き、一度に取り込めるのは
 * 50 局までなので、それに見合う大きさにする。
 */
const MAX_JSONL_FILE_BYTES = 16 * 1024 * 1024;

interface StudyImportFormProps {
    /** 取り込んだ棋譜で研究ノートを作る。失敗時は例外を投げると、その文言を表示する。 */
    onImport: (source: StudyKifuSource) => Promise<void>;
    /** 取り込んだ棋譜がどこに保存されるかの説明（既定は、ブラウザの中）。 */
    storageNote?: string;
    className?: string;
}

export function StudyImportForm({
    onImport,
    storageNote = "読んだ棋譜は、このブラウザの中で研究ノートになります。",
    className,
}: StudyImportFormProps): ReactElement {
    const [text, setText] = useState("");
    const [error, setError] = useState<string | null>(null);
    const [isBusy, setIsBusy] = useState(false);
    const fileInputRef = useRef<HTMLInputElement | null>(null);

    const submit = async (input: string, sourceName?: string): Promise<void> => {
        if (isBusy) return;
        setIsBusy(true);
        setError(null);
        try {
            await onImport(parseKifuTextForStudy(input, sourceName));
        } catch (failure) {
            setError(failure instanceof Error ? failure.message : "取り込みに失敗しました");
        } finally {
            setIsBusy(false);
        }
    };

    const handleFileChange = async (event: ChangeEvent<HTMLInputElement>): Promise<void> => {
        const input = event.target;
        const file = input.files?.[0];
        // 同じファイルを続けて選び直しても change が発火するよう、選択を消しておく。
        input.value = "";
        if (!file) return;
        const maxBytes = /\.jsonl$/i.test(file.name) ? MAX_JSONL_FILE_BYTES : MAX_KIFU_FILE_BYTES;
        if (file.size > maxBytes) {
            setError(`ファイルが大きすぎます（上限 ${maxBytes / (1024 * 1024)}MB）`);
            return;
        }
        let content: string;
        try {
            content = decodeKifuFileBytes(await file.arrayBuffer());
        } catch (failure) {
            setError(
                `ファイルを読み込めませんでした: ${failure instanceof Error ? failure.message : String(failure)}`,
            );
            return;
        }
        await submit(content, file.name);
    };

    return (
        <form
            className={cn("flex flex-col gap-3", className)}
            onSubmit={(event) => {
                event.preventDefault();
                void submit(text);
            }}
        >
            <textarea
                aria-label="棋譜のテキスト"
                value={text}
                onChange={(event) => {
                    setText(event.target.value);
                    setError(null);
                }}
                rows={5}
                placeholder={
                    "棋譜を貼り付けてください（CSA / KIF / SFEN）\n例: +7776FU\n例: 1 ７六歩(77)"
                }
                className="w-full resize-y rounded-md border border-border bg-background p-2 font-mono text-base text-foreground placeholder:text-muted-foreground/70 focus:outline-none focus:ring-2 focus:ring-ring md:text-sm"
            />
            {error && (
                <p role="alert" className="text-sm text-destructive">
                    {error}
                </p>
            )}
            <div className="flex flex-col gap-2 sm:flex-row">
                <Button type="submit" disabled={isBusy || !text.trim()} className="sm:flex-1">
                    {isBusy ? "取り込み中…" : "研究ノートにする"}
                </Button>
                <Button
                    type="button"
                    variant="outline"
                    disabled={isBusy}
                    onClick={() => fileInputRef.current?.click()}
                >
                    ファイルを選ぶ
                </Button>
                <input
                    ref={fileInputRef}
                    type="file"
                    accept={STUDY_FILE_ACCEPT}
                    onChange={(event) => void handleFileChange(event)}
                    className="sr-only"
                    aria-label="棋譜のファイル（.csa / .kif / .kifu / .sfen / .txt / .jsonl）"
                    tabIndex={-1}
                />
            </div>
            <p className="text-xs text-muted-foreground">{storageNote}</p>
        </form>
    );
}
