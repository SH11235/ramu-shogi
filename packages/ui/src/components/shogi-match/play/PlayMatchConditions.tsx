/**
 * 終局のダイアログに出す、この対局の条件（開始局面・相手の AI と強さ・読む量・あなたの手番と時間）。
 * どの AI に、どの強さ・読む量で勝ったかを、スクリーンショットにしても分かるように項目名つきで並べる。
 */

import type { Player } from "@shogi/app-core";
import { SKILL_LEVEL_MAX } from "@shogi/engine-client";
import type { ReactElement } from "react";
import { Fragment } from "react";
import { useMatchSettings } from "../contexts/MatchSettingsContext";
import { useMatchState } from "../contexts/MatchStateContext";
import { useNavigation } from "../contexts/NavigationContext";
import { useShogiMatchConfig } from "../ShogiMatchContext";
import { formatNodeCount, formatSearchLimit } from "../utils/searchLimits";
import { resolveThreadCount, threadCapOf } from "../utils/threadOptions";
import { formatTimeRule } from "../utils/timeSettings";
import { averageReading } from "./PlayEngineReading";
import { startPositionLabel } from "./startPositions";

const SIDE_MARK: Record<Player, string> = { sente: "☗ 先手", gote: "☖ 後手" };

interface ConditionRow {
    id: string;
    label: string;
    value: string;
    /** 値の下に小さく添える行（この端末での平均の速さなど） */
    note?: string;
}

function useConditionRows(): ConditionRow[] {
    const { play } = useShogiMatchConfig();
    const { sides } = useMatchState();
    const { timeSettings, engineSearchLimits, engineThreads, engineOptions } = useMatchSettings();
    const { kifMoves, kifuTree } = useNavigation();
    if (!play) return [];

    const timeText = (side: Player): string => {
        const rule = timeSettings[side];
        return rule.enabled ? formatTimeRule(rule, { perMove: true }) : "時間無制限";
    };
    const engineSides = (["sente", "gote"] as const).filter(
        (side) => sides[side].role === "engine",
    );
    const humanSides = (["sente", "gote"] as const).filter((side) => sides[side].role === "human");
    const rows: ConditionRow[] = [
        {
            id: "start",
            label: "開始局面",
            // 棋譜の途中の局面から指し始めたときは、何手目からかを添える（棋譜の最初の局面は元のまま）。
            value:
                play.startPly > 0
                    ? `${startPositionLabel(kifuTree?.startSfen ?? "startpos")}の ${play.startPly}手目の局面から`
                    : startPositionLabel(kifuTree?.startSfen ?? "startpos"),
        },
    ];

    for (const side of engineSides) {
        const setting = sides[side];
        const engine = engineOptions?.find((option) => option.id === setting.engineId);
        const level =
            engine?.kind === "external"
                ? ""
                : `　レベル ${setting.skillLevel?.skillLevel ?? SKILL_LEVEL_MAX}`;
        const limit = formatSearchLimit(engineSearchLimits[side]) ?? timeText(side);
        // この対局で指した手だけ（棋譜の途中から始めたときの、それより前の手は数えない）。
        const sideMoves = kifMoves.filter(
            (move) =>
                move.ply > play.startPly &&
                move.engineSearch &&
                (move.mover ?? (move.ply % 2 === 1 ? "sente" : "gote")) === side,
        );
        // スレッド数は、手を決めたときにエンジンが実際に使った数を優先する（設定より少なくなることがある）。
        // 外部エンジンの「自動」は登録時の設定のまま動き、その数はこちらから分からないので出さない。
        const recordedThreads = [...sideMoves].reverse().find((move) => move.engineSearch?.threads)
            ?.engineSearch?.threads;
        const threads =
            recordedThreads ??
            (engine?.kind === "external" && engineThreads[side] === 0
                ? null
                : resolveThreadCount(
                      engineThreads[side],
                      threadCapOf(engineOptions, [setting.engineId]),
                  ));
        // 時間で読む量を決めると、端末の速さで読める局面の数（＝強さ）が変わるので、実際の速さも添える。
        const average = averageReading(sideMoves);
        rows.push(
            {
                id: `${side}-engine`,
                label: engineSides.length > 1 ? SIDE_MARK[side] : "相手",
                value: `${play.playerNames[side]}${level}`,
            },
            {
                id: `${side}-limit`,
                label: "読む量",
                value: threads === null ? limit : `${limit}・スレッド ${threads}`,
                note:
                    average.nps !== null
                        ? `この端末で 平均 ${formatNodeCount(average.nps)}局面/秒`
                        : undefined,
            },
        );
    }
    for (const side of humanSides) {
        rows.push({
            id: `${side}-human`,
            label: humanSides.length > 1 ? SIDE_MARK[side] : "あなた",
            value:
                humanSides.length > 1
                    ? timeText(side)
                    : `${side === "sente" ? "先手" : "後手"}・${timeText(side)}`,
        });
    }
    return rows;
}

export function PlayMatchConditions(): ReactElement | null {
    const rows = useConditionRows();
    if (rows.length === 0) return null;
    return (
        <dl className="m-0 grid grid-cols-[4.5rem_minmax(0,1fr)] items-baseline gap-x-3 gap-y-1 border-t border-wafuu-border pt-2">
            {rows.map((row) => (
                <Fragment key={row.id}>
                    <dt className="text-xs text-wafuu-sumi-light">{row.label}</dt>
                    <dd className="m-0 text-sm text-wafuu-sumi">
                        {row.value}
                        {row.note && (
                            <span className="block text-xs text-wafuu-sumi-light">{row.note}</span>
                        )}
                    </dd>
                </Fragment>
            ))}
        </dl>
    );
}
