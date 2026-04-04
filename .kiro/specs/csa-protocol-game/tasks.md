# Implementation Plan

- [ ] 1. rshogi-csa crate の切り出しと依存設定
- [ ] 1.1 rshogi-oss の `common/csa.rs` を独立 crate `rshogi-csa` として分離する
  - CSA⇔USI指し手変換、局面パース、SFEN変換を含む純粋関数群を独立 crate 化
  - 既存の `tools` crate から `rshogi-csa` を参照するよう依存を更新
  - crate の公開APIを定義（`csa_move_to_usi`, `usi_move_to_csa`, `position_to_sfen` 等）
  - 既存テストを移行し、crate 単体でのテスト通過を確認
  - _Requirements: 3.1, 3.4, 8.1_

- [ ] 1.2 ramu-shogi 側の依存追加と基盤整備
  - `Cargo.toml` に `rshogi-csa`（path依存）、`thiserror`、`socket2`、`tokio-util` を追加
  - tokio の features に `net`, `macros`, `sync` を追加
  - `EngineState` を `Arc::new()` でラップして `.manage()` するパターンに移行。既存の `engine_*` コマンドが `State<'_, Arc<EngineState>>` を受け取るよう修正
  - `usi_engine.rs` の `send_line` と `create_engine_command` を `pub(crate)` に変更
  - 既存テストが通過することを確認
  - _Requirements: 12.1_

- [ ] 2. CsaError 型と共通データ型の定義
- [ ] 2.1 (P) CsaError enum と CSA共通型を定義する
  - `CsaError` enum（ConnectionFailed, LoginFailed, ProtocolError, EngineTimeout, EngineCrashed, EngineError, ServerDisconnected, SessionAborted, Io）を `csa_game.rs` に定義
  - `GameSummary`, `GameResult`, `TimeConfig`, `Clock`, `CsaGoParams`, `BestMoveResult`, `SearchInfo`, `ServerLine` 等の共通型を定義
  - `CsaSessionEvent` enum（Connected, GameSummary, GameStarted, Move, SearchInfo, GameEnded, Disconnected, Error）を serde 対応で定義
  - `CsaConfig` の Rust 側対応型を serde::Deserialize で定義
  - _Requirements: 1.1, 2.1, 4.1, 6.1_

- [ ] 3. EngineLock による排他制御
- [ ] 3.1 (P) EngineLockGuard を実装し、既存エンジンコマンドにロックチェックを追加する
  - `EngineLock` 構造体と `EngineLockGuard`（RAII Drop でロック解放）を実装
  - `acquire(self: &Arc<Self>, target)` で Guard を返すメソッドを実装
  - `is_locked()` で現在のロック状態を返すメソッドを実装
  - `lib.rs` の `engine_search`, `engine_stop` 等のコマンドに `EngineLock::is_locked()` チェックを追加
  - `usi_engine.rs` の `usi_engine_go`, `usi_engine_start` 等にも同様のチェックを追加
  - `csa_engine_lock_status` Tauri コマンドを追加
  - `EngineLock` を `.manage(Arc::new(...))` で Tauri に登録
  - _Requirements: 12.1, 12.2_

- [ ] 4. CsaProtocol — CSAサーバー接続とプロトコル処理
- [ ] 4.1 TCP接続、LOGIN/LOGOUT、keep-alive を実装する
  - CSAサーバーへのTCP接続を `tokio::net::TcpStream` で確立
  - `set_nodelay(true)` と `socket2` による SO_KEEPALIVE を設定
  - LOGIN コマンドの送信と応答（`LOGIN:... OK` / `LOGIN:incorrect`）のパース
  - LOGOUT コマンドの送信
  - keep-alive ping（空行送信）を定期的に実行する仕組み
  - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6_

- [ ] 4.2 GAME_SUMMARY パースと AGREE/REJECT フローを実装する
  - GAME_SUMMARY の受信とパース（対局ID、手番、対戦相手名、持ち時間、初期局面）
  - Time_Unit（秒/ミリ秒）、Total_Time、Byoyomi、Increment、先後別残り時間のパース
  - CSA初期局面 → SFEN変換（`rshogi-csa::position_to_sfen`）
  - AGREE / REJECT の送信。パース失敗時は REJECT
  - START の受信検知
  - _Requirements: 2.1, 2.2, 2.3, 2.4, 4.1_

