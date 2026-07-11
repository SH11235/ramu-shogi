import type { MoveSearchStats, Player } from "@shogi/app-core";

interface JsonlMoveNode {
    moveUsi: string;
    sfenBefore: string;
    /** この手を指した側。開始局面が後手番の場合があるため偶奇では決めない */
    sideToMove: Player;
    elapsedMs?: number;
    searchStats?: MoveSearchStats;
}

interface JsonlExportMeta {
    timestamp?: Date;
    output: string;
    startSfen: string;
    maxMoves: number;
    byoyomiMs: number;
    mainTimeMs: number;
    threads: number;
    hashMb: number;
    labels: Record<Player, string>;
    result?: {
        outcome: "black_win" | "white_win" | "draw";
        reason: string;
        winner?: Player;
    };
}

const compactEval = (stats: MoveSearchStats | undefined): Record<string, unknown> | undefined => {
    if (!stats) return undefined;
    const values = {
        score_cp: stats.scoreCp,
        score_mate: stats.scoreMate,
        depth: stats.depth,
        seldepth: stats.seldepth,
        nodes: stats.nodes,
        time_ms: stats.timeMs,
        nps: stats.nps,
        pv: stats.pv,
    };
    const entries = Object.entries(values).filter(([, value]) => value !== undefined);
    return entries.length > 0 ? Object.fromEntries(entries) : undefined;
};

export function exportToRshogiJsonl(nodes: JsonlMoveNode[], meta: JsonlExportMeta): string {
    const settings: Record<string, number> = {
        games: 1,
        max_moves: meta.maxMoves,
        byoyomi: meta.byoyomiMs,
        threads: meta.threads,
        hash_mb: meta.hashMb,
    };
    if (meta.mainTimeMs > 0) settings.btime = meta.mainTimeMs;
    const lines: unknown[] = [
        {
            type: "meta",
            timestamp: (meta.timestamp ?? new Date()).toISOString(),
            settings,
            engine_cmd: {
                path_black: meta.labels.sente,
                path_white: meta.labels.gote,
                label_black: meta.labels.sente,
                label_white: meta.labels.gote,
                usi_options_black: [],
                usi_options_white: [],
            },
            start_positions: [
                meta.startSfen === "startpos"
                    ? "position startpos"
                    : `position sfen ${meta.startSfen}`,
            ],
            output: meta.output,
        },
        ...nodes.map((node, index) => {
            const stats = node.searchStats;
            const evalEntry = compactEval(stats);
            return {
                type: "move",
                game_id: 1,
                ply: index + 1,
                side_to_move: node.sideToMove === "sente" ? "b" : "w",
                sfen_before: node.sfenBefore,
                move_usi: node.moveUsi,
                engine: stats?.engineId ?? meta.labels[node.sideToMove],
                elapsed_ms: node.elapsedMs ?? 0,
                think_limit_ms: stats?.thinkLimitMs ?? 0,
                timed_out: false,
                ...(evalEntry ? { eval: evalEntry } : {}),
            };
        }),
    ];
    if (meta.result) {
        lines.push({
            type: "result",
            game_id: 1,
            outcome: meta.result.outcome,
            reason: meta.result.reason,
            plies: nodes.length,
            ...(meta.result.winner ? { winner: meta.labels[meta.result.winner] } : {}),
        });
    }
    return lines.map((line) => JSON.stringify(line)).join("\n");
}
