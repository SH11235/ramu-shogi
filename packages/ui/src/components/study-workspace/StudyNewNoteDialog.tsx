import {
    clampStudyTitle,
    copyStudyDocument,
    generateStudyId,
    STUDY_LIMITS,
    type StudyCopyRange,
    type StudyCopySummary,
    type StudyDocument,
    summarizeStudyCopy,
} from "@shogi/app-core";
import { cn } from "@shogi/design-system";
import type { ReactElement } from "react";
import { useId, useRef, useState } from "react";
import { Button } from "../button";
import {
    Dialog,
    DialogClose,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
} from "../dialog";
import { StudyImportForm } from "./StudyImportForm";
import type { StudyKifuSource } from "./studyImport";

type NewNoteTab = "note" | "import";

interface StudyNewNoteDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    doc: StudyDocument;
    /** いま見ている局面。 */
    nodeId: string;
    /** 表示中の手順（ルートから末端まで）。 */
    line: readonly string[];
    /** いまの局面の手数と指し手（「23手目 ☗2六歩(27)」、開始局面なら「開始局面」）。 */
    positionTitle: string;
    /** 写した文書を新しいノートとして保存して開く。失敗時は例外を投げると、その文言を出す。 */
    onCreateFromNote: (doc: StudyDocument) => Promise<void>;
    /** 読んだ棋譜・局面で新しいノートを作って開く。 */
    onImport: (source: StudyKifuSource) => Promise<void>;
    /** 作ったノートがどこに保存されるかの説明。 */
    storageNote?: string;
    /** 閉じたときにフォーカスを戻す先（メニューの中から開いたとき、開く前の項目は消えている）。 */
    fallbackFocusId?: string;
}

const TABS: ReadonlyArray<{ id: NewNoteTab; label: string }> = [
    { id: "note", label: "いまのノートから" },
    { id: "import", label: "棋譜・局面を読む" },
];

export function StudyNewNoteDialog({
    open,
    onOpenChange,
    fallbackFocusId,
    ...bodyProps
}: StudyNewNoteDialogProps): ReactElement {
    // 作っている間の印は、閉じても消えないここに持つ（閉じて開き直しても、保存を待たずに別のノートを
    // 作り始めさせない）。保存が止まっても閉じられるよう、閉じること自体は止めない。
    const [busy, setBusy] = useState(false);
    // 作れなかった理由も、開き直したフォームに出せるようここに持つ。
    const [createError, setCreateError] = useState<string | null>(null);
    const opener = useRef<HTMLElement | null>(null);
    return (
        <Dialog
            open={open}
            onOpenChange={(next) => {
                if (!next && !busy) setCreateError(null);
                onOpenChange(next);
            }}
        >
            <DialogContent
                className="flex max-h-[calc(100dvh-24px)] w-[min(560px,calc(100%-24px))] flex-col gap-4 overflow-y-auto"
                hasDescription
                // 開くボタンは Radix の Trigger ではないので、閉じたら開く前のフォーカスへ戻す。
                onOpenAutoFocus={() => {
                    opener.current =
                        document.activeElement instanceof HTMLElement
                            ? document.activeElement
                            : null;
                }}
                onCloseAutoFocus={(event) => {
                    const target =
                        (fallbackFocusId ? document.getElementById(fallbackFocusId) : null) ??
                        (opener.current?.isConnected ? opener.current : null);
                    if (!target) return;
                    event.preventDefault();
                    target.focus();
                }}
            >
                <DialogHeader>
                    <DialogTitle>新しい研究ノート</DialogTitle>
                    <DialogDescription className="sr-only">
                        いまのノートから範囲を選んで写すか、棋譜・局面を読んで、新しいノートを作ります。
                    </DialogDescription>
                </DialogHeader>
                <NewNoteBody
                    {...bodyProps}
                    busy={busy}
                    onBusyChange={setBusy}
                    createError={createError}
                    onCreateErrorChange={setCreateError}
                    onDone={() => onOpenChange(false)}
                />
            </DialogContent>
        </Dialog>
    );
}

