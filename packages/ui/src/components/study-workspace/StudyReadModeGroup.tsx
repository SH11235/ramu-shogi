import { cn } from "@shogi/design-system";
import type { ReactElement } from "react";
import { RamRunningIcon } from "../ram-running-icon";

/**
 * 研究ノートの読み方。エンジンは一度に 1 つしか読めないので、どれか 1 つを選ぶ。
 * - `read`: 開いている局面を読み続ける（局面を移れば、移った先を）。
 * - `pass`: いまの局面にパスを変化として足し、パスした局面を読み続ける。
 * - `mate`: 開いている局面の詰みを探す（局面を移れば、移った先を）。
 * - `stop`: 読まない。
 */
export type StudyReadMode = "read" | "pass" | "mate" | "stop";

const OPTIONS: readonly { mode: StudyReadMode; label: string; title: string }[] = [
    { mode: "read", label: "読む", title: "開いている局面を読み続けます" },
    {
        mode: "pass",
        label: "パス",
        title: "いまの手番を飛ばして、もう一方の側の狙いを読みます（パスは変化として足します）",
    },
    { mode: "mate", label: "詰み", title: "開いている局面の詰み・詰めろを探します" },
    { mode: "stop", label: "停止", title: "読むのを止めます（読んだ分は残ります）" },
];

/** 選んでいる読み方の、グループの下に出す説明。 */
export const STUDY_READ_MODE_STATUS: Record<StudyReadMode, string> = {
    read: "開いている局面を読み続けます",
    pass: "パスした局面を読み続けます",
    mate: "開いている局面の詰みを探します",
    stop: "読んでいません",
};

/**
 * 読み方を選ぶ 4 つの枠。名前は枠の真ん中に置き、ラムは選んだ枠の左端に重ねる（並びの外に置くので、
 * 選び直しても名前が動かない）。読んでいる間はラムが走り、停止では止まったラムを出す。
 */
export function StudyReadModeGroup({
    mode,
    onChange,
    running,
    disabled = {},
    describedBy,
    className,
}: {
    mode: StudyReadMode;
    onChange: (mode: StudyReadMode) => void;
    /** 選んでいる読み方で、いま CPU を使っている（ラムを走らせる）。 */
    running: boolean;
    /** 選べない読み方（全体の解析の途中のパス、詰み探索の無いエンジンの詰み など）。 */
    disabled?: Partial<Record<StudyReadMode, boolean>>;
    /** 選んでいる読み方の状態を書いた要素の id（画面読み上げ向け）。 */
    describedBy?: string;
    className?: string;
}): ReactElement {
    // 矢印キーで選び直すラジオボタンにはしない（「パス」は棋譜に変化を足すので、通り過ぎるだけで
    // 足してしまう）。押すと選ぶボタンを並べ、選んでいる枠は aria-pressed で伝える。
    return (
        <fieldset
            aria-describedby={describedBy}
            className={cn(
                "m-0 grid min-w-0 grid-cols-4 overflow-hidden rounded-lg border border-border bg-wafuu-washi p-0",
                className,
            )}
        >
            <legend className="sr-only">読み方</legend>
            {OPTIONS.map((option, index) => {
                const selected = option.mode === mode;
                return (
                    <button
                        key={option.mode}
                        type="button"
                        aria-pressed={selected}
                        title={option.title}
                        disabled={disabled[option.mode] === true}
                        onClick={() => {
                            if (!selected) onChange(option.mode);
                        }}
                        className={cn(
                            "relative flex h-10 items-center justify-center whitespace-nowrap text-sm transition-colors",
                            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
                            "disabled:cursor-not-allowed disabled:opacity-40",
                            index > 0 && "border-l border-border",
                            selected
                                ? "bg-wafuu-sumi font-bold text-wafuu-washi"
                                : "font-medium text-wafuu-sumi hover:bg-wafuu-washi-warm",
                        )}
                    >
                        {selected && (
                            <RamRunningIcon
                                dotSize={1}
                                running={running && option.mode !== "stop"}
                                // 狭い欄（1 枠 約 68px）でも名前に重ならない大きさに縮める。
                                className="absolute left-0.5 top-1/2 origin-left -translate-y-1/2 scale-[0.7]"
                            />
                        )}
                        {option.label}
                    </button>
                );
            })}
        </fieldset>
    );
}
