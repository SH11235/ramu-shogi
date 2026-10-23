/**
 * 対局の設定（対局画面の最初の画面）。
 *
 * 「誰と・どちらの手番で・どのくらいの時間で指すか」を決めて「対局開始」を押す、だけの欄。
 * 細かい設定（秒単位の時間、変則ルール、評価関数の管理、表示）は詳細設定に置く。
 */

import type { Player } from "@shogi/app-core";
import { cn } from "@shogi/design-system";
import { SKILL_LEVEL_MAX } from "@shogi/engine-client";
import type { ReactElement, ReactNode } from "react";
import { useEffect, useEffectEvent, useState } from "react";
import { Button } from "../../button";
import { NativeSelect } from "../../native-select";
import { SoundToggle } from "../components/SoundToggle";
import { useMatchSettings } from "../contexts/MatchSettingsContext";
import type { ClockSettings } from "../hooks/useClockManager";
import { useShogiMatchConfig } from "../ShogiMatchContext";
import type { EngineSearchLimit } from "../types";
import { formatSearchLimit } from "../utils/searchLimits";
import { buildThreadOptions } from "../utils/threadOptions";
import { formatTimeRule, isSameClock } from "../utils/timeSettings";
import { PlaySearchLimitDialog, type SearchLimitKind } from "./PlaySearchLimitDialog";
import { isDialogRepresentable, PlayTimeDialog } from "./PlayTimeDialog";
import { PlayTimeRulesHelp } from "./PlayTimeRulesHelp";
import {
    PLAY_HEADING,
    PLAY_OUTLINE_BUTTON,
    PLAY_PRIMARY_BUTTON,
    PLAY_TEXT_LINK,
} from "./playStyles";
import {
    AI_MATCH_TIME_CHOICES,
    AI_TIME_CHOICES,
    clockAsChoice,
    MY_TIME_CHOICES,
    type PlayMatchKind,
    type TimeChoice,
    usePlaySetup,
} from "./usePlaySetup";

type SideChoice = Player | "random";

/**
 * 選べる開始局面。駒落ちは後手（上手）の駒を落とし、上手から指す
 * （オンライン対局の開始局面と同じ SFEN）。
 */
const START_POSITIONS: Array<{ id: string; label: string; sfen: string }> = [
    {
        id: "bishop",
        label: "角落ち",
        sfen: "lnsgkgsnl/1r7/ppppppppp/9/9/9/PPPPPPPPP/1B5R1/LNSGKGSNL w - 1",
    },
    {
        id: "rook",
        label: "飛車落ち",
        sfen: "lnsgkgsnl/7b1/ppppppppp/9/9/9/PPPPPPPPP/1B5R1/LNSGKGSNL w - 1",
    },
    {
        id: "rook-bishop",
        label: "飛車角落ち（二枚落ち）",
        sfen: "lnsgkgsnl/9/ppppppppp/9/9/9/PPPPPPPPP/1B5R1/LNSGKGSNL w - 1",
    },
];

/** 「簡易AI とすぐ指す」ときの考慮時間（1 秒）。 */
const QUICK_AI_TIME = AI_TIME_CHOICES[0];

function Segmented<T extends string>({
    label,
    rowLabel,
    labelAddon,
    wrapLabels,
    options,
    value,
    onChange,
    disabled,
}: {
    label: string;
    /** 行の形で並べるときの、左に出す短い項目名（読み上げは `label` のまま）。 */
    rowLabel?: string;
    /** 項目名の横に添える部品（説明の「?」など）。選べない間も押せる */
    labelAddon?: ReactNode;
    /** 選択肢の文言を 2 行に折り返してよい（「10分 秒読み30秒」をスマホの幅に収める） */
    wrapLabels?: boolean;
    options: Array<{ id: T; label: ReactNode }>;
    value: T | null;
    onChange: (id: T) => void;
    disabled?: boolean;
}): ReactElement {
    return (
        <fieldset
            className={cn("flex min-w-0", rowLabel ? ROW_CLASS : "flex-col")}
            disabled={disabled}
        >
            {/* legend は flex の子として並ばないので、行の形では見出しを別の要素で出す。
                legend の中の部品は、fieldset を disabled にしても押せる。 */}
            <legend
                className={
                    rowLabel
                        ? "sr-only"
                        : "flex items-center gap-1.5 pb-1.5 text-xs font-medium text-wafuu-sumi-light"
                }
            >
                {label}
                {!rowLabel && labelAddon}
            </legend>
            {rowLabel && (
                <span className={cn(ROW_LABEL_CLASS, "flex items-center gap-1")}>
                    <span aria-hidden>{rowLabel}</span>
                    {labelAddon}
                </span>
            )}
            <div
                className={cn(
                    "flex min-w-0 flex-1 flex-wrap gap-1.5",
                    rowLabel && "max-[359px]:gap-1",
                )}
            >
                {options.map((option) => {
                    const selected = option.id === value;
                    return (
                        <button
                            key={option.id}
                            type="button"
                            aria-pressed={selected}
                            onClick={() => onChange(option.id)}
                            className={cn(
                                // 幅 320〜390px 級の端末でも、時間の 4〜5 個の選択肢を 1 行に収める。
                                rowLabel
                                    ? "px-1.5 max-[399px]:px-1 max-[399px]:text-xs max-[359px]:px-0.5"
                                    : "px-2.5",
                                wrapLabels
                                    ? "whitespace-normal break-keep py-0.5 leading-tight max-[399px]:text-[11px]"
                                    : "whitespace-nowrap",
                                "min-h-10 flex-1 rounded-md border text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50 md:min-h-9 [@media(max-height:760px)]:md:min-h-8",
                                // 選んでいる項目は墨の枠で示す（朱・藍は、先手・後手の色に取っておく）。
                                selected
                                    ? "border-wafuu-sumi bg-wafuu-washi-warm font-semibold text-wafuu-sumi ring-1 ring-inset ring-wafuu-sumi"
                                    : "border-wafuu-border bg-background text-wafuu-sumi hover:bg-wafuu-washi-warm",
                            )}
                        >
                            {option.label}
                        </button>
                    );
                })}
            </div>
        </fieldset>
    );
}

