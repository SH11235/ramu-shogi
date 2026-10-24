/**
 * 終局後の棋譜のコピー。何の形式で写すかを分かるようにし、形式（KIF・CSA・USI）ごとのボタンで選ばせる。
 * PC は結果の欄・終局のダイアログにボタンを並べ、スマホは下の行のボタンから開くシートで選ぶ。
 */

import { movesToCsa, STUDY_HIRATE_SFEN } from "@shogi/app-core";
import { cn } from "@shogi/design-system";
import type { ReactElement } from "react";
import { useState } from "react";
import { Button } from "../../button";
import { BottomSheet } from "../components/BottomSheet";
import { useNavigation } from "../contexts/NavigationContext";
import { useShogiMatchConfig } from "../ShogiMatchContext";
import { PLAY_OUTLINE_BUTTON } from "./playStyles";

type KifuFormat = "kif" | "csa" | "usi";

const FORMATS: ReadonlyArray<{ id: KifuFormat; label: string; description: string }> = [
    { id: "kif", label: "KIF", description: "多くの将棋ソフト・サイトで読める棋譜" },
    { id: "csa", label: "CSA", description: "コンピュータ将棋の対局で使う形式" },
    { id: "usi", label: "USI", description: "開始局面と指し手（USI の position の形）" },
];

/** CSA にできない棋譜（平手でない開始局面・パスを含む）のときの説明。 */
const CSA_UNAVAILABLE = "CSA は、平手から指したパスの無い棋譜だけ写せます";

/** 形式ごとの棋譜の文字列を作り、クリップボードに写す。 */
function useKifuCopy(): {
    copiedFormat: KifuFormat | null;
    csaAvailable: boolean;
    copy: (format: KifuFormat) => void;
} {
    const { handleCopyKif, kifMoves, kifuTree } = useNavigation();
    const { play } = useShogiMatchConfig();
    const [copiedFormat, setCopiedFormat] = useState<KifuFormat | null>(null);
    const startSfen = (kifuTree?.startSfen ?? "startpos").replace(/^sfen\s+/, "");
    const isHirate = startSfen === "startpos" || startSfen === STUDY_HIRATE_SFEN;
    const moves = kifMoves.map((move) => move.usiMove);
    const csaAvailable = isHirate && !moves.some((move) => move.toLowerCase() === "pass");

    const textOf = (format: KifuFormat): string | null => {
        if (format === "kif") return handleCopyKif();
        if (format === "usi") {
            const position = isHirate ? "position startpos" : `position sfen ${startSfen}`;
            return moves.length > 0 ? `${position} moves ${moves.join(" ")}` : position;
        }
        if (!csaAvailable) return null;
        try {
            return movesToCsa(moves, {
                senteName: play?.playerNames.sente,
                goteName: play?.playerNames.gote,
            });
        } catch {
            return null;
        }
    };

    const copy = (format: KifuFormat) => {
        const text = textOf(format);
        if (text === null) return;
        void navigator.clipboard
            ?.writeText(text)
            .then(() => setCopiedFormat(format))
            .catch(() => setCopiedFormat(null));
    };
    return { copiedFormat, csaAvailable, copy };
}

const labelOf = (format: KifuFormat): string =>
    FORMATS.find((candidate) => candidate.id === format)?.label ?? format;

/** 「棋譜をコピー [KIF] [CSA] [USI]」の 1 行（PC の結果の欄・終局のダイアログ）。 */
export function KifuCopyButtons({ className }: { className?: string }): ReactElement {
    const { copiedFormat, csaAvailable, copy } = useKifuCopy();
    return (
        <div className={cn("flex flex-wrap items-center gap-x-2 gap-y-1", className)}>
            <span className="text-sm text-wafuu-sumi-light">棋譜をコピー</span>
            {FORMATS.map((format) => {
                const disabled = format.id === "csa" && !csaAvailable;
                return (
                    <Button
                        key={format.id}
                        type="button"
                        variant="outline"
                        size="sm"
                        disabled={disabled}
                        title={disabled ? CSA_UNAVAILABLE : format.description}
                        aria-label={`${format.label} 形式でコピー`}
                        className={cn(
                            PLAY_OUTLINE_BUTTON,
                            "h-8 min-w-12 px-2 text-xs font-semibold",
                        )}
                        onClick={() => copy(format.id)}
                    >
                        {format.label}
                    </Button>
                );
            })}
            <span aria-live="polite" className="text-xs text-wafuu-sumi-light">
                {copiedFormat ? `${labelOf(copiedFormat)} をコピーしました` : ""}
            </span>
        </div>
    );
}

/**
 * スマホの下の行の「棋譜をコピー」。押すと形式を選ぶシートを開く（行にボタンを足さない）。
 */
export function KifuCopySheetButton({ className }: { className?: string }): ReactElement {
    const { copiedFormat, csaAvailable, copy } = useKifuCopy();
    const [open, setOpen] = useState(false);
    return (
        <>
            <Button
                type="button"
                variant="outline"
                className={cn(PLAY_OUTLINE_BUTTON, className)}
                onClick={() => setOpen(true)}
            >
                棋譜をコピー
            </Button>
            <BottomSheet open={open} onOpenChange={setOpen} title="棋譜をコピー" height="auto">
                <div className="flex flex-col gap-2 px-1 pb-4">
                    {FORMATS.map((format) => {
                        const disabled = format.id === "csa" && !csaAvailable;
                        return (
                            <button
                                key={format.id}
                                type="button"
                                disabled={disabled}
                                onClick={() => copy(format.id)}
                                className="flex min-h-12 items-center gap-3 rounded-md border border-wafuu-border bg-background px-3 text-left text-sm text-wafuu-sumi disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                            >
                                <span className="w-10 shrink-0 font-semibold">{format.label}</span>
                                <span className="min-w-0 flex-1 text-xs text-wafuu-sumi-light">
                                    {disabled ? CSA_UNAVAILABLE : format.description}
                                </span>
                                {copiedFormat === format.id && (
                                    <span className="shrink-0 text-xs text-wafuu-shu">
                                        コピーしました
                                    </span>
                                )}
                            </button>
                        );
                    })}
                </div>
            </BottomSheet>
        </>
    );
}
