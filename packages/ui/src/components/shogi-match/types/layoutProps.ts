/**
 * ShogiMatchLayout への props グループ化の型定義
 * props を関心ごとにグループ化し、保守性を向上させる
 */

import type {
    LastMove,
    NnueMeta,
    NnueSelection,
    PositionState,
    PresetWithStatus,
} from "@shogi/app-core";
import type { ShogiBoardCell } from "../../shogi-board";
import type { SelectionState } from "../contexts/types";
import type { ClockSettings, TickState } from "../hooks/useClockManager";
import type {
    DisplaySettings,
    GameMode,
    Message,
    PassRightsSettings,
    PromotionSelection,
    SideSetting,
} from "../types";

/**
 * 対局設定グループ
 * - 対局者（先手・後手）の設定
 * - 持ち時間設定
 * - パス権設定
 * - NNUE ファイル選択
 */
export interface MatchSettingsProps {
    sides: { sente: SideSetting; gote: SideSetting };
    handleSidesChange: (sides: { sente: SideSetting; gote: SideSetting }) => void;
    timeSettings: ClockSettings;
    setTimeSettings: (settings: ClockSettings) => void;
    passRightsSettings: PassRightsSettings;
    handlePassRightsSettingsChange: (settings: PassRightsSettings) => void;
    settingsLocked: boolean;
    senteNnueSelection: NnueSelection;
    handleSenteNnueSelectionChange: (selection: NnueSelection) => void;
    goteNnueSelection: NnueSelection;
    handleGoteNnueSelectionChange: (selection: NnueSelection) => void;
    nnueList: NnueMeta[];
    presets: PresetWithStatus[];
    internalEngineId: string;
    setIsDisplaySettingsOpen: (open: boolean) => void;
    setIsPassRightsSettingsOpen: (open: boolean) => void;
}

/**
 * 盤面状態グループ
 * - 現在の局面（position）
 * - 時計の状態
 * - 盤面グリッド
 * - ゲームモード
 * - メッセージ表示
 * - 選択状態
 * - 最後の手
 */
export interface BoardStateProps {
    position: PositionState;
    clocks: TickState;
    grid: ShogiBoardCell[][];
    gameMode: GameMode;
    message: Message | null;
    selection: SelectionState | null;
    promotionSelection: PromotionSelection | null;
    lastMove?: LastMove;
    moves: string[];
    editFromSquare: import("@shogi/app-core").Square | null;
    flipBoard: boolean;
    displaySettings: DisplaySettings;
    onFlipBoardChange: (flip: boolean) => void;
}