/** モーダルの中身。閉じるとアンマウントされるので、開くたびに最初の面・既定の選び方から始まる。 */
function NewNoteBody({
    storageNote,
    onImport,
    busy,
    onBusyChange,
    createError,
    onCreateErrorChange,
    onDone,
    ...noteProps
}: Omit<StudyNewNoteDialogProps, "open" | "onOpenChange" | "fallbackFocusId"> & {
    busy: boolean;
    onBusyChange: (busy: boolean) => void;
    createError: string | null;
    onCreateErrorChange: (error: string | null) => void;
    onDone: () => void;
}): ReactElement {
    const [tab, setTab] = useState<NewNoteTab>("note");
    const tabsId = useId();
    const tabRefs = useRef<Record<NewNoteTab, HTMLButtonElement | null>>({
        note: null,
        import: null,
    });
    const moveTab = (step: number): void => {
        const index = TABS.findIndex((item) => item.id === tab);
        const next = TABS[(index + step + TABS.length) % TABS.length].id;
        setTab(next);
        tabRefs.current[next]?.focus();
    };
    return (
        <>
            <div
                role="tablist"
                aria-label="作り方"
                className="flex shrink-0 overflow-hidden rounded-md border border-wafuu-border"
            >
                {TABS.map((item) => (
                    <button
                        key={item.id}
                        ref={(element) => {
                            tabRefs.current[item.id] = element;
                        }}
                        type="button"
                        role="tab"
                        id={`${tabsId}-${item.id}`}
                        aria-selected={tab === item.id}
                        aria-controls={`${tabsId}-${item.id}-panel`}
                        tabIndex={tab === item.id ? 0 : -1}
                        disabled={busy && tab !== item.id}
                        onClick={() => setTab(item.id)}
                        onKeyDown={(event) => {
                            if (busy) return;
                            if (event.key === "ArrowRight") moveTab(1);
                            else if (event.key === "ArrowLeft") moveTab(-1);
                            else return;
                            event.preventDefault();
                        }}
                        className={cn(
                            "flex-1 border-r border-wafuu-border px-2 py-2 text-sm text-wafuu-sumi-light transition-colors last:border-r-0 hover:bg-muted/60 focus-visible:relative focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50",
                            tab === item.id &&
                                "bg-wafuu-kin/20 font-bold text-wafuu-sumi hover:bg-wafuu-kin/20",
                        )}
                    >
                        {item.label}
                    </button>
                ))}
            </div>
            <div
                role="tabpanel"
                id={`${tabsId}-note-panel`}
                aria-labelledby={`${tabsId}-note`}
                hidden={tab !== "note"}
            >
                <FromNoteForm
                    {...noteProps}
                    busy={busy}
                    onBusyChange={onBusyChange}
                    error={createError}
                    onErrorChange={onCreateErrorChange}
                    onDone={onDone}
                />
            </div>
            <div
                role="tabpanel"
                id={`${tabsId}-import-panel`}
                aria-labelledby={`${tabsId}-import`}
                hidden={tab !== "import"}
                className="flex flex-col gap-3"
            >
                <StudyImportForm
                    onImport={async (source) => {
                        await onImport(source);
                        onDone();
                    }}
                    onBusyChange={onBusyChange}
                    busy={busy}
                    submitLabel="ノートを作る"
                    storageNote={storageNote}
                />
                <div className="flex justify-end">
                    <DialogClose asChild>
                        <Button type="button" variant="outline">
                            やめる
                        </Button>
                    </DialogClose>
                </div>
            </div>
        </>
    );
}

/** 元の表題に範囲の印を付ける。長い表題は、印が切り詰めで落ちないよう元の表題の側を削る。 */
function defaultTitle(title: string, suffix: string): string {
    const room = STUDY_LIMITS.titleLength - Array.from(suffix).length;
    return `${Array.from(clampStudyTitle(title)).slice(0, room).join("")}${suffix}`;
}

