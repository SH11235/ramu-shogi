# ギャップ分析: csa-protocol-game

## 1. 現状調査

### 1.1 rshogi-oss CSAクライアント（移植元）

| モジュール | パス | 行数 | 概要 |
|-----------|------|------|------|
| protocol.rs | `crates/tools/src/csa_client/protocol.rs` | 612 | TCP接続、LOGIN、GAME_SUMMARY解析、指し手送受信 |
| engine.rs | `crates/tools/src/csa_client/engine.rs` | 464 | USIエンジンのサブプロセス管理、ponder |
| session.rs | `crates/tools/src/csa_client/session.rs` | 632 | ゲームループ、時計管理、ponder状態遷移 |
| config.rs | `crates/tools/src/csa_client/config.rs` | 199 | TOML設定、CLI/ENV/ファイルのオーバーライド階層 |
| record.rs | `crates/tools/src/csa_client/record.rs` | 248 | CSA/SFEN形式の棋譜出力、ファイル保存 |
| common/csa.rs | `crates/tools/src/common/csa.rs` | 1193 | CSA⇔USI変換、局面パース（純粋関数） |
| common/floodgate.rs | `crates/tools/src/common/floodgate.rs` | 239 | Floodgate棋譜サーバーのダウンロード補助（評価値コメント生成は session.rs に存在） |

**アーキテクチャの特徴:**
- **同期スレッドモデル**: `std::net::TcpStream` + `std::sync::mpsc` + `std::thread`
- サーバー読み取り専用スレッド + メインスレッドでゲームループ
- エンジンもサブプロセス + 読み取りスレッド

### 1.2 デスクトップアプリ（統合先）

**Rust側 (`apps/desktop/src-tauri/src/`)**

| ファイル | 行数 | 概要 |
|---------|------|------|
| lib.rs | 1632 | 内蔵エンジン管理、NNUE、Tauri command 登録 |
| usi_engine.rs | 1500 | 外部USIエンジンのセッション管理、USIプロセス制御、イベント送出 |

**状態管理パターン:**
- `EngineState`: 内蔵エンジン用、`Mutex<EngineStateInner>`
- `UsiEngineManager`: 外部エンジン用、`HashMap<String, UsiEngineSession>`
- Tauri Store (`store.json`): エンジン登録・オプションの永続化

**イベントパターン:**
- チャネル名: `engine://event`（内蔵）、`engine://usi/{sessionId}`（外部USI）
- JSON: `{ "type": "info"|"bestmove"|"error", ... }` の構造化イベント

**TypeScript側**

| パッケージ | 役割 |
|-----------|------|
| engine-client | `EngineClient` インターフェース定義 |
| engine-tauri | Tauri IPC経由のクライアント実装（内蔵 + 外部USI） |
| app-controller | `EngineController` による状態管理、ライフサイクル |
| app-core/game/csa.ts | CSA棋譜フォーマット変換（プロトコル通信は未対応） |
| match-client | WebSocketルームクライアント（イベント配信パターンの参考） |
| match-protocol | オンライン対戦用の時計・イベント型定義 |
| ui | `useEngineManager` フック、対局UIコンポーネント |

**重要な制約:**
- 既存の `EngineClient` / `engine-tauri` は `position` / `go` / `stop` / `quit` を中心に設計されている
- CSA対局に必要な `usinewgame` / `gameover` / `ponderhit` は現状の公開APIには含まれていない
- したがって、CSAセッション層から既存エンジン管理を再利用する場合も、Tauri command または専用ラッパーの追加が必要

### 1.3 既存の規約・パターン

- **Factory関数パターン**: classではなくクロージャでstate隠蔽（`createUsiEngineClient`等）
- **IPC**: `tauriInvoke` + `tauriListen` でコマンド/イベント分離
- **セッション管理**: UUID v4によるセッションID、セッションスコープのイベントチャネル
- **永続化**: `tauri-plugin-store` で `store.json` にJSON保存
- **モックフォールバック**: IPC失敗時にmockに切り替え（engine-tauri）

---

## 2. 要件別ギャップマップ

### Req 1: CSAサーバー接続・認証

