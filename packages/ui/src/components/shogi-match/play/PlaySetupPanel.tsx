/**
 * 対局の設定（対局画面の最初の画面）。
 *
 * 「誰と・どちらの手番で・どのくらいの時間で指すか」を決めて「対局開始」を押す、だけの欄。
 * 細かい設定（AI 同士・人同士、秒数の指定、変則ルール、評価関数の管理、表示）は詳細設定に置く。
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
import { useShogiMatchConfig } from "../ShogiMatchContext";
import { PLAY_HEADING, PLAY_PRIMARY_BUTTON, PLAY_TEXT_LINK } from "./playStyles";
import { AI_TIME_CHOICES, MY_TIME_CHOICES, type TimeChoice, usePlaySetup } from "./usePlaySetup";

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
    options,
    value,
    onChange,
    disabled,
}: {
    label: string;
    /** 行の形で並べるときの、左に出す短い項目名（読み上げは `label` のまま）。 */
    rowLabel?: string;
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
            {/* legend は flex の子として並ばないので、行の形では見出しを別の要素で出す。 */}
            <legend
                className={
                    rowLabel ? "sr-only" : "pb-1.5 text-xs font-medium text-wafuu-sumi-light"
                }
            >
                {label}
            </legend>
            {rowLabel && (
                <span aria-hidden className={ROW_LABEL_CLASS}>
                    {rowLabel}
                </span>
            )}
            <div className="flex min-w-0 flex-1 flex-wrap gap-1.5">
                {options.map((option) => {
                    const selected = option.id === value;
                    return (
                        <button
                            key={option.id}
                            type="button"
                            aria-pressed={selected}
                            onClick={() => onChange(option.id)}
                            className={cn(
                                rowLabel ? "px-2" : "px-2.5",
                                "min-h-10 flex-1 whitespace-nowrap rounded-md border text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50 md:min-h-9 [@media(max-height:760px)]:md:min-h-8",
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

/** 詳細設定で秒を指定していて、どの選択肢にも当たらないときの項目。 */
const CUSTOM_TIME_ID = "custom";

/** 時間の選択肢。いまの時間がどれにも当たらなければ、「秒で指定」を選ばれた状態で足す。 */
const timeOptions = (choices: TimeChoice[], currentId: string | null) => [
    ...choices.map((choice) => ({ id: choice.id, label: choice.label })),
    ...(currentId === null ? [{ id: CUSTOM_TIME_ID, label: "秒で指定" }] : []),
];

const sideLabel = (side: Player): string => (side === "sente" ? "先手" : "後手");

const FIELD_LABEL_CLASS = "text-xs font-medium text-wafuu-sumi-light";
const TEXT_LINK_CLASS = PLAY_TEXT_LINK;
/** 行の形: 左に項目名、右に選択肢。項目の間は細い線で区切る。 */
const ROW_CLASS = "items-center gap-x-2 gap-y-0.5 border-b border-wafuu-border py-1";
const ROW_LABEL_CLASS = "w-14 shrink-0 text-xs font-medium text-wafuu-sumi-light";

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
    // 縦に並べるときは、注記が無い相手でも 2 行ぶんの高さを取る（相手を選び直したときに、下の「詳細設定」が動かないように）。
    // 行の形では開始ボタンが下端に固定なので、高さは取らない。
    const downloadNote =
        rows && downloadMb === null ? null : (
            <p
                aria-hidden={downloadMb === null}
                className={cn(
                    "text-center text-xs leading-relaxed text-wafuu-sumi-light",
                    !rows && "min-h-10",
                )}
            >
                {downloadMb !== null && (
                    <>
                        <span className="inline-block">
                            {setup.opponent?.label} は、初回だけ約 {downloadMb}MB
                            のダウンロードがあります。
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
                    </>
                )}
            </p>
        );
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
    const editTurnLabel = play?.editTurn === "sente" ? "先手" : "後手";
    // 平手以外は、先手から指し始めるとは限らない。行の形では 1 行に収める（駒落ちであることは選んだ項目名で分かる）。
    const startTurnNotice = !preset
        ? `${editTurnLabel}から指し始めます`
        : rows
          ? "上手（後手）から指し始めます"
          : `上手（後手）の駒落ち ・ ${editTurnLabel}から指し始めます`;
    const advancedLink = (
        <button
            type="button"
            onClick={onOpenAdvanced}
            className={cn(
                TEXT_LINK_CLASS,
                "ml-auto whitespace-nowrap text-wafuu-sumi-light hover:text-wafuu-sumi",
            )}
        >
            詳細設定
        </button>
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
            {/* 行の形では、詳細設定への入口を見出しの右に置く（縦を 1 行ぶん空ける）。 */}
            <div className={rows ? "flex items-center justify-between gap-2" : "contents"}>
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
                {rows && (
                    <span className="flex items-center gap-2 text-[13px]">
                        <SoundToggle />
                        {advancedLink}
                    </span>
                )}
            </div>
            {/* 棋譜を調べたくて来た人が、最初に気づける位置に置く。行の形（スマホ）では、
                設定を 1 画面に収めるために出さない（研究ノートへはメニューから行ける）。 */}
            {!rows && play?.setupFooter}

            {isVsAi ? (
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
            ) : (
                <button
                    type="button"
                    onClick={() => setup.chooseKind("vs-ai")}
                    disabled={locked}
                    className={cn(
                        TEXT_LINK_CLASS,
                        "self-start text-sm text-wafuu-ai hover:text-wafuu-ai-light",
                    )}
                >
                    自分が AI と指す設定に戻す
                </button>
            )}

            {setup.kind === "ai-vs-ai" && (
                <>
                    {(["sente", "gote"] as const).map((side) => (
                        <div
                            key={side}
                            className={cn(
                                "flex flex-col gap-1.5",
                                rows && "border-b border-wafuu-border py-1.5",
                            )}
                        >
                            <label htmlFor={`play-setup-ai-${side}`} className={FIELD_LABEL_CLASS}>
                                {side === "sente" ? "☗ 先手の AI" : "☖ 後手の AI"}
                            </label>
                            <div className="flex items-center gap-2">
                                <NativeSelect
                                    id={`play-setup-ai-${side}`}
                                    value={setup.sideAi[side].value}
                                    disabled={locked}
                                    onChange={(event) =>
                                        setup.chooseSideAi(side, event.target.value)
                                    }
                                    wrapperClassName="flex-1"
                                    className="min-h-10 text-sm"
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
                                {setup.sideAi[side].option?.supportsLevel !== false && (
                                    <NativeSelect
                                        aria-label={`${side === "sente" ? "先手" : "後手"}の AI の強さ`}
                                        value={String(setup.sideAi[side].level)}
                                        disabled={locked}
                                        onChange={(event) =>
                                            setup.chooseSideLevel(side, Number(event.target.value))
                                        }
                                        wrapperClassName="w-32 shrink-0"
                                        className="min-h-10 text-sm"
                                    >
                                        {Array.from({ length: SKILL_LEVEL_MAX + 1 }, (_, level) => (
                                            // biome-ignore lint/suspicious/noArrayIndexKey: レベルそのものが並びの位置
                                            <option key={level} value={level}>
                                                レベル {level}
                                            </option>
                                        ))}
                                    </NativeSelect>
                                )}
                            </div>
                        </div>
                    ))}
                    <Segmented
                        label="AI の考慮時間（1手・両者）"
                        rowLabel={rows ? "AI 1手" : undefined}
                        options={timeOptions(AI_TIME_CHOICES, setup.bothAiTimeId)}
                        value={setup.bothAiTimeId ?? CUSTOM_TIME_ID}
                        onChange={(id) => {
                            if (id === CUSTOM_TIME_ID) {
                                onOpenAdvanced();
                                return;
                            }
                            const choice = AI_TIME_CHOICES.find((item) => item.id === id);
                            if (choice) setup.chooseBothAiTime(choice);
                        }}
                        disabled={locked}
                    />
                </>
            )}

            {isVsAi && (
                <div className={rows ? cn("flex", ROW_CLASS) : "flex flex-col gap-1.5"}>
                    <label
                        htmlFor="play-setup-opponent"
                        className={rows ? ROW_LABEL_CLASS : FIELD_LABEL_CLASS}
                    >
                        相手
                    </label>
                    <NativeSelect
                        id="play-setup-opponent"
                        value={setup.opponentValue}
                        disabled={locked}
                        onChange={(event) => setup.chooseOpponent(event.target.value)}
                        wrapperClassName={rows ? "min-w-0 flex-1" : undefined}
                        className="min-h-10 text-sm"
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
                    <label htmlFor="play-setup-level" className="flex flex-col gap-1.5">
                        <span
                            className={cn("flex items-baseline justify-between", FIELD_LABEL_CLASS)}
                        >
                            <span>強さ</span>
                            <span className="text-sm tabular-nums text-wafuu-sumi">
                                レベル {setup.level}
                            </span>
                        </span>
                        <span className="flex items-center gap-2 text-[11px] text-wafuu-sumi-light">
                            <span aria-hidden>弱</span>
                            {levelSlider}
                            <span aria-hidden>強</span>
                        </span>
                    </label>
                ))}

            {isVsAi && (
                <div
                    className={
                        rows
                            ? "contents"
                            : "flex flex-col gap-4 [@media(max-height:760px)]:md:gap-2.5"
                    }
                >
                    <Segmented
                        label="AI の考慮時間（1手）"
                        rowLabel={rows ? "AI 1手" : undefined}
                        options={timeOptions(AI_TIME_CHOICES, setup.aiTimeId)}
                        value={setup.aiTimeId ?? CUSTOM_TIME_ID}
                        onChange={(id) => {
                            // 「秒で指定」は詳細設定で決める。
                            if (id === CUSTOM_TIME_ID) {
                                onOpenAdvanced();
                                return;
                            }
                            const choice = AI_TIME_CHOICES.find((item) => item.id === id);
                            if (choice) setup.chooseAiTime(choice);
                        }}
                        disabled={locked}
                    />
                    <Segmented
                        label="あなたの持ち時間"
                        rowLabel={rows ? "持ち時間" : undefined}
                        options={timeOptions(MY_TIME_CHOICES, setup.myTimeId)}
                        value={setup.myTimeId ?? CUSTOM_TIME_ID}
                        onChange={(id) => {
                            // 「秒で指定」は詳細設定で決める。
                            if (id === CUSTOM_TIME_ID) {
                                onOpenAdvanced();
                                return;
                            }
                            const choice = MY_TIME_CHOICES.find((item) => item.id === id);
                            if (choice) setup.chooseMyTime(choice);
                        }}
                        disabled={locked}
                    />
                </div>
            )}

            {setup.kind === "humans" && (
                <Segmented
                    label="持ち時間（両者）"
                    rowLabel={rows ? "持ち時間" : undefined}
                    options={timeOptions(MY_TIME_CHOICES, setup.bothTimeId)}
                    value={setup.bothTimeId ?? CUSTOM_TIME_ID}
                    onChange={(id) => {
                        if (id === CUSTOM_TIME_ID) {
                            onOpenAdvanced();
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
                    <div className="flex items-center justify-end border-t border-wafuu-border pt-3 text-[13px]">
                        {advancedLink}
                    </div>
                </>
            )}
        </section>
    );
}