const RANGE_TITLE_SUFFIX: Record<StudyCopyRange, (ply: number) => string> = {
    upto: (ply) => (ply === 0 ? "（開始局面）" : `（${ply} 手目まで）`),
    all: () => "（写し）",
    here: (ply) => (ply === 0 ? "（開始局面から）" : `（${ply} 手目から）`),
};

function FromNoteForm({
    doc,
    nodeId,
    line,
    positionTitle,
    onCreateFromNote,
    busy,
    onBusyChange,
    error,
    onErrorChange: setError,
    onDone,
}: Omit<
    StudyNewNoteDialogProps,
    "open" | "onOpenChange" | "onImport" | "storageNote" | "fallbackFocusId"
> & {
    busy: boolean;
    onBusyChange: (busy: boolean) => void;
    error: string | null;
    onErrorChange: (error: string | null) => void;
    onDone: () => void;
}): ReactElement {
    const [range, setRange] = useState<StudyCopyRange>("upto");
    const [includeVariations, setIncludeVariations] = useState(true);
    const [includeAnalysis, setIncludeAnalysis] = useState(true);
    const [editedTitle, setEditedTitle] = useState<string | null>(null);
    const radioName = useId();
    const selection = { nodeId, line, range, includeVariations };
    const summary = summarizeStudyCopy(doc, selection);
    const ply = summary.currentPly;
    const title = editedTitle ?? defaultTitle(doc.title, RANGE_TITLE_SUFFIX[range](ply));
    const here = ply === 0 ? "開始局面" : `${ply} 手目`;

    const create = async (): Promise<void> => {
        if (busy) return;
        onBusyChange(true);
        setError(null);
        try {
            const copied = copyStudyDocument(doc, {
                ...selection,
                id: generateStudyId(),
                title,
                includeAnalysis,
            });
            await onCreateFromNote(copied);
            onDone();
        } catch (failure) {
            setError(failure instanceof Error ? failure.message : "ノートを作れませんでした");
        } finally {
            onBusyChange(false);
        }
    };

    const ranges: Array<{ id: StudyCopyRange; label: string; note: string }> = [
        {
            id: "upto",
            label: "開始局面からこの局面まで",
            note:
                ply === 0
                    ? "開始局面だけで始めます。"
                    : `${positionTitle} までの手順を本譜にします。`,
        },
        {
            id: "all",
            label: "ノートまるごと（この先も）",
            note: "この局面の先も含めて、いまのノートを写します。",
        },
        {
            id: "here",
            label: "この局面だけ",
            note: `${here}の局面を開始局面にして、手順なしで始めます。`,
        },
    ];
    const variationsDisabled = range === "here";

    return (
        <form
            className="flex flex-col gap-4"
            onSubmit={(event) => {
                event.preventDefault();
                void create();
            }}
        >
            <fieldset className="m-0 flex flex-col gap-1.5 border-0 p-0">
                <legend className="mb-1.5 p-0 text-xs text-muted-foreground">
                    どこまで入れるか
                </legend>
                {ranges.map((option) => (
                    <label
                        key={option.id}
                        className={cn(
                            "flex cursor-pointer items-start gap-2.5 rounded-md border px-3 py-2 text-sm",
                            range === option.id
                                ? "border-wafuu-sumi bg-wafuu-washi-warm ring-1 ring-inset ring-wafuu-sumi"
                                : "border-wafuu-border hover:bg-wafuu-washi-warm",
                        )}
                    >
                        <input
                            type="radio"
                            name={radioName}
                            className="mt-1 accent-wafuu-sumi"
                            checked={range === option.id}
                            onChange={() => setRange(option.id)}
                        />
                        <span className="flex min-w-0 flex-col">
                            <span className="font-medium text-wafuu-sumi">{option.label}</span>
                            <span className="text-xs text-muted-foreground">{option.note}</span>
                        </span>
                    </label>
                ))}
            </fieldset>

            <fieldset className="m-0 flex flex-col gap-2 border-0 p-0">
                <legend className="mb-1.5 p-0 text-xs text-muted-foreground">
                    一緒に入れるもの
                </legend>
                <label
                    className={cn(
                        "flex items-start gap-2 text-sm",
                        variationsDisabled
                            ? "cursor-not-allowed text-muted-foreground"
                            : "cursor-pointer text-wafuu-sumi",
                    )}
                >
                    <input
                        type="checkbox"
                        className="mt-1 accent-wafuu-sumi"
                        checked={includeVariations && !variationsDisabled}
                        disabled={variationsDisabled}
                        onChange={(event) => setIncludeVariations(event.target.checked)}
                    />
                    <span className="flex flex-col">
                        変化も入れる
                        <span className="text-xs text-muted-foreground">
                            {variationsDisabled
                                ? "この局面だけのときは、手順を入れません。"
                                : range === "upto"
                                  ? "この局面より手前で分かれた変化を、その先まで入れます。"
                                  : "すべての変化を入れます。"}
                        </span>
                    </span>
                </label>
                <label className="flex cursor-pointer items-start gap-2 text-sm text-wafuu-sumi">
                    <input
                        type="checkbox"
                        className="mt-1 accent-wafuu-sumi"
                        checked={includeAnalysis}
                        onChange={(event) => setIncludeAnalysis(event.target.checked)}
                    />
                    <span className="flex flex-col">
                        解析結果とコメントも入れる
                        <span className="text-xs text-muted-foreground">
                            {range === "here"
                                ? "この局面の評価値・候補手・コメントを写します。"
                                : "入れる局面の評価値・候補手・コメントを写します。"}
                        </span>
                    </span>
                </label>
            </fieldset>

            <CopyDiagram summary={summary} range={range} />
            <p className="rounded-md bg-muted/50 px-3 py-2 text-xs text-wafuu-sumi">
                <span className="font-medium">入るもの: </span>
                {describeCopy(summary, range, includeAnalysis)}
            </p>

            <label className="flex items-center gap-2 text-sm">
                <span className="shrink-0 text-xs text-muted-foreground">表題</span>
                <input
                    type="text"
                    aria-label="新しいノートの表題"
                    value={title}
                    onChange={(event) => setEditedTitle(event.target.value)}
                    className="h-10 min-w-0 flex-1 rounded-md border border-wafuu-border bg-background px-3 text-base text-wafuu-sumi focus:outline-none focus:ring-2 focus:ring-ring md:text-sm"
                />
            </label>

            {error && (
                <p role="alert" className="text-sm text-destructive">
                    {error}
                </p>
            )}
            <div className="flex justify-end gap-2">
                <DialogClose asChild>
                    <Button type="button" variant="outline">
                        やめる
                    </Button>
                </DialogClose>
                <Button type="submit" disabled={busy || title.trim() === ""}>
                    {busy ? "作成中…" : "ノートを作る"}
                </Button>
            </div>
        </form>
    );
}

