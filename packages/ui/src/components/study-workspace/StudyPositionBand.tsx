import type { StudyHighlightKind, StudyScore } from "@shogi/app-core";
import { cn } from "@shogi/design-system";
import type { ReactElement } from "react";
import { useId } from "react";
import { RamRunningIcon } from "../ram-running-icon";
import { Switch } from "../switch";
import { formatStudyScore, studyScoreSide } from "./studyView";

export const STUDY_KIND_BADGE: Record<StudyHighlightKind, { label: string; className: string }> = {
    blunder: {
        label: "悪手",
        className: "border-study-blunder-border bg-study-blunder-bg text-study-blunder",
    },
    dubious: {
        label: "疑問手",
        className: "border-study-dubious-border bg-study-dubious-bg text-study-dubious",
    },
};

/**
 * スマートフォンで局面の移動の下に出す、いまの局面の 1 行（手・評価値・悪手かどうか）と「自動で読む」の
 * スイッチ。読みはどの表示を開いていても続くので、止める手段と読んだ値をどの表示でも同じ位置に出す。
 * 高さと右側の幅は固定し、読み始め・読み終わり・桁数の変化で並びが動かないようにする。
 */
export function StudyPositionBand({
    ply,
    moveLabel,
    kind,
    score,
    reading,
    autoAnalyze,
}: {
    /** 表示中の手順での位置。 */
    ply: number;
    moveLabel: string;
    kind: StudyHighlightKind | undefined;
    /** いま出す評価値（読んでいる途中の値、無ければ保存済みのいちばん深い読み）。 */
    score: StudyScore | null;
    /** この局面を読んでいる途中か。 */
    reading: boolean;
    /** 渡さなければスイッチを出さない（編集できないとき）。`status` は画面読み上げ向けの状態。 */
    autoAnalyze?: { enabled: boolean; onChange: (enabled: boolean) => void; status: string | null };
}): ReactElement {
    const switchId = useId();
    const statusId = useId();
    const scoreText = formatStudyScore(score);
    const side = studyScoreSide(score);
    return (
        <div className="flex h-10 items-center rounded-lg border border-wafuu-border bg-wafuu-washi-warm text-sm">
            {/* 評価値は読んでいる間に何度も変わるので、読み上げの領域にはしない（帯全体が繰り返し
                読み上げられてしまう）。 */}
            <output
                aria-label="いまの局面"
                aria-live="off"
                className="flex min-w-0 flex-1 items-center gap-1.5 pl-2.5 pr-2 max-[359px]:gap-1 max-[359px]:pl-2"
            >
                <span className="shrink-0 tabular-nums text-muted-foreground max-[359px]:text-xs">
                    {ply === 0 ? "開始局面" : `${ply}手目`}
                </span>
                {/* 移動元（「(83)」）は省く（盤で直前の手は分かり、狭い画面で手そのものを切らさないため）。 */}
                {ply > 0 && (
                    <span className="min-w-0 truncate text-wafuu-sumi" title={moveLabel}>
                        {moveLabel.replace(/\(\d\d\)$/, "")}
                    </span>
                )}
                <span className="ml-auto flex shrink-0 items-center gap-1.5 max-[359px]:gap-1">
                    {/* 棋譜の欄と同じ 1 文字の印にする（狭い画面で手の表記を切らさないため）。 */}
                    {kind && (
                        <span
                            role="img"
                            aria-label={STUDY_KIND_BADGE[kind].label}
                            title={STUDY_KIND_BADGE[kind].label}
                            className={cn(
                                "flex h-5 w-5 items-center justify-center rounded border text-xs font-medium leading-none",
                                STUDY_KIND_BADGE[kind].className,
                            )}
                        >
                            {STUDY_KIND_BADGE[kind].label.slice(0, 1)}
                        </span>
                    )}
                    <span
                        className={cn(
                            "min-w-[5ch] whitespace-nowrap text-right font-mono tabular-nums max-[359px]:text-xs",
                            scoreText === ""
                                ? "text-muted-foreground"
                                : side === "sente"
                                  ? "text-wafuu-shu"
                                  : side === "gote"
                                    ? "text-wafuu-ai"
                                    : "text-foreground",
                        )}
                    >
                        {scoreText || "—"}
                    </span>
                </span>
            </output>
            {autoAnalyze && (
                // 名前・ラム・スイッチの全体を押せる範囲にする（指で押しやすいように）。ラムは止まって
                // いる間も透明にして幅を取る。
                <label
                    htmlFor={switchId}
                    className="flex h-full shrink-0 cursor-pointer items-center gap-1.5 border-l border-wafuu-border pl-2 pr-2.5 max-[359px]:gap-1 max-[359px]:px-1.5"
                >
                    <RamRunningIcon
                        dotSize={1}
                        className={cn("max-[359px]:hidden", !reading && "invisible")}
                    />
                    <span className="text-xs font-medium text-wafuu-sumi">自動で読む</span>
                    <Switch
                        id={switchId}
                        aria-describedby={statusId}
                        checked={autoAnalyze.enabled}
                        onCheckedChange={autoAnalyze.onChange}
                    />
                </label>
            )}
            {/* スイッチの名前（「自動で読む」）に混ざらないよう、状態の説明は label の外に置く。 */}
            {autoAnalyze && (
                <span id={statusId} className="sr-only">
                    {autoAnalyze.status ?? ""}
                </span>
            )}
        </div>
    );
}