/** 時間を数で決める項目（押すと時間だけを聞くダイアログを開く）。 */
const CUSTOM_TIME_ID = "custom";

/** 時間の選択肢と「指定」。いまの時間がどれにも当たらなければ、「指定」の所にその時間を書いて選ばれた状態にする。 */
const timeOptions = (choices: TimeChoice[], currentId: string | null, currentLabel: string) => [
    ...choices.map((choice) => ({ id: choice.id, label: choice.label })),
    { id: CUSTOM_TIME_ID, label: currentId === null ? currentLabel : "指定" },
];

type Clock = ClockSettings[Player];

/** 選択欄の値: 「自分と同じ」・選択肢に無いいまの時間・ノード数や深さで決めた読む量。 */
const SAME_AS_MINE_ID = "same";
const CURRENT_TIME_ID = "current";
const CURRENT_LIMIT_ID = "limit";
const CUSTOM_NODES_ID = "custom-nodes";
const CUSTOM_DEPTH_ID = "custom-depth";

/**
 * AI の考慮時間の選択欄。AI の行（相手・強さと並べる）に置く。
 * いまの時間が選択肢に無いときは、その時間を 1 つ足して選ばれた状態にする。末尾の「…で指定」で数を決める。
 * 時間の代わりに、ノード数・深さで読む量を決めることもできる。
 */
function AiTimeSelect({
    id,
    label,
    choices,
    clock,
    searchLimit,
    sameAsMine,
    onChoose,
    onCustom,
    onCustomLimit,
    disabled,
    className,
}: {
    id: string;
    label: string;
    choices: TimeChoice[];
    clock: Clock;
    searchLimit: EngineSearchLimit;
    /** 「自分と同じ」に当てる時計（人と AI の対局で、自分の時間が決まっているときだけ） */
    sameAsMine: Clock | null;
    onChoose: (choice: TimeChoice) => void;
    onCustom: () => void;
    onCustomLimit: (kind: SearchLimitKind) => void;
    disabled?: boolean;
    className?: string;
}): ReactElement {
    const limitText = formatSearchLimit(searchLimit);
    // 自分と同じ時間なら、選択肢の 1 つと同じ時間でも「自分と同じ」と見せる（自分の時間を変えると付いてくる）。
    const isSame = sameAsMine !== null && isSameClock(clock, sameAsMine);
    const matched = choices.find((choice) => choice.enabled && isSameClock(clock, choice));
    const value = limitText
        ? CURRENT_LIMIT_ID
        : isSame
          ? SAME_AS_MINE_ID
          : (matched?.id ?? CURRENT_TIME_ID);
    return (
        <NativeSelect
            id={id}
            aria-label={label}
            value={value}
            disabled={disabled}
            onChange={(event) => {
                const next = event.target.value;
                if (next === CUSTOM_TIME_ID) {
                    onCustom();
                    return;
                }
                if (next === CUSTOM_NODES_ID || next === CUSTOM_DEPTH_ID) {
                    onCustomLimit(next === CUSTOM_NODES_ID ? "nodes" : "depth");
                    return;
                }
                if (next === SAME_AS_MINE_ID && sameAsMine) {
                    onChoose(clockAsChoice(SAME_AS_MINE_ID, "自分と同じ", sameAsMine));
                    return;
                }
                const choice = choices.find((item) => item.id === next);
                if (choice) onChoose(choice);
            }}
            wrapperClassName={className}
            className="min-h-10 text-sm"
        >
            {choices.map((choice) => (
                <option key={choice.id} value={choice.id}>
                    {choice.label}
                </option>
            ))}
            {sameAsMine && <option value={SAME_AS_MINE_ID}>自分と同じ</option>}
            {value === CURRENT_TIME_ID && (
                <option value={CURRENT_TIME_ID}>
                    {clock.enabled ? formatTimeRule(clock, { perMove: true }) : "時間無制限"}
                </option>
            )}
            {limitText && <option value={CURRENT_LIMIT_ID}>{limitText}</option>}
            <option value={CUSTOM_TIME_ID}>時間で指定…</option>
            <option value={CUSTOM_NODES_ID}>ノード数で指定…</option>
            <option value={CUSTOM_DEPTH_ID}>深さで指定…</option>
        </NativeSelect>
    );
}