| 技術要素 | 状態 | ギャップ |
|---------|------|---------|
| TCP接続 | rshogi-ossに`CsaConnection`あり | **要変換**: `std::net::TcpStream` → `tokio::net::TcpStream` |
| LOGIN/LOGOUT | protocol.rsに実装あり | **要変換**: ブロッキングI/O → async/await |
| TCP_NODELAY/SO_KEEPALIVE | protocol.rsに実装あり | 移植可能（libc依存、Windowsは要確認） |
| keep-alive ping | protocol.rsに実装あり | **要変換**: `std::thread` → `tokio::spawn` |
| Tauriコマンド | なし | **Missing**: `csa_connect`, `csa_disconnect` コマンド定義が必要 |
| フロントエンド状態通知 | なし | **Missing**: 接続状態イベント発行 |

### Req 2: 対局マッチング・開始

| 技術要素 | 状態 | ギャップ |
|---------|------|---------|
| GAME_SUMMARY解析 | protocol.rsに実装あり | 移植可能（純粋パース） |
| AGREE/REJECT | protocol.rsに実装あり | **要変換**: async化 |
| STARTハンドリング | session.rsに実装あり | **要変換**: async化 |
| UI通知 | なし | **Missing**: 対局情報のイベント発行 |

### Req 3: 対局進行

| 技術要素 | 状態 | ギャップ |
|---------|------|---------|
| CSA⇔USI変換 | common/csa.rsに実装あり（1193行） | **100%再利用可能**（純粋関数） |
| bestmove resign → %TORYO | session.rsに実装あり | 移植可能 |
| bestmove win → %KACHI | session.rsに実装あり | 移植可能 |
| エコー検証 | session.rsに実装あり | 移植可能 |
| エンジン連携 | engine.rsに実装あり | **要置換**: Tauriの既存エンジン管理を利用 |
| 盤面UI更新 | UIコンポーネントは既存 | **Missing**: CSA→UIの接続フック |

### Req 4: 時間管理

| 技術要素 | 状態 | ギャップ |
|---------|------|---------|
| Time_Unit解析 | protocol.rsに実装あり | 移植可能 |
| Clock構造体 | session.rsに実装あり | 移植可能（秒読み / increment / 持ち時間のみ を扱う） |
| go引数組み立て | session.rsの`build_go_args` | 移植可能（純粋関数） |
| マージン時間 | config.rsで設定、session.rsで適用 | 移植可能 |
| UI表示 | 既存UIに時計表示パターンあり | **Missing**: CSA対局用の時計表示モデルを定義し、必要に応じて既存UI propsへアダプト |

### Req 5: Ponder対応

| 技術要素 | 状態 | ギャップ |
|---------|------|---------|
| ponder状態遷移 | session.rsに実装あり | 移植可能だがレース条件の理解が必要 |
| `go ponder` / `ponderhit` / `stop` | rshogi-oss側エンジンラッパーに実装あり | **Missing**: ramu-shogi 側の Tauri command / TS API には専用操作が未公開 |
| EngineClient | `bestmove.ponder` の受信は対応済み | **不足**: `ponderhit` と古い `bestmove` 破棄を表現するAPIがない |
| ponder外れ時の古いbestmove待ち | session.rsに実装あり | **重要**: 設計時に明示が必要 |

### Req 6: 対局終了・結果処理

| 技術要素 | 状態 | ギャップ |
|---------|------|---------|
| `#WIN/#LOSE/#DRAW/#CENSORED/#CHUDAN` | protocol.rsに実装あり | 移植可能 |
| 終局理由行（`#TIME_UP` 等） | protocol.rs + session.rsに実装あり | 移植可能 |
| `gameover` 通知 | rshogi-oss側には実装あり | **Missing**: ramu-shogi 側の Tauri command / TS API に公開されていない |
| UI結果通知 | なし | **Missing**: CSA終局イベントの設計が必要 |

### Req 7: 棋譜記録

| 技術要素 | 状態 | ギャップ |
|---------|------|---------|
| CSA形式出力ロジック | record.rsに実装あり | **一部再利用可能**: ただし `GameSummary` / `SearchInfo` / `RecordConfig` 等への依存整理が必要 |
| SFEN形式出力ロジック | record.rsに実装あり | **一部再利用可能**: 上記と同様に型依存の切り離しが必要 |
| ファイル保存 | record.rsに実装あり | `std::fs` 利用のため、Tauri側実装方針に合わせて再整理が必要 |
| アプリ棋譜リスト追加 | なし | **Missing**: フロントエンドへの棋譜データ通知または既存棋譜管理との統合が必要 |

