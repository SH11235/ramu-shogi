/**
 * CSA対局のセッション状態を管理するカスタムフック
 *
 * "csa://session" イベントを購読し、useReducer で状態遷移を管理する。
 * start/stop/reset の操作関数を提供する。
 */

import { invoke } from "@tauri-apps/api/core";
import type { UnlistenFn } from "@tauri-apps/api/event";
import { listen } from "@tauri-apps/api/event";
import { useEffect, useReducer, useRef } from "react";

// ─── Types ───

export interface CsaConfig {
    server: {
        host: string;
        port: number;
        user_id: string;
        password: string;
        floodgate: boolean;
    };
    engine: {
        type: "builtin" | "external";
        registration_id: string | null;
        options: Record<string, unknown>;
        ponder: boolean;
        startup_timeout_sec: number;
    };
    time: {
        margin_ms: number;
    };
    game: {
        max_games: number;
    };
    record: {
        save_dir: string;
    };
}

type CsaGameStatus = "idle" | "connecting" | "waiting" | "playing" | "finished" | "error";

export interface CsaClocks {
    sente_ms: number;
    gote_ms: number;
    byoyomi_ms: number;
    increment_ms: number;
}

export interface CsaSearchInfo {
    depth: number;
    score_cp: number | null;
    score_mate: number | null;
    pv: string[];
    nps: number;
}

export interface CsaGameState {
    status: CsaGameStatus;
    gameId: string | null;
    myColor: "sente" | "gote" | null;
    senteName: string | null;
    goteName: string | null;
    sfen: string | null;
    moves: string[];
    clocks: CsaClocks | null;
    searchInfo: CsaSearchInfo | null;
    result: string | null;
    error: string | null;
    gamesPlayed: number;
    recordPath: string | null;
}

// ─── Session Events (from Rust backend) ───

type CsaSessionEvent =
    | { type: "connected"; host: string }
    | {
          type: "game_summary";
          game_id: string;
          my_color: string;
          sente_name: string;
          gote_name: string;
          sfen: string;
          clocks: {
              black_time_ms: number;
              white_time_ms: number;
              byoyomi_ms: number;
              increment_ms: number;
          };
      }
    | { type: "game_started" }
    | {
          type: "move";
          side: string;
          usi: string;
          sfen: string;
          clock: { sente_ms: number; gote_ms: number };
      }
    | {
          type: "search_info";
          depth: number;
          score_cp: number | null;
          score_mate: number | null;
          pv: string[];
          nps: number;
      }
    | {
          type: "game_ended";
          result: string;
          reason: string | null;
          games_played: number;
          record_path: string | null;
      }
    | { type: "disconnected" }
    | { type: "error"; message: string };

// ─── Reducer ───

type CsaAction = { type: "session_event"; event: CsaSessionEvent } | { type: "reset" };

const INITIAL_STATE: CsaGameState = {
    status: "idle",
    gameId: null,
    myColor: null,
    senteName: null,
    goteName: null,
    sfen: null,
    moves: [],
    clocks: null,
    searchInfo: null,
    result: null,
    error: null,
    gamesPlayed: 0,
    recordPath: null,
};

function csaGameReducer(state: CsaGameState, action: CsaAction): CsaGameState {
    if (action.type === "reset") {
        return INITIAL_STATE;
    }

    const event = action.event;

    switch (event.type) {
        case "connected":
            return { ...state, status: "connecting", error: null };

        case "game_summary":
            return {
                ...state,
                status: "waiting",
                gameId: event.game_id,
                myColor: event.my_color === "gote" ? "gote" : "sente",
                senteName: event.sente_name,
                goteName: event.gote_name,
                sfen: event.sfen,
                moves: [],
                clocks: {
                    sente_ms: event.clocks.black_time_ms,
                    gote_ms: event.clocks.white_time_ms,
                    byoyomi_ms: event.clocks.byoyomi_ms,
                    increment_ms: event.clocks.increment_ms,
                },
                searchInfo: null,
                result: null,
                recordPath: null,
            };

        case "game_started":
            return { ...state, status: "playing" };

        case "move":
            return {
                ...state,
                sfen: event.sfen,
                moves: [...state.moves, event.usi],
                clocks: state.clocks
                    ? {
                          ...state.clocks,
                          sente_ms: event.clock.sente_ms,
                          gote_ms: event.clock.gote_ms,
                      }
                    : null,
            };

        case "search_info":
            return {
                ...state,
                searchInfo: {
                    depth: event.depth,
                    score_cp: event.score_cp,
                    score_mate: event.score_mate,
                    pv: event.pv,
                    nps: event.nps,
                },
            };

        case "game_ended":
            return {
                ...state,
                status: "finished",
                result: event.result,
                gamesPlayed: event.games_played,
                recordPath: event.record_path,
            };

        case "disconnected":
            // disconnected が来たら、finished/error 以外なら idle に戻す
            if (state.status === "finished" || state.status === "error") {
                return state;
            }
            return { ...state, status: "idle" };

        case "error":
            return { ...state, status: "error", error: event.message };

        default:
            return state;
    }
}

// ─── Hook ───

export interface UseCsaGameReturn {
    state: CsaGameState;
    start: (config: CsaConfig) => Promise<void>;
    stop: () => Promise<void>;
    reset: () => void;
}

export function useCsaGame(): UseCsaGameReturn {
    const [state, dispatch] = useReducer(csaGameReducer, INITIAL_STATE);
    const unlistenRef = useRef<UnlistenFn | null>(null);

    useEffect(() => {
        let cancelled = false;

        listen<CsaSessionEvent>("csa://session", (event) => {
            if (!cancelled) {
                dispatch({ type: "session_event", event: event.payload });
            }
        })
            .then((unlisten) => {
                if (cancelled) {
                    unlisten();
                } else {
                    unlistenRef.current = unlisten;
                }
            })
            .catch((e) => {
                console.error("CSA session listener setup failed:", e);
            });

        return () => {
            cancelled = true;
            if (unlistenRef.current) {
                unlistenRef.current();
                unlistenRef.current = null;
            }
        };
    }, []);

    const start = async (config: CsaConfig): Promise<void> => {
        dispatch({ type: "reset" });
        try {
            await invoke("csa_start", { config });
        } catch (e) {
            dispatch({
                type: "session_event",
                event: {
                    type: "error",
                    message: e instanceof Error ? e.message : String(e),
                },
            });
        }
    };

    const stop = async (): Promise<void> => {
        try {
            await invoke("csa_stop");
        } catch (e) {
            dispatch({
                type: "session_event",
                event: {
                    type: "error",
                    message: e instanceof Error ? e.message : String(e),
                },
            });
        }
    };

    const reset = (): void => {
        dispatch({ type: "reset" });
    };

    return { state, start, stop, reset };
}
