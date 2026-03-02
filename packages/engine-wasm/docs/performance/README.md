# WASM パフォーマンス計測レポート

Web/WASM 版のベンチ計測結果を記録する。
Rust 側の `docs/performance/README.md` の形式に合わせた簡易版。

## 計測環境

| 項目 | 値 |
|------|-----|
| CPU | AMD Ryzen 9 5950X 16-Core Processor |
| コア数 | 32 |
| OS | Linux |
| アーキテクチャ | x64 |
| 計測ツール | `packages/engine-wasm/scripts/bench-wasm.mjs` |

## 計測条件

- Threads: 1（WASM）
- TT: 64MB
- Limit: nodes=1,000,000
- Iterations: 1（warmup 0）
- 局面: YaneuraOu準拠4局面（`hirate-like`, `complex-middle`, `tactical`, `movegen-heavy`）

---

## NNUE 有効時

計測日: 2026-02-14T15:02:33Z
計測コマンド:

```bash
pnpm --filter @shogi/engine-wasm bench:wasm -- --nnue-file /home/sh11235/development/rshogi/eval/halfkp_256x2-32-32_crelu/suisho5.bin
```

NNUE ファイル: `eval/halfkp_256x2-32-32_crelu/suisho5.bin`

### 集計

| 指標 | 値 |
|------|-----|
| 合計ノード数 | 4,000,284 |
| 合計時間 | 31,861ms |
| 平均NPS | 125,555 |
| 平均探索深さ | 16.75 |
| 平均hashfull | 252.50 |

### 局面別

| 局面 | depth | nodes | time_ms | nps | hashfull | bestmove |
|------|-------|-------|---------|-----|----------|----------|
| hirate-like | 21 | 1,000,062 | 9,048 | 110,528 | 105 | 3g3f |
| complex-middle | 15 | 1,000,090 | 6,993 | 143,013 | 202 | B*6h |
| tactical | 14 | 1,000,080 | 7,945 | 125,875 | 304 | 5d6c+ |
| movegen-heavy | 17 | 1,000,052 | 7,875 | 126,990 | 399 | N*2c |

---

## Material 評価時（NNUE 無効）

計測日: 2026-02-14T15:03:10Z
計測コマンド:

```bash
pnpm --filter @shogi/engine-wasm bench:wasm -- --material
```

### 集計

| 指標 | 値 |
|------|-----|
| 合計ノード数 | 4,000,377 |
| 合計時間 | 8,759ms |
| 平均NPS | 456,701 |
| 平均探索深さ | 14.25 |
| 平均hashfull | 273.00 |

### 局面別

| 局面 | depth | nodes | time_ms | nps | hashfull | bestmove |
|------|-------|-------|---------|-----|----------|----------|
| hirate-like | 17 | 1,000,017 | 2,150 | 465,124 | 107 | 2h2f |
| complex-middle | 14 | 1,000,128 | 2,236 | 447,284 | 232 | B*6h |
| tactical | 12 | 1,000,053 | 2,197 | 455,190 | 328 | S*6a |
| movegen-heavy | 14 | 1,000,179 | 2,176 | 459,641 | 425 | G*3c |

---

## 並列探索ベンチマーク（ネイティブ版）

計測日: 2025-12-24
計測コマンド:

```bash
cd packages/rust-core
RUSTFLAGS="-C target-cpu=native" cargo build --release
./target/release/benchmark \
  --engine ./target/release/engine-usi \
  --threads 1,2,4,8 \
  --limit-type movetime \
  --limit 5000 \
  --tt-mb 512
```

### NNUE評価 - NPS比較

| 局面 | 1スレッド | 2スレッド | 4スレッド | 8スレッド |
|------|-----------|-----------|-----------|-----------|
| hirate-like | 578,853 | 1,133,615 | 1,612,023 | 3,424,602 |
| complex-middle | 413,408 | 749,531 | 1,585,273 | 2,212,078 |
| tactical | 445,760 | 579,640 | 1,669,592 | 2,756,123 |
| movegen-heavy | 446,374 | 811,199 | 1,252,278 | 2,686,478 |

