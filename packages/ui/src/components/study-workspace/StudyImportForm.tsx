/**
 * 棋譜を取り込んで研究ノートを作るフォーム（貼り付け・ファイルを落とす・ファイルを選ぶ）。
 *
 * 形式（CSA / KIF / SFEN、rshogi の連続対局の JSONL）は自動で判別する。読んだ内容をどう保存するかは
 * 呼び出し側が決める。
 */

import { STUDY_HIRATE_SFEN } from "@shogi/app-core";
import { cn } from "@shogi/design-system";
import type { DragEvent, ReactElement } from "react";
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
    /** 取り込み中かどうかを知らせる（呼び出し側で、ほかの作り方を止めるのに使う）。 */
    onBusyChange?: (busy: boolean) => void;
    /**
     * 呼び出し側で、ほかの作り方の保存が進んでいる。フォームを閉じて開き直しても、その間は取り込ませない
     * （フォームの中の状態は開き直すと消えるので、呼び出し側が持つ）。
     */
    busy?: boolean;
    /** 貼り付けた棋譜で作るボタンの文言。 */
    submitLabel?: string;
    /** 広い画面で、貼り付けの欄とファイルの枠を横に並べる（狭い画面では縦に積む）。 */
    sideBySide?: boolean;
    className?: string;
}

/** 受け付ける拡張子の一覧（画面に出す）。 */
const ACCEPT_LABEL = STUDY_FILE_ACCEPT.split(",").join(" ");

export function StudyImportForm({
    onImport,
    storageNote = "読んだ棋譜は、このブラウザの中で研究ノートになります。",
    onBusyChange,
    busy = false,
    submitLabel = "研究ノートにする",
    sideBySide = false,
    className,
}: StudyImportFormProps): ReactElement {
    const [text, setText] = useState("");
    const [error, setError] = useState<string | null>(null);
    const [ownBusy, setIsBusy] = useState(false);
    const isBusy = ownBusy || busy;
    const [isDragOver, setIsDragOver] = useState(false);
    const fileInputRef = useRef<HTMLInputElement | null>(null);

    // 同じ時点の連続の操作（2 回のドロップなど）でも 1 回だけにするため、state でなく ref で見る。
    const busyRef = useRef(false);
    const runExclusive = async (task: () => Promise<void>): Promise<void> => {
        if (busyRef.current || busy) return;
        busyRef.current = true;
        setIsBusy(true);
        onBusyChange?.(true);
        setError(null);
        try {
            await task();
        } catch (failure) {
            setError(failure instanceof Error ? failure.message : "取り込みに失敗しました");
        } finally {
            busyRef.current = false;
            setIsBusy(false);
            onBusyChange?.(false);
        }
    };

    const submit = (input: string, sourceName?: string): Promise<void> =>
        runExclusive(() => onImport(parseKifuTextForStudy(input, sourceName)));

    const readFile = (file: File): Promise<void> =>
        runExclusive(async () => {
            const maxBytes = /\.jsonl$/i.test(file.name)
                ? MAX_JSONL_FILE_BYTES
                : MAX_KIFU_FILE_BYTES;
            if (file.size > maxBytes) {
                throw new Error(`ファイルが大きすぎます（上限 ${maxBytes / (1024 * 1024)}MB）`);
            }
            let content: string;
            try {
                content = decodeKifuFileBytes(await file.arrayBuffer());
            } catch (failure) {
                throw new Error(
                    `ファイルを読み込めませんでした: ${failure instanceof Error ? failure.message : String(failure)}`,
                );
            }
            await onImport(parseKifuTextForStudy(content, file.name));
        });

    const dropFile = (event: DragEvent<HTMLFieldSetElement>): void => {
        event.preventDefault();
        setIsDragOver(false);
        const file = event.dataTransfer.files[0];
        if (file) void readFile(file);
    };

    return (
        <form
            className={cn("flex flex-col gap-3", className)}
            onSubmit={(event) => {
                event.preventDefault();
                void submit(text);
            }}
        >
            <div className={cn("flex flex-col gap-3", sideBySide && "md:grid md:grid-cols-2")}>
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
                {/* 落とした時点で読み込む（貼り付けと違い、読む前に中身を直すことが無いので）。 */}
                <fieldset
                    onDragEnter={(event) => {
                        event.preventDefault();
                        setIsDragOver(true);
                    }}
                    onDragOver={(event) => {
                        event.preventDefault();
                        event.dataTransfer.dropEffect = "copy";
                    }}
                    onDragLeave={(event) => {
                        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
                            setIsDragOver(false);
                        }
                    }}
                    onDrop={dropFile}
                    className={cn(
                        "m-0 flex min-w-0 flex-col items-center justify-center gap-2 rounded-md border-2 border-dashed px-3 py-4 text-center text-sm text-muted-foreground transition-colors",
                        isDragOver
                            ? "border-wafuu-kin bg-wafuu-kin/10"
                            : "border-wafuu-border bg-background",
                    )}
                >
                    <legend className="sr-only">棋譜のファイル</legend>
                    <span className="font-medium text-wafuu-sumi">ファイルをここに落とす</span>
                    <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        disabled={isBusy}
                        onClick={() => fileInputRef.current?.click()}
                    >
                        ファイルを選ぶ
                    </Button>
                    <span className="text-xs">{ACCEPT_LABEL}</span>
                    <input
                        ref={fileInputRef}
                        type="file"
                        accept={STUDY_FILE_ACCEPT}
                        onChange={(event) => {
                            const input = event.target;
                            const file = input.files?.[0];
                            // 同じファイルを続けて選び直しても change が発火するよう、選択を消しておく。
                            input.value = "";
                            if (file) void readFile(file);
                        }}
                        className="sr-only"
                        aria-label={`棋譜のファイル（${STUDY_FILE_ACCEPT.split(",").join(" / ")}）`}
                        tabIndex={-1}
                    />
                </fieldset>
            </div>
            {error && (
                <p role="alert" className="text-sm text-destructive">
                    {error}
                </p>
            )}
            <Button type="submit" disabled={isBusy || !text.trim()} className="sm:self-start">
                {isBusy ? "取り込み中…" : submitLabel}
            </Button>
            <p className="text-xs text-muted-foreground">{storageNote}</p>
        </form>
    );
}

/**
 * 棋譜なしで、平手の開始局面から研究ノートを作るボタン。盤で手を指して変化を足していく使い方の入口。
 */
export function StudyStartFromHirateButton({
    onImport,
    className,
}: {
    onImport: (source: StudyKifuSource) => Promise<void>;
    className?: string;
}): ReactElement {
    const [error, setError] = useState<string | null>(null);
    const [isBusy, setIsBusy] = useState(false);
    const start = async (): Promise<void> => {
        if (isBusy) return;
        setIsBusy(true);
        setError(null);
        try {
            await onImport({ kind: "moves", startSfen: STUDY_HIRATE_SFEN, moves: [] });
        } catch (failure) {
            setError(failure instanceof Error ? failure.message : "研究ノートを作れませんでした");
        } finally {
            setIsBusy(false);
        }
    };
    return (
        <div className={cn("flex flex-col gap-1", className)}>
            <Button type="button" variant="outline" disabled={isBusy} onClick={() => void start()}>
                {isBusy ? "作成中…" : "平手の盤から始める"}
            </Button>
            {error && (
                <p role="alert" className="text-sm text-destructive">
                    {error}
                </p>
            )}
        </div>
    );
}
