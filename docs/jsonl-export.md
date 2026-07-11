# JSONL エクスポート (rshogi 互換対局ログ)

対局画面から、rshogi のトーナメントツール群と互換の対局ログ (JSONL) をダウンロードできる。
主な想定ユーザーは rshogi 側で解析ツール (`analyze_selfplay`, `kifu_player` 等) を使う開発者・研究用途。

このファイルはフォーマット互換性の**開発者向けリファレンス**。アプリ利用者への案内は
エクスポートボタン横の「JSONL エクスポートとは」(`JsonlExportHelp` コンポーネント) が担う。

## 使い方

- PC: 棋譜パネル上部の「JSONL エクスポート」ボタン
- モバイル: 設定シート内の「JSONL エクスポート」ボタン

現在の棋譜ツリーの**主分岐**が `<日時>.jsonl` としてダウンロードされる。
表示設定「探索情報 (NPS/深さ) を表示」の ON/OFF とは無関係にいつでも利用できる。

エンジンの探索統計は対局中に各手へ自動保存されたものが出力される。人間の手や、
インポートした棋譜・スナップショットから復元した手には探索統計が付かない
(`eval` キーが省略される)。

## フォーマット

1 行 1 JSON。行種は 3 つで、rshogi の selfplay / tournament が出力するスキーマに合わせている
(正本: rshogi リポジトリ `crates/tools/src/bin/tournament.rs` の `MetaLogEntry` / `MoveLogEntry` / `ResultLogEntry`)。

- `meta` 行: 対局条件。`settings.byoyomi` / `settings.btime` は **ミリ秒**。
  `engine_cmd.label_black/white` は UI 上のエンジン表示名 (人間側は `human`)
- `move` 行: 1 手ごと。`ply` (1 始まり)、`side_to_move` (`b`/`w`)、`sfen_before`、`move_usi`、
  `engine` (label と同一)、`elapsed_ms` (壁時計の消費時間)、`think_limit_ms` (`go` に渡した秒読み ms)、
  `eval` (score_cp / score_mate / depth / seldepth / nodes / time_ms / nps / pv。
  値の無いフィールドはキーごと省略、全て無ければ `eval` 自体を省略)
- `result` 行: 終局時のみ。`reason` は rshogi 語彙 (`resign` / `timeout` / `win`) に合わせる。
  詰みは rshogi 側に対応語が無いため `checkmate` のまま

## rshogi 側との差分 (既知の制限)

- `settings.hash_mb` は UI に設定が無いため常に `0`
- `settings.threads` は UI 設定の解決値 (自動は推奨値)。外部 USI エンジンは登録時に
  保存したオプションが実効値のため乖離し得る
- `settings.byoyomi` / `btime` は先後で異なる設定の場合、大きい方の値を出力する
- `move` 行の `timed_out` は常に `false` (UI 側は時間切れ時に対局を終了するため move 行が生成されない)
- `move` 行の `eval.score_cp` / `score_mate` は排他 (最後に観測された評価種別のみ)
- エクスポート時点の UI 設定 (エンジン名・持ち時間・スレッド数) を読むため、
  終局後に設定を変更してからエクスポートすると meta 行が対局実態とずれる
