import type { ReactElement } from "react";

/** JSONL エクスポートの用途と内容の説明 (開閉式)。ボタンの近くに置く */
export function JsonlExportHelp(): ReactElement {
    return (
        <details className="text-xs text-muted-foreground">
            <summary className="cursor-pointer select-none hover:text-foreground">
                JSONL エクスポートとは
            </summary>
            <div className="mt-1 space-y-1 pl-1">
                <p>
                    rshogi のトーナメントツールと互換の対局ログ (1 行 1 JSON の meta / move /
                    result)
                    をダウンロードします。棋譜と探索情報を突き合わせる研究・解析用途向けです。
                </p>
                <p>
                    move 行には各手の消費時間 (ミリ秒) と、エンジンが指した手の探索統計 (深さ /
                    ノード数 / NPS / 評価値 / 読み筋) が含まれます。
                    人間の手やインポートした棋譜の手には探索統計は付きません。
                </p>
                <p>エクスポート対象は現在の棋譜の本譜のみです (分岐は含まれません)。</p>
            </div>
        </details>
    );
}
