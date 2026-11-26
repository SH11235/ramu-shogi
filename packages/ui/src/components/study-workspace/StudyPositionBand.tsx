import type { StudyScore } from "@shogi/app-core";
import { cn } from "@shogi/design-system";
import type { ReactElement, ReactNode } from "react";
import { useId } from "react";
import { RamRunningIcon } from "../ram-running-icon";
import { Switch } from "../switch";
import { formatStudyScore, studyScoreSide } from "./studyView";

/** 帯の 1 段に出す読み（最善手・評価値・深さ）。 */
export interface StudyBandLine {
    /** この局面から指す最善手の表記（例: `☗2五歩(26)`）。 */
    bestMove: string | null;
    score: StudyScore | null;
    depth: number | null;
}

/**
 * スマートフォンで局面の移動の下に出す、この局面の読みと「自動で読む」のスイッチ。
 * 読んでいる間は上の段に今の読み（走るラムが目印）、前に深く読んだ記録がそれより深ければ下の段に記録を
 * 出す。読んでいないときは記録を上の段に出す。高さと右側の幅は固定し、読み始め・読み終わり・桁数の変化で
 * 並びが動かないようにする。
 */
export function StudyPositionBand({
    live,
    record,
    reading,
    showRam,
    autoAnalyze,
}: {
    /** この局面を読んでいる途中の値。読んでいなければ null（途中の値がまだ無ければ、各欄が null）。 */
    live: StudyBandLine | null;
    /** 保存してある、この局面のいちばん深い読み。無ければ null。 */
    record: StudyBandLine | null;
    /** この局面を読んでいる（読み始めるところも含む）。 */
    reading: boolean;
    /** 今の読みの段にラムを出す（自動で読む読みだけ。ほかの読みは「いま」と書く）。 */
    showRam: boolean;
    /** 渡さなければスイッチを出さない（編集できないとき）。`status` は画面読み上げ向けの状態。 */
    autoAnalyze?: { enabled: boolean; onChange: (enabled: boolean) => void; status: string | null };
}): ReactElement {
    const switchId = useId();
    const statusId = useId();
    const recordAhead =
        record !== null &&
        record.score !== null &&
        (live === null || live.depth === null || (record.depth ?? 0) > live.depth);
    const upper = reading ? (
        <BandRow
            label={
                showRam ? (
                    <>
                        <RamRunningIcon dotSize={1} />
                        {/* ラムは読み上げないので、上の段が今の読みだと名前で伝える。 */}
                        <span className="sr-only">今の読み</span>
                    </>
                ) : (
                    "いま"
                )
            }
            line={live}
            empty="読み中…"
            primary
        />
    ) : (
        <BandRow
            label={record?.score ? "記録" : null}
            line={record}
            empty={record?.score ? "—" : "未解析"}
            primary
        />
    );
    return (
        <div className="flex h-14 items-center rounded-lg border border-wafuu-border bg-wafuu-washi-warm text-sm">
            {/* 読んでいる間に何度も変わるので、読み上げの領域にはしない（帯全体が繰り返し読み上げられて
                しまう）。 */}
            <output
                aria-label="この局面の最善手"
                aria-live="off"
                className="flex min-w-0 flex-1 flex-col justify-center gap-0.5 pl-2.5 pr-2 max-[359px]:pl-2 max-[359px]:pr-1.5"
            >
                {upper}
                {/* 下の段は空でも高さを取る（記録が出る・消えるたびに帯が伸び縮みしないように）。 */}
                {reading && recordAhead ? (
                    <BandRow label="記録" line={record} empty="—" primary={false} />
                ) : (
                    <span aria-hidden="true" className="h-[1.1rem]" />
                )}
            </output>
            {autoAnalyze && (
                // 名前とスイッチの全体を押せる範囲にする（指で押しやすいように）。
                <label
                    htmlFor={switchId}
                    className="flex h-full shrink-0 cursor-pointer items-center gap-1.5 border-l border-wafuu-border pl-2 pr-2.5 max-[359px]:gap-1 max-[359px]:px-1.5"
                >
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

function BandRow({
    label,
    line,
    empty,
    primary,
}: {
    label: ReactNode;
    line: StudyBandLine | null;
    /** 最善手が無いときに出す言葉。 */
    empty: string;
    /** 上の段（主に見る値）。下の段は控えめに出す。 */
    primary: boolean;
}): ReactElement {
    const scoreText = formatStudyScore(line?.score ?? null);
    const side = studyScoreSide(line?.score ?? null);
    const bestMove = line?.bestMove ?? null;
    return (
        <span
            className={cn(
                "flex min-w-0 items-baseline gap-1.5 max-[359px]:gap-1",
                !primary && "text-muted-foreground",
            )}
        >
            {label !== null && (
                <span className="flex w-[2.5em] shrink-0 text-[11px] text-muted-foreground max-[359px]:w-[2.2em] max-[359px]:text-[10px]">
                    {label}
                </span>
            )}
            {/* 移動元（「(26)」）は省く（狭い画面で手そのものを切らさないため）。 */}
            <span
                className={cn(
                    "min-w-0 truncate",
                    primary && (bestMove ? "text-wafuu-sumi" : "text-muted-foreground"),
                )}
                title={bestMove ?? undefined}
            >
                {bestMove ? bestMove.replace(/\(\d\d\)$/, "") : empty}
            </span>
            {line && scoreText !== "" && (
                <span className="ml-auto flex shrink-0 items-baseline gap-1.5 max-[359px]:gap-1">
                    <span
                        className={cn(
                            // 桁数が変わっても手の表記の切れる位置が動かないよう、幅を取っておく（幅の
                            // 狭い画面では手の表記を優先する）。
                            "min-w-[5ch] whitespace-nowrap text-right font-mono tabular-nums max-[399px]:min-w-0",
                            !primary
                                ? "text-xs"
                                : cn(
                                      "max-[399px]:text-xs",
                                      side === "sente"
                                          ? "text-wafuu-shu"
                                          : side === "gote"
                                            ? "text-wafuu-ai"
                                            : "text-foreground",
                                  ),
                        )}
                    >
                        {scoreText}
                    </span>
                    {/* 読み始めの浅い値は振れるので、どれだけ読んだ値かを添える。 */}
                    <span className="min-w-[3.75em] whitespace-nowrap text-xs tabular-nums text-muted-foreground max-[359px]:min-w-0">
                        {line.depth !== null && `深さ ${line.depth}`}
                    </span>
                </span>
            )}
        </span>
    );
}
