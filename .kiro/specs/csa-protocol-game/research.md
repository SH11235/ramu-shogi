# Research & Design Decisions: csa-protocol-game

## Summary
- **Feature**: csa-protocol-game
- **Discovery Scope**: Complex Integration
- **Key Findings**:
  - 既存の EngineClient / Tauri command には `usinewgame` / `gameover` / `ponderhit` が未実装。CSAセッションはRust側でエンジンを直接制御する設計が最も安全
  - `usi_engine.rs` のプロセス管理ユーティリティ（`send_line`, `parse_bestmove`, `parse_info`, `create_engine_command`）を再利用し、EngineDriver の重複作成を回避
  - 内蔵エンジンの `_ponderhit_flag` は既存だが未使用。CSA対局で有効化する
  - `ClockDisplay` は `TickState` 型を要求するため、CSA時計データからのアダプタ層が必要

## Research Log

### エンジンAPI の現状と不足
- **Context**: CSA対局に必要な USI コマンド（usinewgame, gameover, ponderhit）が既存APIに存在するか調査
- **Findings**:
  - 外部USI `usi_engine.rs`: `position/go/stop/quit/setoption` のみ。`SearchParamsInput` に ponder/btime/wtime フィールドなし
  - 内蔵エンジン `lib.rs`: `SearchParamsInput` に `ponder: Option<bool>` あり。`_ponderhit_flag: Arc<AtomicBool>` は作成されるが未使用
  - TS `EngineClient`: `search(params)` に `ponder?: boolean` あり。ただし `usi-engine-client.ts` では送信されない
  - `send_line()` 関数（`Arc<Mutex<ChildStdin>>`）で任意のUSIコマンド送信が可能
  - `parse_bestmove()`, `parse_info()`, `create_engine_command()` はCSA対局でも同じ処理が必要
- **Implications**: 
  - EngineClient を拡張するよりも、CSAセッションがRust側でエンジンを直接制御する方が確実
  - 新規 EngineDriver を作成するのではなく、`usi_engine.rs` の既存ユーティリティ関数を `pub(crate)` 化して再利用
  - 内蔵エンジンは `EngineState` 経由で制御し、`_ponderhit_flag` を有効活用

### CSAセッションの状態遷移パターン
- **Context**: rshogi-oss の session.rs の状態遷移をTauri非同期モデルにどう変換するか
- **Findings**:
  - 同期モデル: サーバーreaderスレッド → `mpsc::Receiver` → メインスレッドで `recv_timeout(200ms)` ポーリング
  - Ponder外れ: `engine.stop_and_wait()` で古い bestmove を待って破棄。`rx.recv()` でブロッキング
  - 多重化: `server_rx.try_recv()` と `engine_rx.recv_timeout()` を交互にチェック
  - ゲーム終了検知: 探索中でも `server_rx` を200msごとにチェックし、`#WIN/#LOSE` 等を検知
  - サーバーエコー: 指し手の後に `,T<秒>` で消費時間が付加される
- **Implications**: Tauri では `tokio::select!` で server_rx と engine_rx を同時待ちに変換可能。200msポーリングは不要

### 既存UI統合パターン
- **Context**: CSA対局UIを既存のMatch UIとどう統合するか
- **Findings**:
  - Match UI はプロバイダ階層パターン: NnueProvider → MatchSettingsProvider → MatchStateProvider → Layout
  - `useEngineManager` が状態管理の中核
  - App.tsx は `ShogiMatch` を直接レンダリング（条件分岐やタブなし）
  - `ClockDisplay` の props は `TickState` 型（`ticking`, `lastUpdatedAt` を含む）。CSA側の時計データとは型が異なる
  - 再利用可能: ShogiBoard, KifuNavigationToolbar
  - ClockDisplay: アダプタ層経由で再利用可能
- **Implications**: 
  - App.tsx に `appMode` 状態を追加し、local/csa で条件分岐レンダリング
  - ClockAdapter コンポーネントでCSA時計データ → TickState変換