- [ ] 4.3 リーダー/ライター分離と CsaGameIo を実装する
  - `start_game_io` で `TcpStream::into_split()` によるリーダー/ライター分離
  - リーダー側を tokio タスクで非同期読み取りし、`mpsc::Receiver<ServerLine>` で提供
  - `CsaGameIo` 構造体（送信側）: `send_move`, `send_special`（%TORYO, %KACHI）, `logout`
  - サーバーエコーの消費時間パース（`,T<秒>` → 秒数抽出）
  - 連続対局用 `recv_next_game_summary`（TCP接続維持で次ゲーム待機 + keep-alive継続）
  - _Requirements: 1.6, 3.6, 4.5, 6.1_

- [ ] 5. CsaEngine — エンジン統一抽象
- [ ] 5.1 External variant を実装する（外部USIエンジン）
  - `create_engine_command` でプロセスを起動し、stdin/stdout を取得
  - `usi` → `setoption` → `isready` ハンドシェイクの実装（タイムアウト付き）
  - 専用の stdout 読み取りタスクを spawn し、`parse_bestmove` / `parse_info` でパースして mpsc チャネルに送信
  - `go(CsaGoParams)` で USI go コマンド文字列を組み立てて `send_line` で送信
  - `go_ponder(CsaGoParams)` で `go ponder ...` を組み立てて送信
  - `ponderhit()`, `stop()`, `new_game()`, `gameover()`, `set_position()` の実装
  - `recv_bestmove()`, `recv_info()` の実装
  - `shutdown(self)` でプロセス終了
  - Windows: `CREATE_NO_WINDOW` フラグ設定
  - _Requirements: 3.1, 3.2, 3.3, 5.1, 5.2, 5.3, 12.1, 12.2, 12.3, 12.4_

- [ ] 5.2 Builtin variant を実装する（内蔵エンジン）
  - `spawn_search_for_csa` パイプラインを `lib.rs` に新設：探索結果を `mpsc::Sender::blocking_send()` で送信し、info も同様に mpsc で送信。`std::thread::Builder::new().stack_size(64MB)` でスレッド起動
  - `init_builtin(Arc<EngineState>)` で内蔵エンジンを初期化
  - `go(CsaGoParams)` で `CsaGoParams` → `LimitsType` 変換し、`spawn_search_for_csa` で探索開始
  - `go_ponder(CsaGoParams)` で `limits.ponder = true` を設定して探索開始
  - `ponderhit()` で `ponderhit_flag.store(true)` を設定
  - `stop()`, `new_game()`, `gameover()`, `set_position()` の実装
  - `recv_bestmove()`, `recv_info()` の実装
  - _Requirements: 3.1, 3.2, 3.3, 5.1, 5.2, 5.3, 12.1, 12.2, 12.3, 12.4_

- [ ] 6. CsaSession — 対局ゲームループ
- [ ] 6.1 対局ループの基本フロー（指し手送受信、エコー検証）を実装する
  - 自分の手番: エンジンに position + go を指示し、bestmove を待つ
  - bestmove 受信後: USI → CSA 変換して `CsaGameIo::send_move` で送信
  - `bestmove resign` → `%TORYO`、`bestmove win` → `%KACHI` の変換
  - サーバーエコーの検証（送信した指し手と一致するか確認）
  - 相手の手番: サーバーから指し手を受信し、CSA → USI 変換
  - 各指し手を `CsaSessionEvent::Move` としてイベント送出
  - `tokio::select!` でサーバーRx、エンジンRx、`cancel_token.cancelled()` を同時待ち
  - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7, 3.8_

- [ ] 6.2 Ponder 状態遷移を実装する
  - bestmove に ponder move が含まれる場合: 予測局面で `go_ponder` を開始
  - 相手の指し手が予測と一致: `ponderhit()` で探索継続
  - 相手の指し手が予測と不一致: `stop()` → `recv_bestmove()` で古い応答を破棄 → 正しい局面で再探索
  - ゲーム終了時の ponder クリーンアップ（stop + bestmove 破棄）
  - ponder 無効時は ponder 処理をスキップ
  - _Requirements: 5.1, 5.2, 5.3, 5.4_

- [ ] 6.3 時計管理と go 引数組み立てを実装する
  - GAME_SUMMARY から Clock を初期化（total_time, byoyomi, increment）
  - サーバーエコーの `,T<秒>` から消費時間を差し引いて Clock を更新
  - `Clock::build_go_args` で秒読み制/Fischer制/なしの3パターンに応じた `CsaGoParams` を生成
  - マージン時間（デフォルト2500ms）を秒読みから差し引き
  - Clock 更新時に `CsaSessionEvent::Move` の `clock` フィールドに残り時間を含めて送出
  - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 4.6, 4.7_

