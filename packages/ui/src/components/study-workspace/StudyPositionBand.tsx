import type { StudyScore } from "@shogi/app-core";
import { cn } from "@shogi/design-system";
import type { ReactElement, ReactNode } from "react";
import { useId } from "react";
import { RamRunningIcon } from "../ram-running-icon";
import { PlayIcon } from "./StudyIcons";
import { type StudyReadMode, StudyReadModeGroup } from "./StudyReadModeGroup";
import { formatStudyScore, studyScoreSide } from "./studyView";

/** 帯の 1 段に出す読み（最善手・評価値・深さ）。 */
export interface StudyBandLine {
    /** この局面から指す最善手の表記（例: `☗2五歩(26)`）。 */
    bestMove: string | null;
    score: StudyScore | null;
    depth: number | null;
    /** 表示中の AI とは別の AI の値（評価値グラフの丸と同じく灰色で出す）。 */
    otherAi: boolean;
}

/**
 * 局面のこの読みと、読み方のグループ（PC は候補手の欄の上、スマートフォンは局面の移動の下）。
 * 読んでいる間は左でラムが走り、上の段に今の読み、前に深く読んだ記録がそれより深ければ下の段に記録を
 * 出す。読んでいないときは記録を上の段に出す。高さと右側の幅は固定し、読み始め・読み終わり・桁数の変化で
 * 並びが動かないようにする。
 */
export function StudyPositionBand({
    live,
    record,
    reading,
    notice = null,
    awaitingFirstReading = false,
    readMode,
    onPlayRecord,
}: {
    /** この局面を読んでいる途中の値。読んでいなければ null（途中の値がまだ無ければ、各欄が null）。 */
    live: StudyBandLine | null;
    /** 保存してある、この局面のいちばん深い読み。無ければ null。 */
    record: StudyBandLine | null;
    /** この局面を読んでいる（読み始めるところも含む）。 */
    reading: boolean;
    /** 読んでいないときに下の段に出す知らせ（読み終えたこと など）。止まったラムを添える。 */
    notice?: string | null;
    /** 読み始めたが、最初の読みがまだ届いていない（AI の読み込み・エンジンの起動を待っている）。 */
    awaitingFirstReading?: boolean;
    /** 渡さなければ読み方のグループを出さない（編集できないとき）。`status` は画面読み上げ向けの状態。 */
    readMode?: {
        mode: StudyReadMode;
        onChange: (mode: StudyReadMode) => void;
        disabled: Partial<Record<StudyReadMode, boolean>>;
        status: string | null;
    };
    /**
     * 記録の段を押したとき、その読み筋を盤で見せる。読んでいる間は候補手の欄に記録を出さないので、
     * 記録の読み筋はここから見る。読み筋が無ければ渡さない。
     */
    onPlayRecord?: () => void;
}): ReactElement {
    const statusId = useId();
    // 評価値の無い結果でも、最善手があれば記録として出す。
    const hasRecord = record !== null && (record.score !== null || record.bestMove !== null);
    const recordAhead =
        hasRecord && (live === null || live.depth === null || (record.depth ?? 0) > live.depth);
    const shownNotice = reading ? null : notice;
    // 記録の段に ▷ が付くときは、ほかの段にも同じ幅を空けて、評価値と深さの右端をそろえる。
    const playSlot = hasRecord && onPlayRecord !== undefined;
    const upper = reading ? (
        <BandRow
            label={
                <>
                    いま
                    {/* ラムは読み上げないので、上の段が今の読みだと名前で伝える。 */}
                    <span className="sr-only">（今の読み）</span>
                </>
            }
            line={live}
            empty={awaitingFirstReading ? "準備中…" : "読み中…"}
            primary
            playSlot={playSlot}
        />
    ) : (
        <BandRow
            label={hasRecord ? "記録" : null}
            line={record}
            empty={hasRecord ? "—" : "未解析"}
            primary
            playSlot={playSlot}
            onPlay={hasRecord ? onPlayRecord : undefined}
        />
    );
    // 読んでいる間は走るラム、読み終えた知らせには止まったラム。読んでいないときは出さない。
    const ram = reading ? "running" : shownNotice !== null ? "stopped" : null;
    return (
        <div className="flex flex-col gap-1.5">
            <div className="flex h-14 items-center rounded-lg border border-border bg-wafuu-washi-warm text-sm">
                {ram && (
                    <RamRunningIcon
                        running={ram === "running"}
                        className="ml-2.5 max-[359px]:ml-2"
                    />
                )}
                {/* 読んでいる間に何度も変わるので、読み上げの領域にはしない（帯全体が繰り返し読み上げられて
                    しまう）。 */}
                <output
                    aria-label="この局面の最善手"
                    aria-live="off"
                    className="flex min-w-0 flex-1 flex-col justify-center gap-0.5 pl-2.5 pr-2 max-[359px]:pl-2 max-[359px]:pr-1.5"
                >
                    {upper}
                    {/* 記録のある局面を読んでいる間は、下の段が空でも場所を取る（今の読みが記録を超えて
                        記録が消えたときに、上の段が動かないように）。それ以外は 1 段を上下の中央に置く。 */}
                    {shownNotice !== null ? (
                        <span className="truncate text-xs text-wafuu-sumi" title={shownNotice}>
                            {shownNotice}
                        </span>
                    ) : !reading || !hasRecord ? null : recordAhead ? (
                        <BandRow
                            label="記録"
                            line={record}
                            empty="—"
                            primary={false}
                            playSlot={playSlot}
                            onPlay={onPlayRecord}
                        />
                    ) : (
                        <span aria-hidden="true" className="h-[1.1rem]" />
                    )}
                </output>
            </div>
            {readMode && (
                <div>
                    <StudyReadModeGroup
                        describedBy={statusId}
                        mode={readMode.mode}
                        onChange={readMode.onChange}
                        disabled={readMode.disabled}
                    />
                    <span id={statusId} className="sr-only">
                        {readMode.status ?? ""}
                    </span>
                </div>
            )}
        </div>
    );
}

