# @shogi/engine-wasm

WebAssembly版の将棋エンジンパッケージです。Rustで実装されたコアエンジンをWASMにコンパイルし、ブラウザ環境で動作させることができます。

## 必要なツール

WASMビルドには以下のセットアップが必要です（threaded ビルドは nightly 必須）：

```bash
# Rustのデフォルトツールチェーンを設定（single 用）
rustup default stable

# WASMターゲットを追加（single 用）
rustup target add wasm32-unknown-unknown

# threaded 用の nightly ツールチェーン（固定版）
rustup toolchain install nightly-2025-12-25
rustup component add rust-src --toolchain nightly-2025-12-25

# wasm-bindgen-cli を固定バージョンでインストール
cargo install wasm-bindgen-cli --version 0.2.106
```

## ビルド

```bash
pnpm --filter @shogi/engine-wasm build
```

内部的には以下のステップが実行されます：

1. `build:wasm`: RustコードをWASMにコンパイル（single + threaded の2系統）
2. `tsc`: TypeScriptのビルド

生成物：

- `packages/engine-wasm/pkg`: single-threaded 用 wasm
- `packages/engine-wasm/pkg-threaded`: threaded 用 wasm（`engine_wasm_worker.js` を含む）

WASM だけ再生成したい場合は次を実行します：

```bash
pnpm --filter @shogi/engine-wasm build:wasm
```

`build:wasm` は single + threaded を必ず両方作るため、固定版 nightly が未導入だと失敗します。
別バージョンを使う場合は `RUST_NIGHTLY_TOOLCHAIN` で上書きできます（例: `nightly-YYYY-MM-DD`）。

## threaded ビルドの詳細（試行錯誤メモ）

threaded ビルドは制約が多く、以下の前提で構成しています。

- **nightly 必須**: `-Z build-std=std,panic_abort` を使うため（wasm threads 用の std 再構築が必要）。
- **custom target spec**: `packages/rust-core/targets/wasm32-unknown-unknown.json` を使用して `+atomics,+bulk-memory,+mutable-globals` を有効化。
  - `-C target-feature=...` での指定は警告が出るため、target spec に寄せています。
- **shared memory/TLS export**: threaded ビルドは `--shared-memory` などの link-arg を追加（`build-wasm.mjs` 内）。
- **worker スクリプトの自前生成**: `wasm-bindgen --target web` は worker を出力しないため、
  `build-wasm.mjs` が `engine_wasm_worker.js` を生成します。
- **ThreadPool 初期化は JS 側**: `engine.worker.threaded.ts` で Wasm module/memory を保持し、
  `engine_wasm_worker.js` を複数起動して `{ module, memory, thread_stack_size }` を配布します
  （`DEFAULT_THREAD_STACK_SIZE=2MB`）。
- **出力検証**: `pkg-threaded/engine_wasm_worker.js` と `initThreadPool` export の存在をビルド時に検証しています。

## ベンチマーク

WASMビルド済みの状態で、NNUEモデルを指定してベンチを実行できます。

```bash
pnpm --filter @shogi/engine-wasm build:wasm
pnpm --filter @shogi/engine-wasm bench:wasm -- --nnue-file /path/to/nn.bin > wasm_bench.json
```

デフォルトはYaneuraOu準拠の4局面を使用します。任意の局面を使う場合は
`--sfens` で SFEN リストファイルを指定してください。

Material評価のみを計測する場合は `--material` を指定します。

## ブラウザ対応状況

| ブラウザ        | single | threaded | 備考                                      |
| --------------- | ------ | -------- | ----------------------------------------- |
| Chrome 92+      | ✅      | ✅        | 完全対応                                  |
| Edge 92+        | ✅      | ✅        | 完全対応                                  |
| Firefox 89+     | ✅      | ✅        | 完全対応                                  |
| Safari 15.2+    | ✅      | ⚠️        | SharedArrayBuffer 制限あり（COOP/COEP 必須） |

**threaded ビルドの追加要件**:
- `crossOriginIsolated === true` であること
- `SharedArrayBuffer` が利用可能であること
- サーバーが以下のヘッダーを返すこと:
  - `Cross-Origin-Opener-Policy: same-origin`
  - `Cross-Origin-Embedder-Policy: require-corp`

## トラブルシューティング

### threaded ビルドが動作しない

1. **`crossOriginIsolated` が `false`**: COOP/COEP ヘッダーを確認してください
2. **`SharedArrayBuffer` が `undefined`**: ブラウザのバージョンを確認してください
3. **メモリエラー**: スレッド数を減らして再試行してください（推奨: CPUコア数の50-75%）

### ビルドエラー

