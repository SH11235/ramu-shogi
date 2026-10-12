import { useRef } from "react";
import type { ImportKifHandler, ImportSfenHandler } from "../utils/kifuImport";

/** 棋譜に書かれていた対局者名。 */
interface KifuPlayers {
    sente?: string;
    gote?: string;
}

interface UseImportedKifuPlayersOptions {
    importSfen: ImportSfenHandler;
    importKif: ImportKifHandler;
}

interface UseImportedKifuPlayersResult {
    /** 棋譜読込の欄に渡す SFEN / CSA の取り込み（対局者名があれば覚える）。 */
    importSfenFromPanel: ImportSfenHandler;
    /** 棋譜読込の欄に渡す KIF の取り込み（前の棋譜の対局者名を忘れる）。 */
    importKifFromPanel: ImportKifHandler;
    /**
     * いま開いている棋譜の対局者名。棋譜読込で読んだ棋譜のまま（開始局面と本譜の手順が同じ）の
     * ときだけ返す。別の棋譜を読んだ・指し直した・局面を編集したあとは undefined。
     */
    playersFor: (startSfen: string, mainLineMoves: readonly string[]) => KifuPlayers | undefined;
}

/** 平手の表し方の違い（`startpos` と SFEN）を揃える。 */
const HIRATE_SFEN = "lnsgkgsnl/1r5b1/ppppppppp/9/9/9/PPPPPPPPP/1B5R1/LNSGKGSNL b - 1";
const normalizeSfen = (sfen: string): string => {
    const trimmed = sfen.trim().replace(/^sfen\s+/, "");
    return trimmed === "startpos" ? HIRATE_SFEN : trimmed;
};

/**
 * 棋譜読込で読んだ棋譜の対局者名を覚えておく（研究ノートにするときの表題に使う）。
 *
 * 覚えるのは CSA のように対局者名の書かれた棋譜を読んだときだけ。別の棋譜（KIF・SFEN を含む）を
 * 読んだら、前の棋譜の対局者名は必ず忘れる。同じ棋譜のままかは、開始局面と本譜の手順で見分ける。
 */
export function useImportedKifuPlayers({
    importSfen,
    importKif,
}: UseImportedKifuPlayersOptions): UseImportedKifuPlayersResult {
    const importedRef = useRef<{
        startSfen: string;
        movesKey: string;
        players: KifuPlayers;
    } | null>(null);

    const importSfenFromPanel: ImportSfenHandler = async (sfen, moves, options) => {
        // 取り込みに失敗しても前の棋譜の名前を残さないよう、先に忘れる。
        importedRef.current = null;
        await importSfen(sfen, moves, { moveData: options?.moveData });
        if (options?.players) {
            importedRef.current = {
                startSfen: normalizeSfen(sfen),
                movesKey: moves.join(" "),
                players: options.players,
            };
        }
    };

    const importKifFromPanel: ImportKifHandler = async (moves, moveData, startSfen) => {
        importedRef.current = null;
        await importKif(moves, moveData, startSfen);
    };

    const playersFor = (
        startSfen: string,
        mainLineMoves: readonly string[],
    ): KifuPlayers | undefined => {
        const imported = importedRef.current;
        if (!imported) return undefined;
        if (imported.startSfen !== normalizeSfen(startSfen)) return undefined;
        if (imported.movesKey !== mainLineMoves.join(" ")) return undefined;
        return imported.players;
    };

    return { importSfenFromPanel, importKifFromPanel, playersFor };
}