### Floodgateコメント生成の依存関係
- **Context**: `build_floodgate_comment` の再利用可能性
- **Findings**:
  - 実装場所: `session.rs:590`（`common/floodgate.rs` はFloodgate棋譜ダウンロード補助であり別物）
  - 依存: `SearchInfo { depth, score_cp, score_mate, pv }` + `Position` + `Color`
  - CSA変換: `usi_move_to_csa()` を使用（`common/csa.rs` 依存）
- **Implications**: CSAセッションモジュール内に同等のロジックを実装。`usi_move_to_csa` は rshogi-csa crate から利用

### CSA⇔USI変換の取り込み方針
- **Context**: rshogi-oss の `common/csa.rs`（1193行）をどう取り込むか
- **Findings**:
  - `common/csa.rs` は純粋関数のみで構成。外部I/O依存なし
  - CSA→SFEN変換（`position_to_sfen`）、USI→CSA指し手変換（`usi_move_to_csa`）、CSA→USI指し手変換（`csa_move_to_usi`）が含まれる
  - rshogi-oss のCSAクライアント（CLI）も同じ変換ロジックを使用
  - `record.rs` や Floodgateコメント生成は `SearchInfo` / `Position` 等の周辺型に依存しており、即時の独立crate化は困難
- **Implications**: `common/csa.rs` のみを `rshogi-csa` crateとして切り出し。棋譜出力やFloodgateコメント生成はCSAセッション側に実装

### tokio features の現状
- **Context**: CSA対局に必要な tokio features が既存 Cargo.toml に含まれるか
- **Findings**:
  - 現在: `tokio = { version = "1", features = ["fs", "io-util", "process"] }`
  - TCP接続: `net` feature が必要
  - `tokio::select!`: `macros` feature が必要
  - `tokio::spawn`: `rt` feature が必要（tauri の依存として含まれている可能性あり、要確認）
- **Implications**: `Cargo.toml` に `net`, `macros` を追加

## Architecture Pattern Evaluation

| Option | Description | Strengths | Risks / Limitations |
|--------|-------------|-----------|---------------------|
| CSAセッション完全Rust管理 | CSA接続 + エンジン制御をすべてRust側で実装 | レース条件防止、ponder管理確実 | フロントエンドからの制御が限定的 |
| TS側エンジン制御 | EngineClient を拡張しTS側でponder等を管理 | 既存パターンとの一貫性 | ponder状態遷移のレース条件リスク大 |
| ハイブリッド | CSA接続はRust、エンジンはTS経由 | 責務分離 | CSA↔エンジン間の同期が複雑 |

**選択**: CSAセッション完全Rust管理。

| Option | Description | Strengths | Risks / Limitations |
|--------|-------------|-----------|---------------------|
| 新規 EngineDriver | CSA専用のエンジンプロセス管理モジュール | 独立性が高い | usi_engine.rs と大部分が重複（1500行中の大半） |
| UsiEngineManager 再利用 | 既存のパース関数・プロセス管理を pub(crate) 化 | コード重複なし | usi_engine.rs の内部構造への依存 |
| CsaEngine enum | 内蔵/外部USIを enum で抽象化、既存ユーティリティを再利用 | 両エンジン対応、重複最小 | enum のマッチ分岐が増える |

**選択**: CsaEngine enum + 既存ユーティリティ再利用。

## Design Decisions

### Decision: CSAセッションのエンジン制御方式
- **Context**: CSA対局中のエンジン制御をどの層で行うか
- **Alternatives**:
  1. TS EngineClient 拡張 → フロントエンド経由
  2. Rust側で直接制御 + 新規 EngineDriver（usi_engine.rs と重複）
  3. Rust側で直接制御 + 既存ユーティリティ再利用（CsaEngine enum + 型付きAPI）
