import type { ReactElement } from "react";
import type { EvalHistory } from "../utils/kifFormat";
import { formatEval } from "../utils/kifFormat";

// 評価値(センチポーン)→先手勝率の換算スケール。いわゆる Ponanza 定数。
// EvalGraph は生の評価値を線形スケールで描くのに対し、形勢バーは
// 「どちらがどれだけ優勢か」を直感で読ませたいので勝率換算にする。
const WIN_RATE_SCALE = 600;

/**
 * 評価値を先手勝率 (0〜1) に換算する。
 * - 詰みあり: 先手勝ち=1 / 後手勝ち=0
 * - 評価値なし(未解析): 互角扱いの 0.5
 */
export function evalToSenteWinRate(evalCp: number | null, evalMate: number | null): number {
    if (evalMate !== null) {
        return evalMate > 0 ? 1 : 0;
    }
    if (evalCp === null) {
        return 0.5;
    }
    return 1 / (1 + Math.exp(-evalCp / WIN_RATE_SCALE));
}

type Advantage = "sente" | "gote" | "even";

/** 現在の優勢側。意味色(先手=朱/後手=藍)の割当てに使う */
export function evalAdvantage(evalCp: number | null, evalMate: number | null): Advantage {
    if (evalMate !== null) {
        return evalMate > 0 ? "sente" : "gote";
    }
    if (evalCp === null || evalCp === 0) {
        return "even";
    }
    return evalCp > 0 ? "sente" : "gote";
}

const advantageTextClass: Record<Advantage, string> = {
    sente: "text-wafuu-shu",
    gote: "text-wafuu-ai",
    even: "text-muted-foreground",
};

interface EvalScoreboardProps {
    /** 現在手の評価値エントリ。未解析局面では undefined */
    entry?: EvalHistory;
}

/**
 * 評価値スコアボード（検討室の計器）
 *
 * 現在局面の評価値と形勢バー(先手=朱/後手=藍、勝率換算の充填率)を表示する。
 * 折りたたみ状態の EvalPanel でも常時見えるヘッダー直下に置かれる想定。
 */
export function EvalScoreboard({ entry }: EvalScoreboardProps): ReactElement {
    const evalCp = entry?.evalCp ?? null;
    const evalMate = entry?.evalMate ?? null;
    // 未解析(データ無し)は「互角(50%)」と見た目で区別する。互角は朱藍が半分ずつ、
    // 未解析はバー全体を muted にして「まだ形勢を知らない」ことを示す。
    const hasEval = evalCp !== null || evalMate !== null;
    const senteRate = evalToSenteWinRate(evalCp, evalMate);
    const advantage = evalAdvantage(evalCp, evalMate);
    const label = formatEval(evalCp ?? undefined, evalMate ?? undefined);

    return (
        <div className="flex items-center gap-3">
            {/* 評価値（先手視点） */}
            <span
                className={`min-w-14 text-right font-mono text-xl font-semibold leading-none tabular-nums ${advantageTextClass[advantage]}`}
                data-testid="eval-scoreboard-value"
            >
                {label === "" ? "—" : label}
            </span>
            {/* 形勢バー: 左から先手(朱)の勝率ぶんを充填し、残りが後手(藍) */}
            <div className="flex min-w-0 flex-1 flex-col gap-1">
                <div
                    className={`relative h-2.5 w-full overflow-hidden rounded-full ${
                        hasEval ? "bg-wafuu-ai" : "bg-muted"
                    }`}
                    role="img"
                    aria-label={
                        hasEval
                            ? `形勢バー: 先手勝率 ${Math.round(senteRate * 100)}%`
                            : "形勢バー: 未解析"
                    }
                >
                    {hasEval && (
                        <div
                            className="absolute inset-y-0 left-0 bg-wafuu-shu"
                            style={{ width: `${senteRate * 100}%` }}
                            data-testid="eval-scoreboard-bar-sente"
                        />
                    )}
                </div>
                <div className="flex justify-between font-mono text-[10px] leading-none text-muted-foreground tabular-nums">
                    <span>▲先手</span>
                    <span>△後手</span>
                </div>
            </div>
        </div>
    );
}