### NNUE評価 - 探索深さ

| 局面 | 1スレッド | 2スレッド | 4スレッド | 8スレッド |
|------|-----------|-----------|-----------|-----------|
| hirate-like | 15 | 16 | 18 | 19 |
| complex-middle | 17 | 18 | 18 | 19 |
| tactical | 16 | 16 | 16 | 17 |
| movegen-heavy | 16 | 17 | 16 | 17 |

### Material評価 - NPS比較

| 局面 | 1スレッド | 2スレッド | 4スレッド | 8スレッド |
|------|-----------|-----------|-----------|-----------|
| hirate-like | 575,692 | 1,074,132 | 1,658,714 | 2,799,023 |
| complex-middle | 418,034 | 763,051 | 1,314,938 | 2,740,824 |
| tactical | 448,512 | 845,602 | 1,746,267 | 2,660,318 |
| movegen-heavy | 435,112 | 623,477 | 1,676,106 | 2,336,612 |

### スケーラビリティ

| スレッド数 | 理想倍率 | NNUE実測倍率 | NNUE効率 | Material実測倍率 | Material効率 |
|------------|----------|--------------|----------|------------------|--------------|
| 2 | 2.0x | 1.74x | 86.9% | 1.75x | 87.5% |
| 4 | 4.0x | 3.25x | 81.2% | 3.44x | 86.0% |
| 8 | 8.0x | 5.88x | 73.5% | 5.68x | 71.0% |

### 総合まとめ

| 評価関数 | 1スレッド平均NPS | 8スレッド平均NPS | 8スレッド倍率 |
|----------|------------------|------------------|---------------|
| Material | 469,338 | 2,634,194 | 5.61x |
| NNUE | 471,052 | 2,769,515 | 5.88x |

**備考**: 並列探索はLazy SMP方式で実装。8スレッドで約5.7〜5.9倍のNPS向上を達成。WASM版では並列探索は未対応（シングルスレッドのみ）。

---

## 変更履歴

| 日付 | NNUE平均NPS | Material平均NPS | 内容 |
|------|----------:|---------------:|------|
| 2025-12-21 | ~~310,824~~ | 314,712 | 初回計測。**※NNUE値は信頼性なし**（後述） |
| 2025-12-23 | ~~309,932~~ | 312,866 | **board_effect機能追加**（fix-material-board_effectブランチ）。Material評価で利きの情報を使用する機能を追加。**※NNUE値は信頼性なし**（後述） |
| 2025-12-24 | - | - | **並列探索実装**（parallel-searchブランチ）。Lazy SMP方式による並列探索を実装。8スレッドでNNUE: 5.88x、Material: 5.61xのスケーラビリティを達成 |
| 2025-12-25 | ~~306,925~~ | 311,063 | **定期計測**（opt-parallel-searchブランチ）。**※NNUE値は信頼性なし**（後述） |
| 2026-02-14 | 125,555 | 456,701 | **NNUE初の正常計測**（fix-search-ttブランチ）。Material NPS大幅向上（311,063→456,701、**+47%**）は探索ロジック改善の累積効果。NNUE NPS（125,555）はWASM SIMD128有効だがネイティブAVX2（256-bit）との差が大きく、Materialの約28% |

**※2025-12-21〜25のNNUE計測値について**: NNUE平均NPSがMaterialとほぼ同値（誤差1%以内）であり、WASM環境ではNNUE評価がMaterialより大幅に遅くなるのが妥当であることから、**NNUEファイルの読み込みに失敗し、サイレントにMaterial評価にフォールバックしていた可能性が高い**。`evaluate_dispatch()`はNNUE未ロード時に警告なしでMaterial評価にフォールバックする設計であり、ベンチスクリプト側にもNNUEロード成功の検証ロジックがなかった。2026-02-14の計測が**WASM版NNUE評価の初の正常な計測値**と考えられる。なおWASMビルドはSIMD128を有効化済み（`build-wasm.mjs`で`-C target-feature=+simd128`指定）であり、NNUE評価の主要関数（AffineTransform、FeatureTransformer、ClippedReLU等）にWASM SIMD128実装が存在する。
