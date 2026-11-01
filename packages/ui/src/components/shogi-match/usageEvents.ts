import type { GameResult, NnueSelection, Player } from "@shogi/app-core";
import type { UsageEvents } from "../../providers/UsageContext";
import type { ClockSettings } from "./hooks/useClockManager";
import { findStartPosition, isHirateStart } from "./play/startPositions";
import type { SideSetting } from "./types";

type Sides = { sente: SideSetting; gote: SideSetting };

const humanSideOf = (sides: Sides): Player | null => {
    const senteHuman = sides.sente.role === "human";
    const goteHuman = sides.gote.role === "human";
    if (senteHuman === goteHuman) return null;
    return senteHuman ? "sente" : "gote";
};

function playersOf(sides: Sides): UsageEvents["match_start"]["players"] {
    const engines = [sides.sente, sides.gote].filter((side) => side.role === "engine").length;
    return engines === 0 ? "human_human" : engines === 1 ? "human_ai" : "ai_ai";
}

function aiNameOf(selection: NnueSelection): string {
    if (selection.presetKey) return selection.presetKey;
    return selection.nnueId ? "custom" : "material";
}

function timeKindOf(clock: ClockSettings[Player]): UsageEvents["match_start"]["time"] {
    if (!clock.enabled) return "none";
    if (clock.byoyomiMs > 0) return "byoyomi";
    if (clock.incrementMs > 0) return "fischer";
    return "sudden";
}

function startKindOf(startSfen: string, movesBeforeStart: number) {
    if (movesBeforeStart > 0) return "position";
    if (isHirateStart(startSfen)) return "even";
    return findStartPosition(startSfen) ? "handicap" : "position";
}

/** 対局画面で対局が始まったときのイベント。AI は人の相手（AI どうしなら先手）を送る */
export function matchStartEvent({
    sides,
    selections,
    timeSettings,
    startSfen,
    movesBeforeStart,
}: {
    sides: Sides;
    selections: Record<Player, NnueSelection>;
    timeSettings: ClockSettings;
    startSfen: string;
    movesBeforeStart: number;
}): UsageEvents["match_start"] {
    const players = playersOf(sides);
    const humanSide = humanSideOf(sides);
    const aiSide: Player | null =
        players === "human_human" ? null : humanSide === "sente" ? "gote" : "sente";
    return {
        players,
        ...(aiSide ? { ai: aiNameOf(selections[aiSide]) } : {}),
        time: timeKindOf(timeSettings[humanSide ?? "sente"]),
        start: startKindOf(startSfen, movesBeforeStart),
    };
}

/** 終局のイベント。人と AI の対局は人から見た勝ち負け、それ以外は勝った側で送る */
export function matchEndEvent(result: GameResult, sides: Sides): UsageEvents["match_end"] {
    const humanSide = humanSideOf(sides);
    return {
        result: humanSide
            ? result.winner === humanSide
                ? "win"
                : "loss"
            : result.winner === "sente"
              ? "sente_win"
              : "gote_win",
        reason: result.reason.kind,
        plies: result.totalMoves,
    };
}
