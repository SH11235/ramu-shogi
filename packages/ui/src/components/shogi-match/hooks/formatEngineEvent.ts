import type { EngineControllerEvent } from "@shogi/app-core";

export function formatEngineEventLog(log: EngineControllerEvent): string {
    const labelBase = log.side ? (log.side === "sente" ? "S" : "G") : "Analysis";
    const label = log.engineId ? `${labelBase}:${log.engineId}` : labelBase;
    const event = log.event;

    if (event.type === "bestmove") {
        return `[${label}] bestmove ${event.move}`;
    }
    if (event.type === "info") {
        const parts: string[] = [`[${label}] info`];
        if (event.depth !== undefined) parts.push(`depth ${event.depth}`);
        if (event.seldepth !== undefined) parts.push(`seldepth ${event.seldepth}`);
        if (event.scoreCp !== undefined) parts.push(`score cp ${event.scoreCp}`);
        if (event.nodes !== undefined) parts.push(`nodes ${event.nodes}`);
        if (event.nps !== undefined) parts.push(`nps ${event.nps}`);
        if (event.pv && event.pv.length > 0) parts.push(`pv ${event.pv.join(" ")}`);
        return parts.join(" ");
    }
    if (event.type === "error") {
        return `[${label}] error: ${event.message}`;
    }
    return `[${label}] unknown event`;
}
