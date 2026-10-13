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
import { useShogiMatchConfig } from "../ShogiMatchContext";
import { PLAY_HEADING, PLAY_PRIMARY_BUTTON, PLAY_TEXT_LINK } from "./playStyles";
import {
    AI_TIME_CHOICES,
    MY_TIME_CHOICES,
    type PlaySetup,
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
    options,
    value,
    onChange,
    disabled,
}: {
    label: string;
    options: Array<{ id: T; label: ReactNode }>;
    value: T | null;
    onChange: (id: T) => void;
    disabled?: boolean;
}): ReactElement {
    return (
        <fieldset className="flex min-w-0 flex-col" disabled={disabled}>
            <legend className="pb-1.5 text-xs font-medium text-wafuu-sumi-light">{label}</legend>
            <div className="flex flex-wrap gap-1.5">
                {options.map((option) => {
                    const selected = option.id === value;
                    return (
                        <button
                            key={option.id}
                            type="button"
                            aria-pressed={selected}
                            onClick={() => onChange(option.id)}
                            className={cn(
                                "min-h-10 flex-1 whitespace-nowrap rounded-md border px-2.5 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50 md:min-h-9",
                                selected
                                    ? "border-wafuu-shu bg-wafuu-shu/10 text-wafuu-shu"
                                    : "border-wafuu-border bg-background text-wafuu-sumi hover:bg-muted/50",
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

const timeOptions = (choices: TimeChoice[]) =>
    choices.map((choice) => ({ id: choice.id, label: choice.label }));

const sideLabel = (side: Player): string => (side === "sente" ? "先手" : "後手");

const FIELD_LABEL_CLASS = "text-xs font-medium text-wafuu-sumi-light";
const TEXT_LINK_CLASS = PLAY_TEXT_LINK;

/** 「対局開始」の下に出す、これから始まる対局の要約。 */
function describeMatch(setup: PlaySetup, sideChoice: SideChoice): string {
    if (setup.kind === "humans") return "人 対 人（この端末で交互に指す）";
    if (setup.kind === "ai-vs-ai") return "AI 対 AI（観戦）";
    const opponentName = setup.opponent?.label ?? "AI";
    const levelText = setup.opponent?.supportsLevel === false ? "" : ` レベル${setup.level}`;
    const mine = sideChoice === "random" ? "振り駒" : `あなたが${sideLabel(sideChoice)}`;
    return `${mine} ・ 相手 ${opponentName}${levelText}`;
}

interface PlaySetupPanelProps {
    /** 詳細設定を開く */
    onOpenAdvanced: () => void;
    className?: string;
}

export function PlaySetupPanel({ onOpenAdvanced, className }: PlaySetupPanelProps): ReactElement {
    const { play } = useShogiMatchConfig();
    const setup = usePlaySetup();
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
    const sideChoice: SideChoice = randomSide ? "random" : setup.mySide;
    const downloadMb = setup.kind === "humans" ? null : (setup.opponent?.downloadMb ?? null);

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

    return (
        <section
            aria-labelledby="play-setup-heading"
            className={cn(
                // 設定はこの画面の主役なので、背景付きの欄にしない（見出しと項目を、地の上に並べる）。
                "flex flex-col gap-4",
                className,
            )}
        >
            <h1 id="play-setup-heading" className={PLAY_HEADING}>
                {setup.kind === "vs-ai"
                    ? "AI と対局する"
                    : setup.kind === "humans"
                      ? "人と人で対局する"
                      : "AI 同士の対局を見る"}
            </h1>

            {isVsAi ? (
                <Segmented<SideChoice>
                    label="あなたの手番"
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
                    disabled={setup.locked}
                />
            ) : (
                <div className="flex flex-col gap-1 rounded-lg border border-wafuu-border bg-wafuu-washi-warm p-3">
                    <p className="text-sm text-wafuu-sumi">
                        いまの設定は「{describeMatch(setup, sideChoice)}
                        」です。先手・後手それぞれの設定は「詳細設定」で変えられます。
                    </p>
                    <button
                        type="button"
                        onClick={() => setup.chooseSide("sente")}
                        className={cn(
                            TEXT_LINK_CLASS,
                            "self-start text-sm text-wafuu-ai hover:text-wafuu-ai-light",
                        )}
                    >
                        自分が AI と指す設定に戻す
                    </button>
                </div>
            )}

            {isVsAi && (
                <div className="flex flex-col gap-1.5">
                    <label htmlFor="play-setup-opponent" className={FIELD_LABEL_CLASS}>
                        相手
                    </label>
                    <NativeSelect
                        id="play-setup-opponent"
                        value={setup.opponentValue}
                        disabled={setup.locked}
                        onChange={(event) => setup.chooseOpponent(event.target.value)}
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

            {isVsAi && setup.opponent?.supportsLevel !== false && (
                <label className="flex flex-col gap-1.5">
                    <span className={cn("flex items-baseline justify-between", FIELD_LABEL_CLASS)}>
                        <span>強さ</span>
                        <span className="text-sm tabular-nums text-wafuu-sumi">
                            レベル {setup.level}
                        </span>
                    </span>
                    <span className="flex items-center gap-2 text-[11px] text-wafuu-sumi-light">
                        <span aria-hidden>弱</span>
                        <input
                            type="range"
                            min={0}
                            max={SKILL_LEVEL_MAX}
                            value={setup.level}
                            disabled={setup.locked}
                            onChange={(event) => setup.chooseLevel(Number(event.target.value))}
                            className="h-8 min-w-0 flex-1 accent-wafuu-shu md:h-6"
                        />
                        <span aria-hidden>強</span>
                    </span>
                </label>
            )}

            {isVsAi && (
                <div className="flex flex-col gap-4">
                    <Segmented
                        label="AI の考慮時間（1手）"
                        options={timeOptions(AI_TIME_CHOICES)}
                        value={setup.aiTimeId}
                        onChange={(id) => {
                            const choice = AI_TIME_CHOICES.find((item) => item.id === id);
                            if (choice) setup.chooseAiTime(choice);
                        }}
                        disabled={setup.locked}
                    />
                    <Segmented
                        label="あなたの持ち時間"
                        options={timeOptions(MY_TIME_CHOICES)}
                        value={setup.myTimeId}
                        onChange={(id) => {
                            const choice = MY_TIME_CHOICES.find((item) => item.id === id);
                            if (choice) setup.chooseMyTime(choice);
                        }}
                        disabled={setup.locked}
                    />
                </div>
            )}

            <div className="flex flex-col gap-1.5">
                <div className="flex items-baseline justify-between gap-2">
                    <label htmlFor="play-setup-start-position" className={FIELD_LABEL_CLASS}>
                        開始局面
                    </label>
                    {/* どちらから指し始めるか（平手以外は、先手からとは限らない）。 */}
                    {play?.isCustomStart && (
                        <span className="text-xs text-wafuu-sumi-light">
                            {preset ? "上手（後手）の駒落ち ・ " : ""}
                            {play.editTurn === "sente" ? "先手" : "後手"}から指し始めます
                        </span>
                    )}
                </div>
                <NativeSelect
                    id="play-setup-start-position"
                    value={startValue}
                    onChange={(event) => handleStartPositionChange(event.target.value)}
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

            {/* スマホでは、開始ボタンを画面の下端に留める（設定を全部送らなくても始められる）。 */}
            <div className="sticky bottom-0 z-10 flex flex-col gap-2 bg-background pb-2 pt-1 md:static md:bg-transparent md:p-0">
                <Button
                    type="button"
                    size="lg"
                    onClick={handleStart}
                    disabled={play?.busy}
                    className={cn("h-12 w-full text-base font-semibold", PLAY_PRIMARY_BUTTON)}
                >
                    {downloadMb !== null ? "ダウンロードして対局開始" : "対局開始"}
                </Button>
                {downloadMb !== null && (
                    <>
                        {/* スマホでは、ダウンロードなしで始める道を同じ大きさのボタンで並べる。 */}
                        <Button
                            type="button"
                            variant="outline"
                            onClick={handleQuickStart}
                            className="min-h-11 w-full border-wafuu-border bg-background text-wafuu-sumi hover:bg-wafuu-washi-warm md:hidden"
                        >
                            ダウンロードせずに簡易AI と指す
                        </Button>
                        <p className="text-center text-xs leading-relaxed text-wafuu-sumi-light">
                            初回だけ約 {downloadMb}MB のダウンロードがあります。
                            <button
                                type="button"
                                onClick={handleQuickStart}
                                className={cn(
                                    TEXT_LINK_CLASS,
                                    "hidden font-medium text-wafuu-ai hover:text-wafuu-ai-light md:inline-flex",
                                )}
                            >
                                ダウンロードせずに簡易AI と指す
                            </button>
                        </p>
                    </>
                )}
            </div>

            <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 border-t border-wafuu-border pt-3 text-[13px]">
                {play?.setupFooter}
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
            </div>
        </section>
    );
}
