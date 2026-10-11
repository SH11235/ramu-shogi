/**
 * いま見ている局面の候補手（解析結果）とコメント。盤面の下に置く。
 */

import {
    type KifuNode,
    STUDY_LIMITS,
    type StudyCandidate,
    type StudyNode,
    type StudyScore,
} from "@shogi/app-core";
import { cn } from "@shogi/design-system";
import type { ReactElement } from "react";
import { useEffect, useRef, useState } from "react";
import { Button } from "../button";
import { convertPvToDisplay } from "../shogi-match/utils/kifFormat";
import { StudyIconButton } from "./StudyIconButton";
import { AddBranchIcon, AnalyzeIcon, PlayIcon } from "./StudyIcons";
import { formatStudyScore, type StudyPositionResult, studyScoreSide } from "./studyView";

/** 読み筋を盤で見るときに渡す内容。 */
export interface StudyPvRequest {
    pv: string[];
    score: StudyScore | null;
}

interface StudyCandidatesPanelProps {
    /** いま見ている局面のノード。 */
    node: KifuNode;
    /** 保存されているノード（しおり・コメント・対局時の評価値）。 */
    stored: StudyNode | undefined;
    /** この局面の解析結果。無ければ null。 */
    positionResult: StudyPositionResult | null;
    analysisMode: "full" | "deep" | null;
    isPreparing: boolean;
    /** この局面を深く解析している途中経過。別の局面を解析中・解析していなければ null。 */
    liveDepth: number | null | undefined;
    onStartDeep: () => void;
    onCancel: () => void;
    onPreviewPv: (request: StudyPvRequest) => void;
    onAddPvAsVariation: (pv: string[]) => void;
    onCommentChange: (value: string) => void;
    className?: string;
}

const sideClass = (side: "sente" | "gote" | null): string =>
    side === "sente" ? "text-wafuu-shu" : side === "gote" ? "text-wafuu-ai" : "text-foreground";

/** 文字列を UTF-8 のバイト数の上限で切る（文字の途中では切らない）。 */
function clampUtf8(text: string, maxBytes: number): string {
    const encoder = new TextEncoder();
    if (encoder.encode(text).length <= maxBytes) return text;
    let result = "";
    let bytes = 0;
    for (const char of text) {
        const size = encoder.encode(char).length;
        if (bytes + size > maxBytes) break;
        result += char;
        bytes += size;
    }
    return result;
}

const COMMENT_SAVE_DELAY_MS = 700;

function CandidateRow({
    node,
    candidate,
    onPreviewPv,
    onAddPvAsVariation,
}: {
    node: KifuNode;
    candidate: StudyCandidate;
    onPreviewPv: (request: StudyPvRequest) => void;
    onAddPvAsVariation: (pv: string[]) => void;
}): ReactElement {
    const display = convertPvToDisplay(candidate.pv, node.positionAfter);
    const [first, ...rest] = display;
    const hasPv = display.length > 0;
    return (
        <li className="flex items-start gap-2 rounded-md px-1 py-1">
            <span className="mt-0.5 w-4 shrink-0 text-center font-mono text-xs tabular-nums text-muted-foreground">
                {candidate.rank}
            </span>
            <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                <div className="flex items-baseline gap-2">
                    <span className="truncate text-sm font-medium text-wafuu-sumi">
                        {first?.displayText ?? "（読み筋なし）"}
                    </span>
                    <span
                        className={cn(
                            "shrink-0 font-mono text-sm tabular-nums",
                            sideClass(studyScoreSide(candidate.score)),
                        )}
                    >
                        {formatStudyScore(candidate.score)}
                    </span>
                </div>
                {rest.length > 0 && (
                    <p className="line-clamp-2 text-xs text-muted-foreground">
                        {rest.map((move) => move.displayText).join(" ")}
                    </p>
                )}
            </div>
            {hasPv && (
                <div className="flex shrink-0 items-center">
                    <StudyIconButton
                        label={`候補 ${candidate.rank} の読み筋を盤で見る`}
                        onClick={() => onPreviewPv({ pv: candidate.pv, score: candidate.score })}
                    >
                        <PlayIcon />
                    </StudyIconButton>
                    <StudyIconButton
                        label={`候補 ${candidate.rank} の読み筋を変化として追加`}
                        onClick={() => onAddPvAsVariation(candidate.pv)}
                    >
                        <AddBranchIcon />
                    </StudyIconButton>
                </div>
            )}
        </li>
    );
}