- [ ] 6.4 終局処理と結果判定を実装する
  - `#WIN`, `#LOSE`, `#DRAW`, `#CENSORED`, `#CHUDAN` の検知と GameResult へのマッピング
  - 終局理由行（`#TIME_UP`, `#ILLEGAL_MOVE`, `#MAX_MOVES`, `#SENNICHITE`, `#JISHOGI`）の保持
  - エンジンへの `gameover win/lose/draw` 通知
  - `CsaSessionEvent::GameEnded` の送出
  - 探索中のサーバー終局通知の検知（`tokio::select!` で常時監視）
  - _Requirements: 6.1, 6.2, 6.3, 6.4, 6.5, 6.6, 6.7_

- [ ] 6.5 (P) Floodgate 評価値コメント生成を実装する
  - Floodgate モード有効時、指し手送信にコメント `'* <評価値> <PV(CSA形式)>` を付与
  - 評価値を先手視点で正規化（後手の場合は符号反転）
  - 詰み評価を ±100000 cp に変換
  - SearchInfo の PV を `rshogi-csa::usi_move_to_csa` で CSA 形式に変換
  - _Requirements: 8.1, 8.2, 8.3_

- [ ] 7. CsaGameManager — セッションライフサイクル管理
- [ ] 7.1 セッション開始・停止と CancellationToken による graceful shutdown を実装する
  - `csa_start` コマンド: CsaConfig のバリデーション → EngineLock 取得 → エンジン初期化 → TCP接続 → LOGIN → セッション tokio タスク起動
  - `csa_stop` コマンド: `cancel_token.cancel()` → 対局中なら %TORYO 送信 → LOGOUT → エンジン shutdown → EngineLock 解放
  - セッションタスク内で `cancel_token.cancelled()` を `tokio::select!` のブランチとして監視
  - `CsaSessionEvent` を `app.emit("csa://session", &event)` でフロントエンドに中継
  - `session_handle` による同時実行防止
  - _Requirements: 1.1, 1.2, 10.5, 10.6, 11.4_

- [ ] 7.2 連続対局モードと指数バックオフ再接続を実装する
  - `max_games` に基づく対局回数制御（0で無制限）
  - 対局間のエンジン維持（`new_game()` で状態リセット）
  - `recv_next_game_summary` で次の対局待機
  - エラー時の指数バックオフ再接続（10秒→20秒→...→15分、成功でリセット）
  - サーバーエラー時はTCPのみ再接続（エンジン維持）、エンジンエラー時はエンジンも再初期化
  - _Requirements: 11.1, 11.2, 11.3_

- [ ] 8. RecordWriter — 棋譜記録
- [ ] 8.1 (P) CSA 形式の棋譜生成とファイル保存を実装する
  - GameRecord から CSA V2.2 形式のテキストを生成（対局ID、対戦者名、持ち時間、各手の消費時間、終局理由）
  - Floodgate モード時は各手に評価値コメントを含める
  - ファイル名テンプレート `{YYYYMMDD_HHMMSS}_{sente}_vs_{gote}.csa` で保存
  - プレイヤー名のファイル名不正文字をサニタイズ
  - 保存先ディレクトリをユーザー設定から取得
  - `GameEnded` イベントの `record_path` に保存先パスを含めて返却
  - _Requirements: 7.1, 7.2, 7.3, 7.4, 7.5_

- [ ] 9. Tauri コマンド登録と IPC 配線
- [ ] 9.1 CSA関連の Tauri コマンドを `lib.rs` に登録する
  - `csa_game.rs` モジュールを `lib.rs` から `mod csa_game` で参照
  - `generate_handler![]` に `csa_start`, `csa_stop`, `csa_save_config`, `csa_load_config`, `csa_engine_lock_status` を追加
  - `CsaGameManager` と `EngineLock` を `.manage()` で登録
  - 設定の保存・読み込み（`tauri-plugin-store` 経由、キー `"csa-config"`）
  - `csa_start` でのバリデーション（ポート範囲、ユーザーID文字制限）を実装
  - _Requirements: 9.7, 12.1_

- [ ] 10. フロントエンド — 接続設定UI
- [ ] 10.1 (P) CsaSettingsPanel コンポーネントを実装する
  - サーバー接続情報（ホスト、ポート、ユーザーID、パスワード、Floodgateモード）の入力フォーム
  - floodgate プリセット選択時のホスト・ポート・Floodgateモード自動入力
  - エンジン選択（内蔵 / 外部USI。外部USIは `usi_engine_list` から一覧取得）
  - エンジンオプション（Hash, Threads 等）、ponder 有無、時間マージン、連続対局数の設定
  - エンジン初期化タイムアウトの設定（デフォルト30秒）
  - パスワードフィールドは `type="password"` で表示
  - 設定の保存・復元（`csa_save_config` / `csa_load_config` 経由）
  - マウント時に `csa_load_config` を呼び出して前回設定を復元
  - _Requirements: 9.1, 9.2, 9.3, 9.4, 9.5, 9.6, 9.7, 9.8_