const KIND_OPTIONS: Array<{ id: PlayMatchKind; label: string }> = [
    { id: "vs-ai", label: "自分 対 AI" },
    { id: "humans", label: "人 対 人" },
    { id: "ai-vs-ai", label: "AI 対 AI" },
];

type TimeTarget = "ai" | "my" | "both" | "sente-ai" | "gote-ai";
type LimitTarget = "ai" | Player;

/** スレッド数の選択欄の値: AI 対 AI で先後の数が違うとき。 */
const MIXED_THREADS_ID = "mixed";

const sideLabel = (side: Player): string => (side === "sente" ? "先手" : "後手");

const FIELD_LABEL_CLASS = "text-xs font-medium text-wafuu-sumi-light";
const TEXT_LINK_CLASS = PLAY_TEXT_LINK;
/** 行の形: 左に項目名、右に選択肢。項目の間は細い線で区切る。 */
const ROW_CLASS = "items-center gap-x-2 gap-y-0.5 border-b border-wafuu-border py-1";
const ROW_LABEL_CLASS = "w-14 shrink-0 text-xs font-medium text-wafuu-sumi-light max-[359px]:w-12";
/** AI の行（AI・強さ・考慮時間を横に並べる）。スマホの幅でも 1 行に収まるよう、選択欄の余白を詰める。 */
const AI_ROW_CONTROLS_CLASS = "flex min-w-0 flex-1 items-center gap-1.5 md:gap-2";
const COMPACT_SELECT_CLASS = "min-h-10 pl-2 pr-7 text-sm";
const AI_TIME_SELECT_WIDTH = "w-[7.5rem] shrink-0";

interface PlaySetupPanelProps {
    /** 詳細設定を開く */
    onOpenAdvanced: () => void;
    /**
     * 項目を「左に項目名、右に選択肢」の行で並べる（スマホ用。盤を出さず、設定だけを 1 画面に収める）。
     * 対局開始は欄の下端に置く。
     */
    rows?: boolean;
    className?: string;
}