### Req 8: Floodgate拡張

| 技術要素 | 状態 | ギャップ |
|---------|------|---------|
| 評価値コメント生成 | session.rsの`build_floodgate_comment`に実装あり | **再利用候補**: ただし `SearchInfo` / `Position` 依存あり |
| 符号正規化 | session.rs / record.rsに実装あり | 再利用候補 |
| 詰み評価の ±100000 変換 | session.rs / record.rsに実装あり | 再利用候補 |
| `common/floodgate.rs` | Floodgate棋譜ダウンロード補助 | CSA送信コメント生成とは別物のため抽出対象を分けて扱う必要あり |

### Req 9: 接続設定UI

| 技術要素 | 状態 | ギャップ |
|---------|------|---------|
| 設定画面 | なし | **Missing**: React UIコンポーネント |
| プリセット（floodgate） | なし | **Missing**: プリセットデータ + 選択UI |
| エンジン選択 | 外部USIの登録UIは既存 | 拡張可能 |
| 永続化 | tauri-plugin-store利用パターン既存 | **要実装**: CSA設定のStore統合 |

### Req 10: 対局中UI

| 技術要素 | 状態 | ギャップ |
|---------|------|---------|
| 盤面表示 | 既存UIコンポーネント（ShogiBoard等） | 再利用可能 |
| 探索情報表示 | 既存UIコンポーネント | 再利用可能 |
| 接続状態表示 | なし | **Missing**: CSA接続状態ステータスバー |
| 対局待ち/対局中の操作分離 | なし | **Missing**: 状態に応じたボタン制御 |

### Req 11: エラーハンドリング・再接続

| 技術要素 | 状態 | ギャップ |
|---------|------|---------|
| 指数バックオフ | config.rsのRetryConfig | 移植可能 |
| 切断検知 | protocol.rsのreader thread | **要変換**: tokioのストリーム終了検知 |
| 投了+LOGOUT | session.rsに実装あり | **要変換**: async化 |

### Req 12: エンジンライフサイクル

| 技術要素 | 状態 | ギャップ |
|---------|------|---------|
| `usi` → `isready` | Tauriの既存実装あり | 再利用可能 |
| `usinewgame` | 内部実装としては送信可能な構成 | **Missing**: 公開command / TS API としては未整備 |
| `gameover` | rshogi-oss側には実装あり | **Missing**: ramu-shogi 側の公開APIが未整備 |
| `quit` | usi_engine.rs に実装あり | 再利用可能 |
| 起動タイムアウト | usi_engine.rs に実装あり | 再利用可能 |

---

## 3. 実装アプローチ選択肢

### Option A: rshogi-ossモジュールを直接crate依存として利用

**概要**: `tools` crateまたは抽出したサブcrateを `Cargo.toml` 依存に追加し、型・ロジックを直接import

**変更対象:**
- `apps/desktop/src-tauri/Cargo.toml` にrshogi-oss依存追加
- 新規 `csa_game.rs` でasyncラッパー作成
- rshogi-oss側で必要に応じてライブラリcrateを分離

**トレードオフ:**
- ✅ コード重複なし、型の一貫性保証
- ✅ rshogi-oss側の修正が自動的に反映
- ❌ rshogi-ossへのpath依存が必要（モノレポ外）
- ❌ tools crateの不要な依存（clap、ctrlc等）を引き込む可能性
- ❌ rshogi-oss側のpublic API安定性に依存

### Option B: 必要なロジックをramu-shogiにポートし、async化

**概要**: rshogi-ossからCSAプロトコル関連コードをTauriモジュールとして移植、tokio非同期に書き換え

**変更対象:**
- `apps/desktop/src-tauri/src/csa_game.rs` — 新規作成（protocol + session + record）
- `apps/desktop/src-tauri/src/lib.rs` — コマンド登録追加
- `apps/desktop/src-tauri/Cargo.toml` — 追加依存なし（tokioは既存）

**トレードオフ:**
- ✅ 外部依存なし、self-contained
- ✅ Tauri非同期モデルに最適化
- ✅ 不要な機能を省略可能
- ❌ コード重複、rshogi-oss側の修正を手動で追従
- ❌ 移植作業量が大きい（推定600-800行の新規コード）