1. **nightly ツールチェーンが見つからない**: `rustup toolchain install nightly-2025-12-25` を実行
2. **wasm-bindgen バージョン不一致**: `cargo install wasm-bindgen-cli --version 0.2.106` を実行
3. **rust-src が見つからない**: `rustup component add rust-src --toolchain nightly-2025-12-25` を実行

## パフォーマンスチューニング

- **既定スレッド数**: 1。増やす際は CPU 数だけでなく、下記のメモリ実測も確認する。
- **メモリ使用量**: スタックだけでなく、worker ごとの探索履歴・評価器を含む。下記の実測を参照。
- **最大スレッド数**: 8（CPU 数でも制限。低メモリ端末への推奨値ではない）

## 実モデルでの動作確認

WASM をビルドした後、単一スレッド WASM でフォーマット検出・ロード・初期局面から深さ2の探索を行います。

```sh
node scripts/smoke-nnue.mjs /path/to/kingrank9.bin kingrank9
node scripts/smoke-nnue.mjs /path/to/progress.bin progresskpabs 8 /path/to/coeff.bin
node scripts/smoke-nnue.mjs /path/to/halfkp.bin
node scripts/smoke-nnue.mjs /path/to/yo-progress-nn.bin progresskpabsq16 8 /path/to/progress.bin
```

Rust 側にも外部モデルを使う ignored test があります。`NNUE_TEST_FILE`、必要なら
`NNUE_TEST_ROUTING`（例: `{"bucketMode":"progresskpabs","progressBuckets":8}`）と
`NNUE_TEST_PROGRESS_FILE` を設定し、`cargo test real_model_load_and_search -- --ignored --nocapture` で実行します。

## 局面解析の協調停止・再開

初期化後の `client.analysis.available()` が true の場合に解析用 API を使える。
共有メモリが使える場合は探索 1 スレッドでも threaded ビルドを使用する（helper pool は不要）。
通常の `search` / `stop` の停止方式は従来どおりで、解析は専用 API を使う。

```ts
await client.init({ threads: 1, multiPv: 3, ttSizeMb: 64 });
// モデル／評価設定を適用してから局面をロードする。
await client.loadPosition("startpos", []);
const sessionId = crypto.randomUUID();
const run = await client.analysis!.start(sessionId, { type: "unlimited" }, onInfo);
const paused = await run.pause(); // 全 worker の停止完了を待つ
if (paused.resumable) {
    const continued = await client.analysis!.resume(sessionId, { type: "time", milliseconds: 10_000 }, onInfo);
    const finished = await continued.finished;
}
```

- `start` は現在ロード済みの局面・設定で新規セッションを開始する。`resume` の前に設定や局面を送り直さない。
- 設定・局面・通常探索・初期化・Worker の再作成は再開状態を失効させる。
- `info` はその実行のコールバックにだけ届く。古い session/run の通知と cancel は破棄する。
- `finished` に main の完了深さ、今回／累積の時間・ノード、終了理由、再開可否を返す。
- 停止は専用 AtomicU32 への世代付き CAS。停止完了まで 5 秒を超えた場合は Worker を破棄し、再開可能とは報告しない。
- `release` は停止済みの再開状態を失効させる。エンジンの作業用メモリも解放するには `client.dispose()` を呼ぶ。
- 非共有環境では `available()` は false。結果保持と通常の新規探索を使い、続行を偽装しない。

### メモリとスレッド数

既定は 1、Web の選択上限は 8（CPU 数でも制限）。30 worker は Wasm の 2 GiB 上限に収まらない。
2026-10-17 の Chromium 145 / Windows の実測では、TT 4 MiB・評価 hash 1 MiB・suisho5 約 61 MiB の場合、
Wasm 線形メモリは 1/2/4/8 worker で約 233/336/543/956 MiB。10 回の追加再開で同値だった。
これはプロセス RSS や全モデル・全局面の最大値ではない。低メモリ端末へ 8 worker を推奨しない。
NNUE と TT の容量によって必要メモリが増える。

### 再現テスト

リポジトリ root で依存パッケージと Wasm／TypeScript をビルドしてから実行する。
Playwright の Chromium が必要（`pnpm --filter @shogi/engine-wasm exec playwright install chromium`）。

```bash
pnpm --filter @shogi/engine-wasm test:resume
pnpm --filter @shogi/engine-wasm test:resume "$SHOGI_DATA/nnue/suisho5.bin"
pnpm --filter @shogi/engine-wasm test:analysis-client
```

前者は生成した共有 Wasm と実 Rayon helper、後者は製品クライアントと Worker キューを通す。
1/2/4/8 threads × MultiPV 1/3、追加ノード、古い cancel、10 回の再開、非共有環境の能力表示を確認する。
UI の追従・保存・区間解析や Desktop の試験とは区別する。
