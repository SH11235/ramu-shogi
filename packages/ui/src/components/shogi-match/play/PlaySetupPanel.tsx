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
import {
    AI_TIME_CHOICES,
    MY_TIME_CHOICES,
    type PlaySetup,
    type TimeChoice,
    usePlaySetup,
} from "./usePlaySetup";

type SideChoice = Player | "random";

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
        <fieldset className="flex min-w-0 flex-col gap-1.5" disabled={disabled}>
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
                                "min-h-9 flex-1 whitespace-nowrap rounded-md border px-2.5 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50",
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
    const startMatch = useEffectEvent(() => play?.startMatch());
    // 振り駒で先後を書き換えた直後は、その設定が行き渡ってから始める。
    useEffect(() => {
        if (!pendingStart) return;
        setPendingStart(false);
        startMatch();
    }, [pendingStart]);

    const isVsAi = setup.kind === "vs-ai";
    const sideChoice: SideChoice = randomSide ? "random" : setup.mySide;
    const downloadMb = setup.kind === "humans" ? null : (setup.opponent?.downloadMb ?? null);

    const handleStart = () => {
        if (isVsAi && randomSide) {
            setup.chooseSide(Math.random() < 0.5 ? "sente" : "gote");
            setPendingStart(true);
            return;
        }
        play?.startMatch();
    };

    return (
        <section
            aria-labelledby="play-setup-heading"
            className={cn(
                "flex flex-col gap-4 rounded-xl border border-wafuu-border bg-card p-5 shadow-card",
                className,
            )}
        >
            <h1
                id="play-setup-heading"
                className="font-display text-2xl font-semibold text-wafuu-sumi"
            >
                AI と対局する
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
                <div className="flex flex-col gap-2 rounded-lg border border-wafuu-border bg-wafuu-washi-warm p-3">
                    <p className="text-sm text-wafuu-sumi">
                        いまの設定は「{describeMatch(setup, sideChoice)}」です。
                    </p>
                    <button
                        type="button"
                        onClick={() => setup.chooseSide("sente")}
                        className="self-start rounded-sm text-sm text-wafuu-ai underline underline-offset-2 hover:text-wafuu-ai-light focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                        自分が AI と指す設定に戻す
                    </button>
                </div>
            )}

            {setup.kind !== "humans" && (
                <div className="flex flex-col gap-1.5">
                    <label
                        htmlFor="play-setup-opponent"
                        className="text-xs font-medium text-wafuu-sumi-light"
                    >
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
                                {option.downloadMb !== null
                                    ? `（初回のみ約${option.downloadMb}MBのダウンロード）`
                                    : ""}
                            </option>
                        ))}
                    </NativeSelect>
                </div>
            )}

            {setup.kind !== "humans" && setup.opponent?.supportsLevel !== false && (
                <label className="flex flex-col gap-1.5">
                    <span className="flex items-baseline justify-between text-xs font-medium text-wafuu-sumi-light">
                        <span>
                            強さ
                            <span className="pl-2 font-normal text-muted-foreground">
                                0 が最も弱く、{SKILL_LEVEL_MAX} が最も強い
                            </span>
                        </span>
                        <span className="font-mono text-sm text-wafuu-sumi">
                            レベル {setup.level}
                        </span>
                    </span>
                    <input
                        type="range"
                        min={0}
                        max={SKILL_LEVEL_MAX}
                        value={setup.level}
                        disabled={setup.locked}
                        onChange={(event) => setup.chooseLevel(Number(event.target.value))}
                        className="h-6 w-full accent-wafuu-shu"
                    />
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

            <div className="flex flex-col gap-2">
                <Button
                    type="button"
                    size="lg"
                    onClick={handleStart}
                    className="h-12 w-full text-base font-semibold"
                >
                    {downloadMb !== null ? "ダウンロードして対局開始" : "対局開始"}
                </Button>
                <p className="text-center text-xs leading-relaxed text-muted-foreground">
                    {describeMatch(setup, sideChoice)}
                    {play?.isCustomStart ? " ・ 指定の局面から" : ""}
                    {downloadMb !== null && (
                        <>
                            <br />
                            初回だけ約 {downloadMb}MB のダウンロードがあります（すぐ指すなら相手を
                            「簡易AI」に）
                        </>
                    )}
                </p>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-t border-wafuu-border pt-4 text-sm">
                <button
                    type="button"
                    onClick={() => play?.openPositionEditor()}
                    className="rounded-sm text-wafuu-sumi underline underline-offset-2 hover:text-wafuu-shu focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                    局面を変えて指す（駒落ちなど）
                </button>
                <button
                    type="button"
                    onClick={onOpenAdvanced}
                    className="rounded-sm text-wafuu-sumi-light underline underline-offset-2 hover:text-wafuu-sumi focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                    詳細設定
                </button>
            </div>

            {play?.setupFooter}
        </section>
    );
}