export function PlaySetupPanel({
    onOpenAdvanced,
    rows = false,
    className,
}: PlaySetupPanelProps): ReactElement {
    const { play } = useShogiMatchConfig();
    const setup = usePlaySetup();
    const { passRightsSettings } = useMatchSettings();
    // 振り駒は、始めるときに先後を決める（設定としては保存しない）。
    const [randomSide, setRandomSide] = useState(false);
    const [pendingStart, setPendingStart] = useState(false);
    const [pendingNotice, setPendingNotice] = useState<string | undefined>(undefined);
    // 閉じる間も題名と中身を保つため、開閉と対象を分けて持つ。
    const [timeDialog, setTimeDialogTarget] = useState<TimeTarget>("my");
    const [timeDialogOpen, setTimeDialogOpen] = useState(false);
    const setTimeDialog = (target: TimeTarget) => {
        setTimeDialogTarget(target);
        setTimeDialogOpen(true);
    };
    const [limitDialog, setLimitDialogTarget] = useState<{
        target: LimitTarget;
        kind: SearchLimitKind;
    }>({ target: "ai", kind: "nodes" });
    const [limitDialogOpen, setLimitDialogOpen] = useState(false);
    const openLimitDialog = (target: LimitTarget, kind: SearchLimitKind) => {
        setLimitDialogTarget({ target, kind });
        setLimitDialogOpen(true);
    };
    const startMatch = useEffectEvent(() => {
        play?.startMatch(pendingNotice);
        setPendingNotice(undefined);
    });
    // 先後や相手を書き換えた直後は、その設定が行き渡ってから始める。
    useEffect(() => {
        if (!pendingStart) return;
        setPendingStart(false);
        startMatch();
    }, [pendingStart]);

    const isVsAi = setup.kind === "vs-ai";
    // 対局を始める準備の最中・前の対局を片付けている最中は、設定を変えさせない。
    const locked = setup.locked || play?.busy === true;
    const sideChoice: SideChoice = randomSide ? "random" : setup.mySide;
    const downloadMb = isVsAi ? (setup.opponent?.downloadMb ?? null) : null;

    const startSfen = play?.startSfen ?? "startpos";
    const preset = START_POSITIONS.find((item) => startSfen.includes(item.sfen));
    const startValue = !play?.isCustomStart ? "hirate" : (preset?.id ?? "custom");

    const handleStart = () => {
        if (isVsAi && randomSide) {
            const side = Math.random() < 0.5 ? "sente" : "gote";
            setup.chooseSide(side);
            setPendingNotice(`振り駒の結果、あなたは${sideLabel(side)}です`);
            setPendingStart(true);
            return;
        }
        play?.startMatch();
    };

    const handleQuickStart = () => {
        if (isVsAi && randomSide) {
            // 先後と相手は 1 回の更新で決める（別々に替えると、あとの更新が相手を元に戻す）。
            const side = Math.random() < 0.5 ? "sente" : "gote";
            setup.chooseSide(side, "material", QUICK_AI_TIME);
            setPendingNotice(`振り駒の結果、あなたは${sideLabel(side)}です`);
        } else {
            setup.chooseOpponent("material");
            // 「すぐ指す」ので、簡易AI の考慮時間も短くする（駒得だけの AI を 10 秒待たせない）。
            if (isVsAi) setup.chooseAiTime(QUICK_AI_TIME);
        }
        setPendingStart(true);
    };

    const handleStartPositionChange = (value: string) => {
        if (value === "hirate") {
            play?.resetToStartpos();
        } else if (value === "edit") {
            play?.openPositionEditor();
        } else {
            const next = START_POSITIONS.find((item) => item.id === value);
            if (next) play?.loadStartPosition(next.sfen);
        }
    };

    const passRightsNotice = passRightsSettings.enabled && (
        // 変則ルールが効いていることを、開始ボタンのそばで知らせる（スマホでは盤も対局者の帯も見えない）。
        <p className="pb-1 text-center text-xs text-wafuu-sumi-light md:hidden">
            変則ルール: パス権あり（先手 {passRightsSettings.senteInitialCount} 回・後手{" "}
            {passRightsSettings.goteInitialCount} 回）
        </p>
    );
    const startButton = (
        <Button
            type="button"
            size="lg"
            onClick={handleStart}
            disabled={play?.busy}
            className={cn("h-12 w-full text-base font-semibold", PLAY_PRIMARY_BUTTON)}
        >
            対局開始
        </Button>
    );
    const downloadNote =
        downloadMb === null ? null : (
            <p className="text-center text-xs leading-relaxed text-wafuu-sumi-light">
                <span className="inline-block">
                    {setup.opponent?.label} は、初回だけ約 {downloadMb}MB のダウンロードがあります。
                </span>{" "}
                <button
                    type="button"
                    onClick={handleQuickStart}
                    disabled={locked}
                    className={cn(
                        TEXT_LINK_CLASS,
                        "font-medium text-wafuu-ai hover:text-wafuu-ai-light disabled:opacity-50",
                        rows && "min-h-8",
                    )}
                >
                    ダウンロードせずに簡易AI と指す
                </button>
            </p>
        );
    // 時間のダイアログは、いまの時間から始める。分と秒の入力で書き表せないとき（無制限・秒単位の持ち時間）は、
    // よく使う時間から始める（そのまま決めても、いまの時間を黙って丸めないように）。
    const isAiDialog = timeDialog !== "my" && timeDialog !== "both";
    const currentDialogClock =
        timeDialog === "sente-ai"
            ? setup.clocks.sente
            : timeDialog === "gote-ai"
              ? setup.clocks.gote
              : isAiDialog
                ? setup.aiClock
                : setup.myClock;
    const dialogClock =
        currentDialogClock.enabled && isDialogRepresentable(currentDialogClock)
            ? currentDialogClock
            : isAiDialog
              ? { mainMs: 0, byoyomiMs: 10_000, incrementMs: 0 }
              : { mainMs: 600_000, byoyomiMs: 30_000, incrementMs: 0 };
    const timeDialogTitle =
        timeDialog === "sente-ai"
            ? "☗ 先手の AI の考慮時間"
            : timeDialog === "gote-ai"
              ? "☖ 後手の AI の考慮時間"
              : timeDialog === "ai"
                ? "AI の考慮時間を指定"
                : timeDialog === "both"
                  ? "持ち時間を指定（両者）"
                  : "あなたの持ち時間を指定";
    const limitDialogOwner =
        limitDialog.target === "ai"
            ? "AI"
            : `${limitDialog.target === "sente" ? "☗ 先手" : "☖ 後手"}の AI`;
    const limitDialogTitle = `${limitDialogOwner} の読む量（${
        limitDialog.kind === "nodes" ? "ノード数" : "深さ"
    }）`;
    const threadsSelect = (wrapperClassName?: string) => (
        <NativeSelect
            id="play-setup-threads"
            value={setup.aiThreads === null ? MIXED_THREADS_ID : String(setup.aiThreads)}
            disabled={locked}
            onChange={(event) => {
                if (event.target.value === MIXED_THREADS_ID) return;
                setup.chooseAiThreads(Number(event.target.value));
            }}
            wrapperClassName={wrapperClassName}
            className={COMPACT_SELECT_CLASS}
        >
            {buildThreadOptions({ compact: true, maxThreads: setup.aiMaxThreads }).map((option) => (
                <option key={option.value} value={option.value}>
                    {option.label}
                </option>
            ))}
            {setup.aiThreads === null && <option value={MIXED_THREADS_ID}>先後で別</option>}
        </NativeSelect>
    );
    // 背の低いスマホ（375x553 など）では、ダウンロードの注記まで入れると 1 画面に収まらない。そのときは
    // 詳細設定（先後別のスレッド数）に任せて、この行を出さない。
    const threadsRow = (
        <div
            className={
                rows
                    ? cn(
                          "flex",
                          ROW_CLASS,
                          downloadNote !== null && "[@media(max-height:600px)]:hidden",
                      )
                    : "flex flex-col gap-1.5"
            }
        >
            <label
                htmlFor="play-setup-threads"
                className={rows ? ROW_LABEL_CLASS : FIELD_LABEL_CLASS}
            >
                {rows
                    ? "スレッド"
                    : setup.kind === "ai-vs-ai"
                      ? "スレッド数（両者）"
                      : "スレッド数"}
            </label>
            {threadsSelect(rows ? "min-w-0 flex-1" : undefined)}
        </div>
    );
    // PC で強さを選べるときは、スレッド数を強さの右に並べる（相手・考慮時間の行と同じ 2 列。縦を増やさない）。
    const threadsBesideLevel = isVsAi && !rows && setup.opponent?.supportsLevel !== false;
    const levelSlider = (
        <input
            id="play-setup-level"
            type="range"
            min={0}
            max={SKILL_LEVEL_MAX}
            value={setup.level}
            disabled={locked}
            onChange={(event) => setup.chooseLevel(Number(event.target.value))}
            className={cn("min-w-0 flex-1 accent-wafuu-shu", rows ? "h-10" : "h-8 md:h-6")}
        />
    );
    // 平手以外は、先手から指し始めるとは限らない。先に指す対局者を名前で示す（人同士は名前が同じなので先後の印）。
    // 行の形では 1 行に収める（駒落ちであることは選んだ項目名で分かる）。
    const editTurn = play?.editTurn ?? "sente";
    const firstMover =
        setup.kind === "humans"
            ? editTurn === "sente"
                ? "☗"
                : "☖"
            : (play?.playerNames[editTurn] ?? (editTurn === "sente" ? "☗" : "☖"));
    const startTurnNotice =
        preset && !rows
            ? `上手の駒落ち ・ ${firstMover}から指し始めます`
            : `${firstMover}から指し始めます`;
    const advancedButton = (
        <Button
            type="button"
            variant="outline"
            onClick={onOpenAdvanced}
            className={cn("h-9 min-h-9 gap-1.5 px-3 text-sm", PLAY_OUTLINE_BUTTON)}
        >
            <svg
                aria-hidden="true"
                xmlns="http://www.w3.org/2000/svg"
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.75"
                strokeLinecap="round"
                strokeLinejoin="round"
            >
                <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" />
                <circle cx="12" cy="12" r="3" />
            </svg>
            詳細設定
        </Button>
    );

    return (
        <section
            aria-labelledby="play-setup-heading"
            className={cn(
                // 設定はこの画面の主役なので、背景付きの欄にしない（見出しと項目を、地の上に並べる）。
                // 高さの低い画面（1280x720 など）では、行の間を詰めて 1 画面に収める。
                rows
                    ? "flex flex-col"
                    : "flex flex-col gap-4 [@media(max-height:760px)]:md:gap-2.5",
                className,
            )}
        >
            {/* 詳細設定への入口は、見出しの右に見える大きさで置く。 */}
            <div className="flex items-center justify-between gap-2">
                <h1
                    id="play-setup-heading"
                    data-play-heading
                    tabIndex={-1}
                    className={cn(PLAY_HEADING, "outline-none", rows && "text-xl")}
                >
                    {setup.kind === "vs-ai"
                        ? "AI と対局する"
                        : setup.kind === "humans"
                          ? "人と人で対局する"
                          : "AI 同士の対局を見る"}
                </h1>
                {/* 音の切り替えも、対局開始前に止められるよう見出しの行に置く（AI が先手なら初手から鳴る）。 */}
                <span className="flex shrink-0 items-center gap-2">
                    {rows && <SoundToggle />}
                    {advancedButton}
                </span>
            </div>
            {/* 棋譜を調べたくて来た人が、最初に気づける位置に置く。行の形（スマホ）では、
                設定を 1 画面に収めるために出さない（研究ノートへはメニューから行ける）。 */}
            {!rows && play?.setupFooter}

            <Segmented<PlayMatchKind>
                label="対局の組み合わせ"
                rowLabel={rows ? "対局" : undefined}
                options={KIND_OPTIONS}
                value={setup.kind}
                onChange={(id) => {
                    setRandomSide(false);
                    setup.chooseKind(id);
                }}
                disabled={locked}
            />

            {isVsAi && (
                <Segmented<SideChoice>
                    label="あなたの手番"
                    rowLabel={rows ? "手番" : undefined}
                    options={[
                        { id: "sente", label: "☗ 先手" },
                        { id: "gote", label: "☖ 後手" },
                        { id: "random", label: "振り駒" },
                    ]}
                    value={sideChoice}
                    onChange={(id) => {
                        if (id === "random") {
                            setRandomSide(true);
                            return;
                        }
                        setRandomSide(false);
                        setup.chooseSide(id);
                    }}
                    disabled={locked}
                />
            )}

            {setup.kind === "ai-vs-ai" && (
                <>
                    {/* AI ごとに 1 行: どの AI か・強さ・考慮時間。先後で別の時間にできる。 */}
                    {(["sente", "gote"] as const).map((side) => {
                        const ai = setup.sideAi[side];
                        const name = sideLabel(side);
                        const mark = side === "sente" ? "☗" : "☖";
                        return (
                            <div
                                key={side}
                                className={rows ? cn("flex", ROW_CLASS) : "flex flex-col gap-1.5"}
                            >
                                <label
                                    htmlFor={`play-setup-ai-${side}`}
                                    className={rows ? ROW_LABEL_CLASS : FIELD_LABEL_CLASS}
                                >
                                    {rows ? `${mark} ${name}` : `${mark} ${name}の AI`}
                                </label>
                                {/* スマホ（行の形）は幅が足りないので、AI を 1 段目、強さと時間を 2 段目に置く。 */}
                                <div
                                    className={
                                        rows
                                            ? "grid min-w-0 flex-1 grid-cols-2 gap-1.5"
                                            : AI_ROW_CONTROLS_CLASS
                                    }
                                >
                                    <NativeSelect
                                        id={`play-setup-ai-${side}`}
                                        value={ai.value}
                                        disabled={locked}
                                        onChange={(event) =>
                                            setup.chooseSideAi(side, event.target.value)
                                        }
                                        wrapperClassName={rows ? "col-span-2" : "min-w-0 flex-1"}
                                        className={COMPACT_SELECT_CLASS}
                                    >
                                        {setup.opponentOptions.map((option) => (
                                            <option key={option.value} value={option.value}>
                                                {option.label}
                                                {option.downloadMb !== null
                                                    ? `（初回 約${option.downloadMb}MB）`
                                                    : ""}
                                            </option>
                                        ))}
                                    </NativeSelect>
                                    {ai.option?.supportsLevel !== false && (
                                        <NativeSelect
                                            aria-label={`${name}の AI の強さ`}
                                            value={String(ai.level)}
                                            disabled={locked}
                                            onChange={(event) =>
                                                setup.chooseSideLevel(
                                                    side,
                                                    Number(event.target.value),
                                                )
                                            }
                                            wrapperClassName={rows ? undefined : "w-28 shrink-0"}
                                            className={COMPACT_SELECT_CLASS}
                                        >
                                            {Array.from(
                                                { length: SKILL_LEVEL_MAX + 1 },
                                                (_, level) => (
                                                    // biome-ignore lint/suspicious/noArrayIndexKey: レベルそのものが並びの位置
                                                    <option key={level} value={level}>
                                                        レベル {level}
                                                    </option>
                                                ),
                                            )}
                                        </NativeSelect>
                                    )}
                                    <AiTimeSelect
                                        id={`play-setup-ai-time-${side}`}
                                        label={`${name}の AI の考慮時間`}
                                        choices={AI_MATCH_TIME_CHOICES}
                                        clock={ai.clock}
                                        searchLimit={ai.searchLimit}
                                        sameAsMine={null}
                                        onChoose={(choice) => setup.chooseSideTime(side, choice)}
                                        onCustom={() => setTimeDialog(`${side}-ai`)}
                                        onCustomLimit={(kind) => openLimitDialog(side, kind)}
                                        disabled={locked}
                                        className={
                                            rows
                                                ? ai.option?.supportsLevel === false
                                                    ? "col-span-2"
                                                    : undefined
                                                : AI_TIME_SELECT_WIDTH
                                        }
                                    />
                                </div>
                            </div>
                        );
                    })}
                    {threadsRow}
                    <PlayTimeRulesHelp variant="text" className={cn("self-end", rows && "mt-1")} />
                </>
            )}

            {isVsAi && (
                <div className={rows ? cn("flex", ROW_CLASS) : "flex flex-col gap-1.5"}>
                    {rows ? (
                        <label htmlFor="play-setup-opponent" className={ROW_LABEL_CLASS}>
                            相手
                        </label>
                    ) : (
                        <div className="flex gap-2">
                            <label htmlFor="play-setup-opponent" className="flex-1">
                                <span className={FIELD_LABEL_CLASS}>相手</span>
                            </label>
                            <label htmlFor="play-setup-ai-time" className={AI_TIME_SELECT_WIDTH}>
                                <span className={FIELD_LABEL_CLASS}>
                                    {setup.aiSearchLimit.kind === "clock"
                                        ? "考慮時間"
                                        : "読みの上限"}
                                </span>
                            </label>
                        </div>
                    )}
                    <div className={AI_ROW_CONTROLS_CLASS}>
                        <NativeSelect
                            id="play-setup-opponent"
                            value={setup.opponentValue}
                            disabled={locked}
                            onChange={(event) => setup.chooseOpponent(event.target.value)}
                            wrapperClassName="min-w-0 flex-1"
                            className={COMPACT_SELECT_CLASS}
                        >
                            {setup.opponentOptions.map((option) => (
                                <option key={option.value} value={option.value}>
                                    {option.label}
                                    {option.description ? ` ・ ${option.description}` : ""}
                                    {option.downloadMb !== null
                                        ? `（初回 約${option.downloadMb}MB）`
                                        : ""}
                                </option>
                            ))}
                        </NativeSelect>
                        <AiTimeSelect
                            id="play-setup-ai-time"
                            label="AI の考慮時間"
                            choices={AI_TIME_CHOICES}
                            clock={setup.aiClock}
                            searchLimit={setup.aiSearchLimit}
                            sameAsMine={setup.myClock.enabled ? setup.myClock : null}
                            onChoose={setup.chooseAiTime}
                            onCustom={() => setTimeDialog("ai")}
                            onCustomLimit={(kind) => openLimitDialog("ai", kind)}
                            disabled={locked}
                            className={AI_TIME_SELECT_WIDTH}
                        />
                    </div>
                </div>
            )}

            {isVsAi &&
                setup.opponent?.supportsLevel !== false &&
                (rows ? (
                    <label htmlFor="play-setup-level" className={cn("flex", ROW_CLASS)}>
                        <span className={ROW_LABEL_CLASS}>強さ</span>
                        {levelSlider}
                        <span className="w-16 shrink-0 text-right text-sm tabular-nums text-wafuu-sumi">
                            レベル {setup.level}
                        </span>
                    </label>
                ) : (
                    <div className="flex items-end gap-2">
                        <label
                            htmlFor="play-setup-level"
                            className="flex min-w-0 flex-1 flex-col gap-1.5"
                        >
                            <span
                                className={cn(
                                    "flex items-baseline justify-between",
                                    FIELD_LABEL_CLASS,
                                )}
                            >
                                <span>強さ</span>
                                <span className="text-sm tabular-nums text-wafuu-sumi">
                                    レベル {setup.level}
                                </span>
                            </span>
                            <span className="flex min-h-10 items-center gap-2 text-[11px] text-wafuu-sumi-light">
                                <span aria-hidden>弱</span>
                                {levelSlider}
                                <span aria-hidden>強</span>
                            </span>
                        </label>
                        <div className={cn("flex flex-col gap-1.5", AI_TIME_SELECT_WIDTH)}>
                            <label htmlFor="play-setup-threads" className={FIELD_LABEL_CLASS}>
                                スレッド数
                            </label>
                            {threadsSelect()}
                        </div>
                    </div>
                ))}

            {isVsAi && !threadsBesideLevel && threadsRow}

            {isVsAi && (
                <Segmented
                    label="あなたの持ち時間"
                    rowLabel={rows ? "時間" : undefined}
                    labelAddon={<PlayTimeRulesHelp />}
                    wrapLabels
                    options={timeOptions(
                        MY_TIME_CHOICES,
                        setup.myTimeId,
                        formatTimeRule(setup.myClock),
                    )}
                    value={setup.myTimeId ?? CUSTOM_TIME_ID}
                    onChange={(id) => {
                        if (id === CUSTOM_TIME_ID) {
                            setTimeDialog("my");
                            return;
                        }
                        const choice = MY_TIME_CHOICES.find((item) => item.id === id);
                        if (choice) setup.chooseMyTime(choice);
                    }}
                    disabled={locked}
                />
            )}

            {setup.kind === "humans" && (
                <Segmented
                    label="持ち時間（両者）"
                    rowLabel={rows ? "時間" : undefined}
                    labelAddon={<PlayTimeRulesHelp />}
                    wrapLabels
                    options={timeOptions(
                        MY_TIME_CHOICES,
                        setup.bothTimeId,
                        isSameClock(setup.clocks.sente, setup.clocks.gote)
                            ? formatTimeRule(setup.clocks.sente)
                            : "指定",
                    )}
                    value={setup.bothTimeId ?? CUSTOM_TIME_ID}
                    onChange={(id) => {
                        if (id === CUSTOM_TIME_ID) {
                            setTimeDialog("both");
                            return;
                        }
                        const choice = MY_TIME_CHOICES.find((item) => item.id === id);
                        if (choice) setup.chooseBothTime(choice);
                    }}
                    disabled={locked}
                />
            )}

            <div className={rows ? cn("flex flex-wrap", ROW_CLASS) : "flex flex-col gap-1.5"}>
                <div className={rows ? "contents" : "flex items-baseline justify-between gap-2"}>
                    <label
                        htmlFor="play-setup-start-position"
                        className={rows ? ROW_LABEL_CLASS : FIELD_LABEL_CLASS}
                    >
                        開始局面
                    </label>
                    {play?.isCustomStart && (
                        <span
                            className={cn(
                                "text-xs text-wafuu-sumi-light",
                                rows && "order-last w-full pl-16",
                            )}
                        >
                            {startTurnNotice}
                        </span>
                    )}
                </div>
                <NativeSelect
                    id="play-setup-start-position"
                    value={startValue}
                    disabled={locked}
                    onChange={(event) => handleStartPositionChange(event.target.value)}
                    wrapperClassName={rows ? "min-w-0 flex-1" : undefined}
                    className="min-h-10 text-sm"
                >
                    <option value="hirate">平手</option>
                    {START_POSITIONS.map((item) => (
                        <option key={item.id} value={item.id}>
                            {item.label}
                        </option>
                    ))}
                    {startValue === "custom" && <option value="custom">指定の局面</option>}
                    <option value="edit">盤を編集して決める…</option>
                </NativeSelect>
            </div>

            {/* 行の形では、開始ボタンを欄の下端（親指の届く位置）に置き、注記はそのすぐ上に添える。
                間の空きはマージンではなく伸びる要素で取る（欄の高さは呼び出し側が決める）。 */}
            {rows && <div aria-hidden className="flex-1" />}
            {rows ? (
                <div className="sticky bottom-0 z-10 flex flex-col gap-1 bg-background pt-2">
                    {passRightsNotice}
                    {downloadNote}
                    {startButton}
                </div>
            ) : (
                <>
                    {/* 盤の横に並べる形（PC）。md より狭い幅では、開始ボタンだけを画面の下端に留める。 */}
                    <div className="sticky bottom-0 z-10 bg-background pb-2 pt-1 md:static md:bg-transparent md:p-0">
                        {passRightsNotice}
                        {startButton}
                    </div>
                    {/* 開始ボタンの下に置く（ボタンを下端に留めるために、同じ並びの別の要素にしている）。 */}
                    {downloadNote}
                </>
            )}
            <PlayTimeDialog
                open={timeDialogOpen}
                onOpenChange={setTimeDialogOpen}
                kind={isAiDialog ? "ai" : "player"}
                title={timeDialogTitle}
                mainMs={dialogClock.mainMs}
                byoyomiMs={dialogClock.byoyomiMs}
                incrementMs={dialogClock.incrementMs}
                onApply={(choice) => {
                    if (timeDialog === "ai") setup.chooseAiTime(choice);
                    else if (timeDialog === "sente-ai") setup.chooseSideTime("sente", choice);
                    else if (timeDialog === "gote-ai") setup.chooseSideTime("gote", choice);
                    else if (timeDialog === "my") setup.chooseMyTime(choice);
                    else setup.chooseBothTime(choice);
                }}
            />
            <PlaySearchLimitDialog
                open={limitDialogOpen}
                onOpenChange={setLimitDialogOpen}
                kind={limitDialog.kind}
                title={limitDialogTitle}
                current={
                    limitDialog.target === "ai"
                        ? setup.aiSearchLimit
                        : setup.sideAi[limitDialog.target].searchLimit
                }
                onApply={(limit) => {
                    if (limitDialog.target === "ai") setup.chooseAiSearchLimit(limit);
                    else setup.chooseSideSearchLimit(limitDialog.target, limit);
                }}
            />
        </section>
    );
}
