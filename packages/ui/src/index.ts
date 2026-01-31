/**
 * @shogi/ui パッケージ公開 API
 *
 * 共通UIコンポーネント
 */

// ============================================================
// Hooks
// ============================================================

export { useDevMode } from "./hooks/useDevMode";

// ============================================================
// Components
// ============================================================

// AboutDialog
export { AboutDialog } from "./components/AboutDialog";

// alert-dialog
export {
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
    AlertDialogTrigger,
} from "./components/alert-dialog";

// button
export { Button, buttonVariants } from "./components/button";

// dialog
export {
    Dialog,
    DialogClose,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
    DialogTrigger,
} from "./components/dialog";

// engine-control-panel
export { EngineControlPanel } from "./components/engine-control-panel";

// input
export { Input } from "./components/input";

// popover
export { Popover, PopoverContent, PopoverTrigger } from "./components/popover";

// progress
export { Progress } from "./components/progress";

// shogi-board
export type { ShogiBoardCell, ShogiBoardPiece } from "./components/shogi-board";
export { ShogiBoard } from "./components/shogi-board";

// shogi-match
export { ShogiMatch } from "./components/shogi-match";

// shogi-match/types
export type { EngineOption, SideSetting } from "./components/shogi-match/types";

// spinner
export { Spinner } from "./components/spinner";

// tooltip
export {
    Tooltip,
    TooltipContent,
    TooltipProvider,
    TooltipTrigger,
} from "./components/tooltip";

// ============================================================
// Providers
// ============================================================

// NnueContext
export { NnueProvider } from "./providers/NnueContext";
