import type { Player } from "@shogi/app-core";
import type { ClockSettings } from "../hooks/useClockManager";
import type { EngineSearchLimit, EngineSearchLimits, SideSetting } from "../types";

export const SEARCH_NODES_MAX = 1_000_000_000;
export const SEARCH_DEPTH_MAX = 60;

const CLOCK_LIMIT: EngineSearchLimit = { kind: "clock" };

export const DEFAULT_ENGINE_SEARCH_LIMITS: EngineSearchLimits = {
    sente: CLOCK_LIMIT,
    gote: CLOCK_LIMIT,
};

const clampInt = (value: unknown, max: number): number | null =>
    typeof value === "number" && Number.isFinite(value) && value >= 1
        ? Math.min(max, Math.trunc(value))
        : null;

function normalizeEngineSearchLimit(value: unknown): EngineSearchLimit {
    if (!value || typeof value !== "object") return CLOCK_LIMIT;
    const raw = value as { kind?: unknown; nodes?: unknown; depth?: unknown };
    if (raw.kind === "nodes") {
        const nodes = clampInt(raw.nodes, SEARCH_NODES_MAX);
        return nodes === null ? CLOCK_LIMIT : { kind: "nodes", nodes };
    }
    if (raw.kind === "depth") {
        const depth = clampInt(raw.depth, SEARCH_DEPTH_MAX);
        return depth === null ? CLOCK_LIMIT : { kind: "depth", depth };
    }
    return CLOCK_LIMIT;
}

export function normalizeEngineSearchLimits(value: unknown): EngineSearchLimits {
    const raw = (value && typeof value === "object" ? value : {}) as Record<string, unknown>;
    return {
        sente: normalizeEngineSearchLimit(raw.sente),
        gote: normalizeEngineSearchLimit(raw.gote),
    };
}

/** その側の AI が、時計ではなくノード数・深さで読む量を決めているか。人の側は常に時計。 */
const usesFixedSearch = (
    sides: Record<Player, SideSetting>,
    limits: EngineSearchLimits,
    side: Player,
): boolean => sides[side].role === "engine" && limits[side].kind !== "clock";

/**
 * 時計に渡す時間設定。ノード数・深さで読む AI の側は時計を止める（読み終えるまで待つので、時間切れにしない）。
 * 保存してある時間はそのまま残し、時計どおりに戻したときに使う。
 */
export function clockSettingsForLimits(
    settings: ClockSettings,
    sides: Record<Player, SideSetting>,
    limits: EngineSearchLimits,
): ClockSettings {
    const off = (side: Player) =>
        usesFixedSearch(sides, limits, side)
            ? { ...settings[side], enabled: false }
            : settings[side];
    const sente = off("sente");
    const gote = off("gote");
    return sente === settings.sente && gote === settings.gote ? settings : { sente, gote };
}

/** 局面数を「12万」「3.4億」のように短く書く。 */
export function formatNodeCount(nodes: number): string {
    const units: Array<[number, string]> = [
        [100_000_000, "億"],
        [10_000, "万"],
    ];
    for (const [size, unit] of units) {
        if (nodes >= size) {
            const value = nodes / size;
            const text =
                value >= 100 ? String(Math.round(value)) : String(Math.round(value * 10) / 10);
            return `${text}${unit}`;
        }
    }
    return String(nodes);
}

/** 読みの上限の表示（「100万局面」「深さ 12」）。時計どおりなら null。 */
export function formatSearchLimit(limit: EngineSearchLimit): string | null {
    if (limit.kind === "nodes") return `${formatNodeCount(limit.nodes)}局面`;
    if (limit.kind === "depth") return `深さ ${limit.depth}`;
    return null;
}