/** 「入るもの」の文。図と同じことを言葉で言う（図を見られない読み上げにも届く）。 */
function describeCopy(
    summary: StudyCopySummary,
    range: StudyCopyRange,
    includeAnalysis: boolean,
): string {
    const here = summary.currentPly === 0 ? "開始局面" : `${summary.currentPly} 手目`;
    const parts: string[] = [];
    if (range === "here") {
        parts.push(`${here}の局面（開始局面にします）`);
    } else if (summary.plies === 0) {
        parts.push("開始局面");
    } else {
        parts.push(`開始局面から ${summary.plies} 手目までの手順`);
    }
    const { variationsBefore: before, variationsAfter: after } = summary;
    if (range !== "here" && before.total + after.total > 0) {
        if (before.included + after.included === 0) {
            parts.push("変化は入れない");
        } else if (range === "upto") {
            parts.push(`${here}より手前で分かれた変化 ${before.included} つ（その先まで）`);
        } else {
            parts.push(`すべての変化（${before.included + after.included} つ）`);
        }
    }
    parts.push(includeAnalysis ? "解析結果とコメント" : "解析結果とコメントは入れない（手順だけ）");
    return `${parts.join("、")}。`;
}

/**
 * 入る手順の図。本譜を開始局面・いまの局面・表示中の手順の末端の 3 点で描き、いまの局面より手前・先で
 * 分かれる変化を枝で描く。入るところを金、入らないところを薄い線にする。
 */