- [ ] 11. フロントエンド — 対局表示UI
- [ ] 11.1 useCsaGame フックを実装する
  - `tauri.listen("csa://session")` でイベントを受信し、`useReducer` で `CsaGameState` を管理
  - `CsaGameAction` の全アクション（connected, game_summary, game_started, move, search_info, game_ended, disconnected, error, reset）を reducer で処理
  - `tauri.invoke("csa_start")` / `tauri.invoke("csa_stop")` でセッション制御
  - cleanup 時に listener を解除
  - _Requirements: 10.1, 10.2, 10.3, 11.1_

- [ ] 11.2 CsaGameView と ClockAdapter を実装する
  - 既存の `ShogiBoard`, `KifuNavigationToolbar` を再利用して盤面・棋譜を表示
  - `ClockAdapter` で CSA 時計データ（senteMs, goteMs）を既存 `ClockDisplay` の `TickState` に変換
  - Fischer 制の加算時間は ClockDisplay 近傍にテキスト表示
  - 接続状態ステータス（idle, connecting, waiting, playing, finished, error）の表示
  - 対局前: CsaSettingsPanel を表示
  - 対局待ち中: 切断ボタン（即 LOGOUT）
  - 対局中: 停止ボタン（%TORYO → 結果待ち）。盤面操作は無効化（閲覧のみ）
  - エンジン探索情報（深さ、評価値、読み筋、NPS）の表示
  - 対局終了後は棋譜ナビゲーション可能
  - _Requirements: 10.1, 10.2, 10.3, 10.4, 10.5, 10.6_

- [ ] 11.3 App.tsx にモード切り替えを追加する
  - `appMode` 状態（`"local" | "csa"`）を追加
  - `local` モード: 既存の `ShogiMatch` を表示（CSA対局への遷移ボタン付き）
  - `csa` モード: `CsaGameView` を表示（ローカルモードに戻るボタン付き）
  - EngineLock 状態を確認し、CSA対局中はローカルモードのエンジン操作を無効化
  - _Requirements: 10.4_

- [ ] 12. 統合テスト
- [ ] 12.1 CsaProtocol の結合テストを実装する
  - モック TCP サーバーを立てて LOGIN → GAME_SUMMARY → AGREE → START フローをテスト
  - ログイン失敗ケース、GAME_SUMMARY パース失敗ケースのエラーハンドリング確認
  - _Requirements: 1.1, 1.2, 1.3, 2.1, 2.2, 2.3_

- [ ] 12.2 (P) CsaEngine の結合テストを実装する
  - モック USI エンジン（stdin/stdout パイプ）に対して usi → isready → position → go → bestmove フローをテスト
  - ponder フロー（go ponder → ponderhit / stop + bestmove 破棄）のテスト
  - タイムアウト、プロセス異常終了のエラーハンドリング確認
  - _Requirements: 3.1, 5.1, 5.2, 5.3, 12.1, 12.4_

- [ ] 12.3 (P) CsaSession の結合テストを実装する
  - モックサーバー + モックエンジンで1対局完走（通常終了、投了、時間切れ）
  - Ponder hit / miss のシナリオテスト
  - 対局中のサーバー切断ハンドリング
  - _Requirements: 3.1, 4.1, 5.1, 6.1_

## Requirements Coverage

| Requirement | Tasks |
|-------------|-------|
| 1.1-1.6 | 4.1, 4.3, 7.1 |
| 2.1-2.4 | 4.2, 12.1 |
| 3.1-3.8 | 6.1, 5.1, 5.2 |
| 4.1-4.7 | 4.2, 6.3 |
| 5.1-5.4 | 6.2, 5.1, 5.2, 12.2 |
| 6.1-6.7 | 6.4 |
| 7.1-7.5 | 8.1 |
| 8.1-8.3 | 6.5 |
| 9.1-9.8 | 10.1 |
| 10.1-10.6 | 11.1, 11.2, 11.3 |
| 11.1-11.4 | 7.1, 7.2 |
| 12.1-12.4 | 1.2, 3.1, 5.1, 5.2, 9.1 |
