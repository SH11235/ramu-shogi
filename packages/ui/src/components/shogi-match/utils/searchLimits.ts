import type { Player } from "@shogi/app-core";
import type { ClockSettings } from "../hooks/useClockManager";
import type { EngineSearchLimit, EngineSearchLimits, SideSetting } from "../types";

export const SEARCH_NODES_MAX = 1_000_000_000;
export const SEARCH_DEPTH_MAX = 60;

export type SearchLimitKind = "nodes" | "depth";

/** 時計ではなく数で決めた読む量。 */
export type FixedSearchLimit = Extract<EngineSearchLimit, { kind: SearchLimitKind }>;

/** 数で読む量に切り替えたとき、はじめに入れておく数。 */
export const SEARCH_LIMIT_DEFAULTS: Record<SearchLimitKind, number> = {
    nodes: 1_000_000,
    depth: 12,
};

const SEARCH_LIMIT_MAX: Record<SearchLimitKind, number> = {
    nodes: SEARCH_NODES_MAX,
    depth: SEARCH_DEPTH_MAX,
};

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

/**
 * 入れられた読む量を数にする。日本語入力のまま打った全角数字や、桁区切りのカンマも受ける。
 * 1 未満・上限超え・整数でないものは、理由を添えて弾く。
 */
export function parseSearchLimitInput(
    text: string,
    kind: SearchLimitKind,
): { limit: FixedSearchLimit; error: null } | { limit: null; error: string } {
    const normalized = text.normalize("NFKC").replace(/,/g, "").trim();
    const value = /^[0-9]+$/.test(normalized) ? Number(normalized) : null;
    const max = SEARCH_LIMIT_MAX[kind];
    if (value === null || value < 1) return { limit: null, error: "1 以上の整数で入れてください" };
    if (value > max) return { limit: null, error: `${max.toLocaleString()} 以下にしてください` };
    return {
        limit: kind === "nodes" ? { kind, nodes: value } : { kind, depth: value },
        error: null,
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