function BandRow({
    label,
    line,
    empty,
    primary,
    playSlot,
    onPlay,
}: {
    label: ReactNode;
    line: StudyBandLine | null;
    /** 最善手が無いときに出す言葉。 */
    empty: string;
    /** 上の段（主に見る値）。下の段は控えめに出す。 */
    primary: boolean;
    /** ▷ の幅を空けておく（同じ帯のどこかの段に ▷ が付くとき）。 */
    playSlot: boolean;
    /** 渡すと段全体を押せるようにし、読み筋を盤で見せる。 */
    onPlay?: () => void;
}): ReactElement {
    const scoreText = formatStudyScore(line?.score ?? null);
    const side = studyScoreSide(line?.score ?? null);
    const bestMove = line?.bestMove ?? null;
    const rowClass = cn(
        "flex min-w-0 items-baseline gap-1.5 max-[359px]:gap-1",
        !primary && "text-muted-foreground",
    );
    const content = (
        <>
            {label !== null && (
                <span className="flex w-[2.5em] shrink-0 text-[11px] text-muted-foreground max-[359px]:w-[2.2em] max-[359px]:text-[10px]">
                    {label}
                </span>
            )}
            {/* 移動元（「(26)」）は省く（狭い画面で手そのものを切らさないため）。 */}
            <span
                className={cn(
                    "min-w-0 truncate",
                    // 押せる段は、手に薄い下線を引いて示す。
                    onPlay && bestMove && "underline decoration-border underline-offset-4",
                    primary
                        ? bestMove
                            ? "text-wafuu-sumi"
                            : "text-muted-foreground"
                        : "max-[399px]:text-xs",
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
                                : line.otherAi
                                  ? "text-muted-foreground max-[399px]:text-xs"
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
            {/* 幅の狭い画面では手の表記を優先して印の幅を空けない（段全体は押せる）。 */}
            {(playSlot || onPlay) && (
                <span
                    aria-hidden="true"
                    className="flex w-2.5 shrink-0 self-center max-[359px]:hidden"
                >
                    {onPlay && <PlayIcon className="h-2.5 w-2.5 text-wafuu-ai" />}
                </span>
            )}
            {onPlay && <span className="sr-only">（読み筋を盤で見る）</span>}
        </>
    );
    if (!onPlay) return <span className={rowClass}>{content}</span>;
    return (
        <button
            type="button"
            onClick={onPlay}
            className={cn(
                rowClass,
                "-mx-1 rounded-sm px-1 text-left hover:bg-wafuu-washi active:bg-wafuu-washi focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
            )}
        >
            {content}
        </button>
    );
}
