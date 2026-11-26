import type { StudyScore } from "@shogi/app-core";
import { cn } from "@shogi/design-system";
import type { ReactElement } from "react";
import { useId } from "react";
import { RamRunningIcon } from "../ram-running-icon";
import { Switch } from "../switch";
import { formatStudyScore, studyScoreSide } from "./studyView";

/**
 * スマートフォンで局面の移動の下に出す、この局面の最善手・評価値・深さの 1 行と「自動で読む」のスイッチ。
 * 読みはどの表示を開いていても続くので、止める手段と読みの進み具合をどの表示でも同じ位置に出す。
 * 高さと右側の幅は固定し、読み始め・読み終わり・桁数の変化で並びが動かないようにする。
 */
export function StudyPositionBand({
    bestMove,
    score,
    depth,
    reading,
    autoAnalyze,
}: {
    /** この局面から指す最善手の表記（例: `☗2五歩(26)`）。読みが無ければ null。 */
    bestMove: string | null;
    score: StudyScore | null;
    /** 最善手と評価値を出した読みの深さ。 */
    depth: number | null;
    /** この局面を読んでいる途中か（最善手・評価値は読みに連れて変わる）。 */
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
            {/* 読んでいる間に何度も変わるので、読み上げの領域にはしない（帯全体が繰り返し読み上げられて
                しまう）。 */}
            <output
                aria-label="この局面の最善手"
                aria-live="off"
                className="flex min-w-0 flex-1 items-center gap-1.5 pl-2.5 pr-2 max-[359px]:gap-1 max-[359px]:pl-2"
            >
                {/* 移動元（「(26)」）は省く（狭い画面で手そのものを切らさないため）。 */}
                <span
                    className={cn(
                        "min-w-0 truncate",
                        bestMove ? "text-wafuu-sumi" : "text-muted-foreground",
                    )}
                    title={bestMove ?? undefined}
                >
                    {bestMove
                        ? bestMove.replace(/\(\d\d\)$/, "")
                        : score === null && depth === null
                          ? reading
                              ? "読み中…"
                              : "未解析"
                          : "—"}
                </span>
                <span className="ml-auto flex shrink-0 items-baseline gap-1.5 max-[399px]:flex-col max-[399px]:items-end max-[399px]:gap-0">
                    <span
                        className={cn(
                            "min-w-[5ch] whitespace-nowrap text-right font-mono tabular-nums max-[399px]:text-xs max-[399px]:leading-tight",
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
                    {/* 読み始めの浅い値は振れるので、どれだけ読んだ値かを添える。幅は 2 桁の深さで固定する。 */}
                    <span className="min-w-[3.75em] whitespace-nowrap text-xs tabular-nums text-muted-foreground max-[399px]:text-right max-[399px]:leading-tight">
                        {depth !== null && `深さ ${depth}`}
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