function CopyDiagram({
    summary,
    range,
}: {
    summary: StudyCopySummary;
    range: StudyCopyRange;
}): ReactElement {
    const { currentPly, linePlies, variationsBefore, variationsAfter } = summary;
    const startX = 36;
    const endX = 484;
    const mainY = 44;
    const branchY = 104;
    const hasBefore = currentPly > 0;
    const hasAfter = linePlies > currentPly;
    const currentX = !hasBefore ? startX : hasAfter ? 260 : endX;
    const on = "stroke-wafuu-kin";
    const off = "stroke-border";
    const dot = (included: boolean) => (included ? "fill-wafuu-kin" : "fill-muted");
    const beforeIn = range !== "here";
    const afterIn = range === "all";
    const branch = (fromX: number, count: number, included: boolean, label: string) => (
        <g>
            <path
                d={`M${fromX} ${mainY} L${fromX + 28} ${branchY} H${fromX + 120}`}
                className={cn("fill-none", included ? on : off)}
                strokeWidth={included ? 5 : 3}
                strokeLinecap="round"
                strokeLinejoin="round"
            />
            <circle cx={fromX + 120} cy={branchY} r={6} className={dot(included)} />
            <text
                x={fromX + 34}
                y={branchY + 22}
                className="fill-muted-foreground text-[13px]"
            >{`変化 ${count} つ（${label}）`}</text>
        </g>
    );
    return (
        <figure className="m-0 rounded-md border border-wafuu-border bg-background p-2">
            <svg viewBox="0 0 520 140" className="block h-auto w-full" aria-hidden="true">
                {hasBefore && (
                    <line
                        x1={startX}
                        y1={mainY}
                        x2={currentX}
                        y2={mainY}
                        className={beforeIn ? on : off}
                        strokeWidth={beforeIn ? 5 : 3}
                        strokeLinecap="round"
                    />
                )}
                {hasAfter && (
                    <line
                        x1={currentX}
                        y1={mainY}
                        x2={endX}
                        y2={mainY}
                        className={afterIn ? on : off}
                        strokeWidth={afterIn ? 5 : 3}
                        strokeLinecap="round"
                    />
                )}
                {hasBefore &&
                    variationsBefore.total > 0 &&
                    branch(
                        (startX + currentX) / 2 - 40,
                        variationsBefore.total,
                        variationsBefore.included > 0,
                        "手前で分岐",
                    )}
                {variationsAfter.total > 0 &&
                    branch(
                        hasAfter ? (currentX + endX) / 2 - 40 : currentX - 80,
                        variationsAfter.total,
                        variationsAfter.included > 0,
                        "先で分岐",
                    )}
                {hasBefore && <circle cx={startX} cy={mainY} r={7} className={dot(beforeIn)} />}
                {hasAfter && <circle cx={endX} cy={mainY} r={7} className={dot(afterIn)} />}
                <circle
                    cx={currentX}
                    cy={mainY}
                    r={8}
                    className={cn(dot(true), "stroke-wafuu-sumi")}
                    strokeWidth={2.5}
                />
                <text
                    x={currentX}
                    y={mainY - 18}
                    textAnchor={
                        currentX === startX ? "start" : currentX === endX ? "end" : "middle"
                    }
                    className="fill-wafuu-sumi text-[14px]"
                >
                    いまの局面
                </text>
                {hasBefore && (
                    <text
                        x={startX}
                        y={mainY + 26}
                        textAnchor="middle"
                        className="fill-muted-foreground text-[13px]"
                    >
                        開始
                    </text>
                )}
                {hasAfter && (
                    <text
                        x={endX}
                        y={mainY + 26}
                        textAnchor="end"
                        className="fill-muted-foreground text-[13px]"
                    >
                        {`${linePlies} 手目`}
                    </text>
                )}
            </svg>
        </figure>
    );
}
