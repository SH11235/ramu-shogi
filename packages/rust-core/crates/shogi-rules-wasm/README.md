# shogi-rules-wasm

サーバー (ramu-shogi-backend の RoomDO) がクライアントの申告を確かめるための、将棋のルール判定だけを持つ wasm。
探索・評価関数は含まない。ルールの実装は engine-wasm と同じ rev の rshogi-core を使う。

## API (wasm-bindgen, `--target web`)

- `judgeGame({ startSfen, passRights, moves })` → `{ ok, illegalIndex?, reason?, finalSfen, inCheck, checkmate, noLegalMoves, repetition }`
  - `startSfen`: プリセットを展開済みの SFEN (`startpos` も可)。`passRights`: `{ b, w }` の初期値か `null`。`moves`: USI (`pass` を含む)
  - 反則手があれば `ok: false` とその添字・理由を返し、最終局面はその直前の局面になる
  - `repetition`: `none` / `sennichite` / `oute_sennichite_lose_b` / `oute_sennichite_lose_w` (連続王手を掛け続けた側の負け)。最終局面だけを判定する
  - 開始局面が読めない・玉が各 1 枚でない・パス権が 15 を超える・開始手数が 1 未満か手数を足すと i32 を超えるときは例外を投げる
  - パスは `pass` だけを受け付け、rshogi-core が互換で読む `0000` / `none` は `invalid_usi` にする
- `canonicalSfen(sfen)` → rshogi の表記に揃えた SFEN

千日手の同一局面は「盤・持ち駒・手番」で数え、パス権の残り回数は区別しない (backend の SFEN 出現回数と同じ)。
パス権は rshogi-core が 1 手番あたり 4 bit で持つため 15 が上限。

`panic = "abort"` でビルドするので、万一 panic すると wasm は trap し、その instance は使えなくなる。
呼び出し側は trap 後に同じ instance を使い続けないこと。

## ビルドと backend への配置

```sh
pnpm install --frozen-lockfile
pnpm build:rules-wasm
pnpm test:rules-wasm
node packages/rust-core/crates/shogi-rules-wasm/scripts/copy-to-backend.mjs <backend repo のパス>
```

`wasm-opt` はルートの `devDependencies` に固定した [binaryen](https://github.com/AssemblyScript/binaryen.js#command-line) の
Node CLI を使う。別のネイティブ実行ファイルを使う場合は、そのパスを `WASM_OPT` に指定する。

`build.mjs` は wasm-bindgen CLI の版が Cargo.lock の wasm-bindgen と一致することを確かめ、`pkg/manifest.json` に
生成元 commit・rshogi-core の rev・ツールの版・各ファイルの sha256 を書く。wasm-bindgen の出力は実行ごとに
揺れることがあるため、決定的な rustc の出力 (wasm-bindgen 前) の sha256 も `rustcWasmSha256` に残す。
ビルド機のパスは `--remap-path-prefix` で置き換え、wasm に残っていればビルドを失敗させる。`copy-to-backend.mjs` は未コミットの
変更を含むビルドを拒否する。

`fixtures/rules-fixtures.json` は backend と共通の判定 fixture で、Rust のテスト (`tests/fixtures.rs`)、
apps/web の `rules-fixtures.wasm.test.ts` (engine-wasm の棋譜再生との一致)、backend のテストが読む。
