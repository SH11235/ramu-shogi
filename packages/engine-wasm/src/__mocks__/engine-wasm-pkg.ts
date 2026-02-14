// Mock for ../pkg/engine_wasm.js
// This mock is used in tests to avoid loading the actual WASM module

import { vi } from "vitest";

// Mock the WASM module initialization
const mockDefault = vi.fn().mockResolvedValue({});
export default mockDefault;

// Mock WASM functions
export const wasm_get_initial_board = vi.fn().mockReturnValue({});
export const wasm_parse_sfen_to_board = vi.fn().mockReturnValue({});
export const wasm_board_to_sfen = vi.fn().mockReturnValue("startpos");
export const wasm_get_legal_moves = vi.fn().mockReturnValue([]);
export const wasm_replay_moves_strict = vi.fn().mockReturnValue({
    applied: [],
    last_ply: 0,
    board: {},
});
export const initThreadPool = vi.fn().mockResolvedValue(undefined);
export const init = vi.fn();
export const dispose = vi.fn();
export const load_model = vi.fn();
export const load_position = vi.fn();
export const apply_moves = vi.fn();
export const search = vi.fn();
export const stop = vi.fn();
export const set_event_handler = vi.fn();
export const set_option = vi.fn();
export const wasm_get_move_features = vi.fn().mockReturnValue({
    movedPiece: "P",
    movedPiecePromoted: false,
    isCapture: false,
    isPromote: false,
    isDrop: false,
    isCheck: false,
});
