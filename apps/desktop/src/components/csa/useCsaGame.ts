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
        tcp_keepalive: boolean;
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
        restart_engine_every_game: boolean;
    };
    record: {
        save_dir: string;
    };
    reconnect: {
        game_id: string;
        token: string;
    } | null;
}

type CsaGameStatus = "idle" | "connecting" | "waiting" | "playing" | "finished" | "error";

export interface CsaSearchInfo {
    depth: number | null;
    seldepth: number | null;
    score_cp: number | null;
    score_mate: number | null;
    nodes: number | null;
    nps: number | null;
    time_ms: number | null;
    pv: string[];
}

export interface CsaResumeState {
    gameId: string;
    senteName: string;
    goteName: string;
    lastSfen: string;
    lastPly: number;
    sideToMove: "black" | "white";
    remainingTimeSelf: number | null;
    remainingTimeOpp: number | null;
}

export interface CsaGameState {
    status: CsaGameStatus;
    gameId: string | null;
    myColor: "black" | "white" | null;
    senteName: string | null;
    goteName: string | null;
    sfen: string | null;
    moves: string[];
    searchInfo: CsaSearchInfo | null;
    result: string | null;
    error: string | null;
    resumeState: CsaResumeState | null;
}

// ─── Session Events (from Rust backend) ───

type Side = "black" | "white";

type CsaSessionEvent =
    | { type: "connected" }
    | {
          type: "game_summary";
          game_id: string;
          my_color: Side;
          sente_name: string;
          gote_name: string;
      }
    | {
          type: "resumed";
          game_id: string;
          sente_name: string;
          gote_name: string;
          last_sfen: string;
          last_ply: number;
          side_to_move: Side;
          remaining_time_sec_self: number | null;
          remaining_time_sec_opp: number | null;
      }
    | { type: "game_started" }
    | {
          type: "best_move_selected";
          usi_move: string;
          csa_move: string | null;
          ponder: string | null;
          side: Side;
          ply: number;
      }
    | {
          type: "move_sent";
          player: "self" | "opponent";
          usi_move: string;
          csa_move: string;
          side: Side;
          ply: number;
          sfen_before: string;
          sfen_after: string;
      }
    | {
          type: "move";
          player: "self" | "opponent";
          usi_move: string;
          csa_move: string;
          side: Side;
          ply: number;
          time_sec: number | null;
          sfen_before: string;
          sfen_after: string;
          search: CsaSearchInfo | null;
      }
    | {
          type: "search_info";
          info: CsaSearchInfo;
      }
    | {
          type: "game_ended";
          result: string;
          reason: string;
          winner: Side | null;
          raw_result_line: string | null;
          raw_reason_line: string | null;
      }
    | { type: "disconnected"; reason: string }
    | { type: "error"; kind: string; message: string };

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
    searchInfo: null,
    result: null,
    error: null,
    resumeState: null,
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
                myColor: event.my_color,
                senteName: event.sente_name,
                goteName: event.gote_name,
                sfen: null,
                moves: [],
                searchInfo: null,
                result: null,
                resumeState: null,
            };

        case "resumed":
            return {
                ...state,
                status: "waiting",
                gameId: event.game_id,
                senteName: event.sente_name,
                goteName: event.gote_name,
                sfen: event.last_sfen,
                moves: [],
                searchInfo: null,
                result: null,
                resumeState: {
                    gameId: event.game_id,
                    senteName: event.sente_name,
                    goteName: event.gote_name,
                    lastSfen: event.last_sfen,
                    lastPly: event.last_ply,
                    sideToMove: event.side_to_move,
                    remainingTimeSelf: event.remaining_time_sec_self,
                    remainingTimeOpp: event.remaining_time_sec_opp,
                },
            };

        case "game_started":
            return { ...state, status: "playing" };

        case "move":
            return {
                ...state,
                sfen: event.sfen_after,
                moves: [...state.moves, event.usi_move],
                searchInfo: event.search ?? state.searchInfo,
            };

        case "search_info":
            return {
                ...state,
                searchInfo: event.info,
            };

        case "best_move_selected":
        case "move_sent":
            return state;

        case "game_ended":
            return {
                ...state,
                status: "finished",
                result: event.result,
            };

        case "disconnected":
            if (state.status === "finished" || state.status === "error") {
                return state;
            }
            return { ...state, status: "idle" };

        case "error":
            return {
                ...state,
                status: "error",
                error: `${event.kind}: ${event.message}`,
            };

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
                    kind: "start",
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
                    kind: "stop",
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
