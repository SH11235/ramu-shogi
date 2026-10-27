import type { PieceType } from "@shogi/app-core";

/** 盤の選択・成りの確認・棋譜の巻き戻し・シートとダイアログの開閉など、画面だけで持つ状態 */
interface UIState {
    selectedSquare: string | null;
    selectedHand: PieceType | null;
    legalMoves: string[];
    promoteDialog: { from: string; to: string; usi: string } | null;
    navIndex: number | null;
    aiSheetOpen: boolean;
    kifuSheetOpen: boolean;
    endDialogClosed: boolean;
}

type UIAction =
    | { type: "move_received" } // selectedSquare, selectedHand, legalMoves を一括リセット
    | { type: "resync_received" } // 選択・成り選択・合法手・navIndex を一括リセット
    | { type: "clear_selection" } // selectedSquare, selectedHand を一括リセット
    | { type: "select_square"; squareId: string | null }
    | { type: "select_hand"; pieceType: PieceType | null }
    | { type: "set_legal_moves"; moves: string[] }
    | { type: "set_promote_dialog"; dialog: { from: string; to: string; usi: string } | null }
    | { type: "set_nav_index"; index: number | null }
    | { type: "set_ai_sheet_open"; open: boolean }
    | { type: "set_kifu_sheet_open"; open: boolean }
    | { type: "set_end_dialog_closed"; closed: boolean };

export const INITIAL_UI_STATE: UIState = {
    selectedSquare: null,
    selectedHand: null,
    legalMoves: [],
    promoteDialog: null,
    navIndex: null,
    aiSheetOpen: false,
    kifuSheetOpen: false,
    endDialogClosed: false,
};

export function uiReducer(state: UIState, action: UIAction): UIState {
    switch (action.type) {
        case "move_received":
            return { ...state, selectedSquare: null, selectedHand: null, legalMoves: [] };
        case "resync_received":
            return {
                ...state,
                selectedSquare: null,
                selectedHand: null,
                legalMoves: [],
                promoteDialog: null,
                navIndex: null,
            };
        case "clear_selection":
            return { ...state, selectedSquare: null, selectedHand: null };
        case "select_square":
            return { ...state, selectedSquare: action.squareId };
        case "select_hand":
            return { ...state, selectedHand: action.pieceType };
        case "set_legal_moves":
            return { ...state, legalMoves: action.moves };
        case "set_promote_dialog":
            return { ...state, promoteDialog: action.dialog };
        case "set_nav_index":
            return { ...state, navIndex: action.index };
        case "set_ai_sheet_open":
            return { ...state, aiSheetOpen: action.open };
        case "set_kifu_sheet_open":
            return { ...state, kifuSheetOpen: action.open };
        case "set_end_dialog_closed":
            return { ...state, endDialogClosed: action.closed };
    }
}
