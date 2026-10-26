/**
 * 棋譜インポートパネル
 *
 * SFEN / KIF / CSA 形式の棋譜を、貼り付けまたはファイル選択で取り込む。
 * 読んだ内容は端末内で盤面へ反映するだけで、サーバーには送らない。
 */

import type { ReactElement } from "react";
import { Card } from "../../card";
import { useKifuTextImport } from "../hooks/useKifuTextImport";
import { useShogiMatchConfig } from "../ShogiMatchContext";
import {
    type ImportKifHandler,
    type ImportSfenHandler,
    KIFU_FILE_ACCEPT,
} from "../utils/kifuImport";

interface KifuImportPanelProps {
    /** SFENインポート時のコールバック（CSA は評価値・消費時間を options.moveData で渡す） */
    onImportSfen: ImportSfenHandler;
    /** KIFインポート時のコールバック（moves: 指し手配列, moveData: 各手の詳細データ, startSfen: 開始局面） */
    onImportKif: ImportKifHandler;
    /** 局面が準備完了しているか */
    positionReady: boolean;
}

export function KifuImportPanel({
    onImportSfen,
    onImportKif,
    positionReady,
}: KifuImportPanelProps): ReactElement {
    const { inputValue, error, success, handleInputChange, handleImport, handleFileChange } =
        useKifuTextImport({ onImportSfen, onImportKif });
    const { kifuImportExtra } = useShogiMatchConfig();

    return (
        // 要素どうしの間隔は親の gap で決める (子に margin を持たせない)。
        <Card elevation="floating" className="flex w-full flex-col gap-3 p-3">
            <div className="flex flex-col gap-2">
                <div className="font-bold">インポート（SFEN / KIF / CSA）</div>

                {/* 説明文 */}
                <div className="text-xs text-muted-foreground">
                    SFEN形式の局面、またはKIF・CSA形式の棋譜を貼り付けるか、ファイルを選んでください
                    <br />
                    例: <code className="bg-muted px-1 rounded">startpos moves 7g7f 3c3d</code>
                    <br />
                    例: <code className="bg-muted px-1 rounded">1 ７六歩(77)</code>
                    <br />
                    例: <code className="bg-muted px-1 rounded">+7776FU</code>
                    （CSA は評価値・読み筋・消費時間も読み込みます）
                </div>

                {/* 入力エリア */}
                <textarea
                    aria-label="棋譜または局面のテキスト"
                    value={inputValue}
                    onChange={(e) => handleInputChange(e.target.value)}
                    placeholder={
                        "startpos moves 7g7f 3c3d\nlnsgkgsnl/1r5b1/ppppppppp/9/9/9/PPPPPPPPP/1B5R1/LNSGKGSNL b - 1\n1 ７六歩(77)\n2 ３四歩(33)"
                    }
                    rows={5}
                    className="w-full p-2 text-sm font-mono rounded-md border border-border bg-background resize-none focus:outline-none focus:ring-2 focus:ring-ring"
                    disabled={!positionReady}
                />

                {/* エラー表示 */}
                {error && <div className="text-xs text-destructive">{error}</div>}
            </div>

            {/* 読み込みボタン */}
            <button
                type="button"
                className={`w-full py-2 text-sm rounded-md border transition-colors ${
                    success
                        ? "bg-status-success text-status-success-fg border-status-success"
                        : "bg-primary text-primary-foreground border-primary hover:bg-primary/90"
                } disabled:opacity-50 disabled:cursor-not-allowed`}
                onClick={() => void handleImport()}
                disabled={!positionReady || !inputValue.trim()}
            >
                {success ? "読み込み完了" : "読み込み"}
            </button>

            {/* ファイル選択 */}
            <label className="flex flex-col gap-1 text-xs text-muted-foreground">
                ファイルから読み込む（.csa / .kif / .kifu / .sfen / .txt）
                <input
                    type="file"
                    accept={KIFU_FILE_ACCEPT}
                    onChange={(e) => void handleFileChange(e)}
                    disabled={!positionReady}
                    className="text-sm text-foreground file:mr-2 file:rounded-md file:border file:border-border file:bg-background file:px-3 file:py-1.5 file:text-sm disabled:opacity-50"
                />
            </label>

            {kifuImportExtra}
        </Card>
    );
}