- **Selected**: Option 3
- **Rationale**: ponderレイテンシ防止（Option 1 排除）+ コード重複回避（Option 2 排除）。`usi_engine.rs` の `parse_bestmove`[既にpub], `parse_info`[既にpub], `send_line`[pub(crate)化], `create_engine_command`[pub(crate)化] を CsaEngine::External で再利用。CsaEngine は文字列ベースの `send(cmd)` ではなく型付きメソッド（`go(CsaGoParams)`, `ponderhit()` 等）で制御（内蔵エンジンへの文字列パース逆変換を回避）
- **Trade-offs**: `usi_engine.rs` の `send_line`, `create_engine_command` を `pub(crate)` 化する必要あり。内蔵エンジン用の `spawn_search_for_csa` パイプライン新設が必要

### Decision: 内蔵エンジン対応
- **Context**: CSA対局で内蔵エンジン（rshogi-core）を使えるか
- **Selected**: 初期スコープに含める。CsaEngine::Builtin として実装
- **Rationale**: 要件で明示的に含まれている。`EngineState` 経由で制御し、`_ponderhit_flag` を有効化。EngineLock で通常操作との排他を保証
- **Trade-offs**: 既存 `spawn_search` は `window.emit()` で bestmove を送信するため、CSA対局では使えない。CSA専用の `spawn_search_for_csa` パイプライン（bestmove を mpsc チャネルに送信）を新設する必要がある。これは追加の実装コスト（推定100-150行）を伴う
- **Key insight**: `_ponderhit_flag` は `Search::ponderhit_flag()` で取得済みだが未使用。CSA対局で `ponderhit_flag.store(true)` を呼ぶことで ponder 探索から通常探索に遷移させる

### Decision: エンジン排他制御
- **Context**: CSA対局中に通常のエンジン操作が競合するリスク
- **Selected**: EngineLock（Rust側 Tauri State）+ EngineLockGuard（RAIIガード型）
- **Rationale**: `acquire()` で `EngineLockGuard` を返す。Guard の Drop で自動解放。タスクパニック時も Rust の Drop 保証により解放される。`AtomicBool` フラグではなく Guard パターンでロック漏れを構造的に防止

### Decision: CSAイベント統合
- **Context**: MoveMade / OpponentMove を分離するか統合するか
- **Selected**: 単一の `Move` イベント + `side` フィールドで統合
- **Rationale**: フィールドが完全に同一。reducer の分岐が不要になりコードが簡素化される

### Decision: CSA⇔USI変換の共有方式
- **Context**: rshogi-oss の `common/csa.rs`（1193行）の取り込み方針
- **Selected**: `rshogi-csa` crate を rshogi-oss 側に新設し、両リポジトリから依存
- **Rationale**: 純粋関数のみで外部依存なし。切り出しコストが低く再利用価値が高い。`record.rs` や Floodgateコメント生成は周辺型依存があるため含めない（CSAセッション側に実装）
- **Note**: rshogi-oss は同一管理者のリポジトリであり、crate分離は本プロジェクトの作業スコープ内。外部依存リスクなし

### Decision: 連続対局時のエンジン管理
- **Context**: 連続対局でエンジンを毎回再起動するか維持するか
- **Selected**: エンジンインスタンスを CsaGameManager が保持し、対局間は `usinewgame` で状態リセット。エラー時のみ再初期化
- **Rationale**: NNUE読み込み等の初期化コストを回避。`CsaEngine::shutdown(self)` は self を消費するが、セッション終了時のみ呼ぶ

## Risks & Mitigations
- **Ponderレース条件**: stop送信後の古いbestmove到着 → `tokio::select!` + bestmove受信までブロックで対処
- **TCP切断時のクリーンアップ**: 対局中にサーバー切断 → エンジンstop + 棋譜保存 + UIエラー通知 + EngineLock解放
- **Windows TCP keep-alive**: `socket2` crate を `Cargo.toml` に追加して SO_KEEPALIVE を設定（tokio標準APIには `set_keepalive` がないため）
- **時間切れ**: ネットワーク遅延 → マージン時間（デフォルト2500ms）を秒読みから差し引き
- **エンジン二重管理**: EngineLock でCSA対局中の通常操作を排他。フロントエンドもロック状態を確認してUIを無効化
- **CSA初期局面→SFEN変換**: rshogi-csa crate の `position_to_sfen()` で変換。CsaProtocol 内で GAME_SUMMARY パース時に実行