### Option C: ハイブリッド — 抽出可能な純粋ロジックのみ共有し、I/O層はTauriで新規

**概要**: rshogi-oss から純粋ロジックとして分離しやすい部分だけを共有化し、CSAの接続管理・ゲームループ・Tauriイベント送出は ramu-shogi 側で実装する。

**抽出候補:**
- `common/csa.rs` の CSA⇔USI 変換と局面補助
- 必要であれば、棋譜出力ロジックのうち I/O を含まない部分
- Floodgateコメント生成は有力候補だが、`SearchInfo` / `Position` 依存を整理してから判断する

**抽出対象に含めない方がよいもの:**
- TCP接続・reader thread・再接続制御
- CLI設定、`clap`、`ctrlc`
- TauriイベントやStoreと密結合になる部分

**変更対象:**
- rshogi-oss: 必要なら共有crateを新設
- ramu-shogi: `apps/desktop/src-tauri/src/csa_game.rs` を新規実装
- ramu-shogi: Tauri command / event / Store統合を追加

**トレードオフ:**
- ✅ 純粋ロジックの重複を抑えられる
- ✅ I/O層は Tauri / 既存デスクトップアーキテクチャに合わせて設計できる
- ✅ `EngineClient` 境界やイベント形式を ramu-shogi 側の規約に揃えやすい
- ❌ 抽出対象の依存整理に追加作業が必要
- ❌ `record.rs` や Floodgateコメント生成は即時の独立再利用が難しい可能性がある

---

## 4. 複雑度・リスク評価

### 工数見積もり: **L（1〜2週間）**
**根拠:**
- Rust側: asyncプロトコル層（200-300行）+ セッション管理（200-300行）+ Tauriコマンド定義（100-150行）
- TypeScript側: CSAクライアントラッパー（100-150行）+ フック/コントローラー（200-300行）+ UI（300-500行）
- 複数の統合ポイント（エンジン制御、イベントフロー、永続化）

### リスク: **Medium**
**根拠:**
- rshogi-ossの実装が成熟しており、プロトコル仕様の不明点は少ない
- Tauriの既存パターン（usi_engine.rs）が良いテンプレートになる
- ただし、ponderの非同期状態遷移は複雑（レース条件のリスク）
- TCPソケットのエラーリカバリはテストが難しい（実サーバー依存）

### Research Needed（設計フェーズで要調査）
1. **エンジンAPI拡張方針**: `usinewgame` / `gameover` / `ponderhit` を Tauri command に追加するか、CSA専用 Rust ラッパーで閉じるか
2. **エンジン共有問題**: CSA対局用エンジンと通常解析用エンジンの排他制御
3. **Windows TCP keep-alive**: `socket2` 等を使ったクロスプラットフォーム実装方針
4. **CSAイベントモデル**: `csa://...` 専用イベント型を作るか、既存UIモデルへ変換して渡すか
5. **共有crate切り出し範囲**: `common/csa.rs` のみ先行抽出するか、棋譜出力ロジックまで含めるか

---

## 5. 設計フェーズへの推奨事項

### 推奨アプローチ: **Option C（ただし抽出範囲は最小から開始）**

**理由:**
- `common/csa.rs` は再利用価値が高く、共有候補として最も有力
- 一方で、`record.rs` と Floodgateコメント生成は現時点では周辺型への依存があり、そのまま独立crate化できるとは限らない
- CSAセッション管理は、既存の `EngineClient` / Tauri command の不足分（`usinewgame` / `gameover` / `ponderhit`）を補う設計が必要であり、Tauri側で明示的に設計した方が安全
- まずは「共有ロジック最小 + セッション層新規実装」で進め、必要に応じて抽出範囲を広げるのが現実的

### 設計フェーズで決定すべき事項
1. **Rust側の新規モジュール構成**: 単一ファイル `csa_game.rs` vs 複数ファイル分割
2. **フロントエンドのCSA対局フロー**: 既存の`useEngineManager`を拡張 vs 新規`useCsaGame`フック
3. **イベントチャネル設計**: CSA専用チャネル名の命名（`csa://game/{sessionId}`等）
4. **内蔵エンジンのCSA対局利用**: 現状の`EngineState`（単一グローバル）との排他をどう扱うか
5. **rshogi-ossからのcrate切り出し範囲**: `common/csa.rs` のみ先行 vs 棋譜出力含む