function CommentBox({
    value,
    onChange,
}: {
    value: string;
    onChange: (value: string) => void;
}): ReactElement {
    const [draft, setDraft] = useState(value);
    const lastSavedRef = useRef(value);
    const draftRef = useRef(value);
    const onChangeRef = useRef(onChange);
    useEffect(() => {
        onChangeRef.current = onChange;
    }, [onChange]);

    // 他のタブ・端末で変わったコメントを取り込む（こちらで編集中でなければ）。
    useEffect(() => {
        if (value === lastSavedRef.current) return;
        if (draftRef.current === lastSavedRef.current) {
            draftRef.current = value;
            setDraft(value);
        }
        lastSavedRef.current = value;
    }, [value]);

    const save = (): void => {
        if (draftRef.current === lastSavedRef.current) return;
        lastSavedRef.current = draftRef.current;
        onChangeRef.current(draftRef.current);
    };
    const saveRef = useRef(save);
    saveRef.current = save;

    // 入力が止まったら保存する。
    useEffect(() => {
        if (draft === lastSavedRef.current) return;
        const timer = setTimeout(() => saveRef.current(), COMMENT_SAVE_DELAY_MS);
        return () => clearTimeout(timer);
    }, [draft]);

    // 別の局面へ移るとき（このコンポーネントが作り直されるとき）に、書きかけを保存する。
    useEffect(() => () => saveRef.current(), []);

    return (
        <label className="flex flex-col gap-1 text-xs text-muted-foreground">
            コメント
            <textarea
                value={draft}
                onChange={(event) => {
                    const next = clampUtf8(event.target.value, STUDY_LIMITS.commentBytes);
                    draftRef.current = next;
                    setDraft(next);
                }}
                onBlur={save}
                rows={2}
                placeholder="この手について気づいたことを書けます（自動で保存されます）"
                className="w-full resize-y rounded-md border border-border bg-background p-2 text-base text-foreground placeholder:text-muted-foreground/70 focus:outline-none focus:ring-2 focus:ring-ring md:text-sm"
            />
        </label>
    );
}

export function StudyCandidatesPanel({
    node,
    stored,
    positionResult,
    analysisMode,
    isPreparing,
    liveDepth,
    onStartDeep,
    onCancel,
    onPreviewPv,
    onAddPvAsVariation,
    onCommentChange,
    className,
}: StudyCandidatesPanelProps): ReactElement {
    const isDeepHere = liveDepth !== undefined;
    const source = stored?.source ?? null;
    const sourceText = formatStudyScore(source?.score);
    const resultNote = positionResult
        ? [
              positionResult.layer.display.label,
              `深さ ${positionResult.result.depth}`,
              ...(positionResult.fromDisplayLayer ? [] : ["深く解析した結果"]),
              ...(positionResult.result.completion === "aborted" ? ["途中まで"] : []),
          ].join("・")
        : null;

    return (
        <section
            aria-label="候補手とコメント"
            className={cn(
                "flex flex-col gap-3 rounded-xl border border-wafuu-border bg-card p-3 shadow-sm",
                className,
            )}
        >
            <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex min-w-0 flex-col">
                    <h2 className="font-display text-base font-semibold text-wafuu-sumi">候補手</h2>
                    {resultNote && (
                        <span className="truncate text-xs text-muted-foreground">{resultNote}</span>
                    )}
                </div>
                {isDeepHere ? (
                    <div className="flex items-center gap-2">
                        <output aria-live="polite" className="text-xs text-muted-foreground">
                            深く解析中{liveDepth ? `（深さ ${liveDepth}）` : ""}
                        </output>
                        <Button type="button" variant="outline" size="sm" onClick={onCancel}>
                            中止
                        </Button>
                    </div>
                ) : (
                    <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="gap-1.5"
                        onClick={onStartDeep}
                        disabled={isPreparing || analysisMode !== null}
                    >
                        <AnalyzeIcon />
                        この局面を深く解析
                    </Button>
                )}
            </div>

            {positionResult ? (
                <ol className="flex flex-col">
                    {positionResult.result.candidates.map((candidate) => (
                        <CandidateRow
                            key={candidate.rank}
                            node={node}
                            candidate={candidate}
                            onPreviewPv={onPreviewPv}
                            onAddPvAsVariation={onAddPvAsVariation}
                        />
                    ))}
                </ol>
            ) : (
                <p className="text-sm text-muted-foreground">この局面はまだ解析していません。</p>
            )}

            {source && (sourceText !== "" || source.pv) && (
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1 border-t border-border pt-2 text-xs text-muted-foreground">
                    <span>対局時の評価値</span>
                    {sourceText !== "" && (
                        <span
                            className={cn(
                                "font-mono tabular-nums",
                                sideClass(studyScoreSide(source.score)),
                            )}
                        >
                            {sourceText}
                        </span>
                    )}
                    {source.pv && source.pv.length > 0 && (
                        <button
                            type="button"
                            onClick={() =>
                                onPreviewPv({ pv: source.pv ?? [], score: source.score })
                            }
                            className="rounded-sm text-wafuu-ai underline underline-offset-2 hover:text-wafuu-ai-light focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        >
                            対局時の読み筋を見る
                        </button>
                    )}
                </div>
            )}

            <CommentBox key={node.id} value={stored?.comment ?? ""} onChange={onCommentChange} />
        </section>
    );
}
