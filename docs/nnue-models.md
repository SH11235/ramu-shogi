# NNUE モデルの読み込み

Web と Desktop は Q16 routing 対応の rshogi-core（0.7.0 ベース）の `edition-universal` を使います。
NNUE の特徴量・次元・拡張はモデルヘッダーから読み取ります。
両方の core と Desktop の CSA クライアントは同じ Git revision を参照します。
依存 revision は3箇所を同時に更新してください。

## LayerStacks の設定

評価関数ファイル管理で NNUE をインポートし、作者が指定する FV_SCALE と
LayerStacks の振り分け方式を設定してください。登録済みモデルの設定も変更できます。
ヘッダーの形式や格納バケット数だけから学習時の振り分け方式は推測できません。

- **KingRank9 / k3k3**: 両玉の段を3区分ずつに分けた9バケット。
  rshogi の KingRank9 と YaneuraOu の k3k3 は同じ方式です。進行度係数は不要です。
- **progresskpabs（tatara / rshogi）**: 学習時の進行度バケット数（1〜16、モデルの格納数以下）と、
  学習時に使った進行度係数ファイルを指定します。バケット数1だけは係数不要です。
  旧形式の格納9バケットを `floor(p × 8)` で学習したモデルでは8を指定します。
- **progressN Q16（YaneuraOu / BulletOu）**: 単独 progress2 / progress4 / progress8 /
  progress16 のモデルと、同じ checkpoint の `progress.bin` を指定します。
  設定キーは `progresskpabsq16` です。

進行度係数のファイル形式は共通ですが、tatara 系は f32 の和、YaneuraOu 系は
係数を Q16 整数化した i64 の和で判定します。境界付近の振り分けを学習時と揃えるため、
モデルの配布元に対応する方式を選択してください。Q16 の対応バケット数では、
BulletOu の「256段階に分類してからN分割」と YaneuraOu のN分割の閾値が一致します。

進行度係数は **1,003,104 bytes**（81 × 1548 個の little-endian f64）のファイルです。
アプリはサイズと有限値を検証し、モデルのメタデータとともにローカル保存します。
モデルを選び直す場合や Web Worker が再起動した場合も、同じ設定が使われます。
HalfKP / HalfKA 系では LayerStacks の設定を指定しません。
ロード済みモデルの設定を変更した場合、Web はページを再読み込みし、
Desktop はアプリを終了して再起動してください。

## YaneuraOu SFNN

通常の 8bit `SFNNWithoutPsqt`（version `0x7AF32F16`）を直接インポートできます。
ロード時に rshogi の LayerStacks 形式へ変換し、整数重みは変更しません。
モデル設定は k3k3 なら **KingRank9**、単独 progressN なら **progressN Q16** を選択し、
通常の SFNN では **FV_SCALE=28** を指定します。

対応する特徴量は HalfKP、HalfKA1、HalfKA2、HalfKA_hm1、HalfKA_hm2 です。
対応ヘッダーは HalfKA_hm2 の `SFNN-1536` / `SFNN-1536-V2`、または形状が明記された
`SFNN_<feature>_<FT>_<H1>_<H2>_K3K3` / `..._PROGRESS<N>`
（H1=8n−1、shortcut あり）です。
BulletOu の baseline 1536/15/32 モデルもこの経路で読み込みます。
BulletOu の短いヘッダーは方式名を保存しないため、配布元の architecture 名から
k3k3 または単独 progressN であることを確認してください。

NN16（16bit 重み）、YO形式の PSQT、common+shard、shortcut なし、hand 系、
k3k3×progressN 等の複合 routing は未対応です。形状を省略した非 baseline の BulletOu export も、
誤った評価器として読まないよう拒否します。ヘッダー・hash・圧縮値・padding・末尾の
不整合はロード時にエラーになります。

## tatara の Threat / PSQT

universal edition は LayerStacks の標準 Threat（profile 0）と PSQT を扱えます。
追加の edition 切替は不要で、通常と同じ方式・係数設定でインポートします。
symdedup 等の非0 ThreatProfile は core が未対応のため拒否します。
Threat と PSQT の同時指定は現在の tatara trainer が拒否するため、個別の対応です。

## プリセットでのセット配布

NNUE と係数ファイルを通常の配布先に置き、manifest のプリセットに
`layerStacks` と `progressCoefficients` を追加します。下記は該当フィールドの例です。
サイズと SHA-256 は配布ファイルの実値へ置き換えてください。

```json
{
  "presetKey": "layerstacks-progress",
  "recommendedFvScale": 28,
  "layerStacks": {
    "bucketMode": "progresskpabs",
    "progressBuckets": 8
  },
  "progressCoefficients": {
    "url": "https://example.com/nnue/files/progress-v1.bin",
    "size": 1003104,
    "sha256": "<係数ファイルのSHA-256>"
  }
}
```

既存の `url` / `size` / `sha256` は NNUE 本体の値です。
両ファイルのサイズ・ハッシュを検証してからセットを保存します。
KingRank9 は `"layerStacks": { "bucketMode": "kingrank9" }` のみ指定します。
YaneuraOu / BulletOu progress8 は上の例の `bucketMode` を `progresskpabsq16` にし、
その checkpoint の `progress.bin` を係数として配布します。
配布ファイルはキャッシュされるため、変更時には新しい URL を使用してください。
Web の `/nnue/files/` は係数 `.bin` も配信できます。追加の配信 API は不要です。

## 実モデルによる確認

WASM をビルドした後、`packages/engine-wasm` で以下を実行すると、
実際の単一スレッド WASM でフォーマット検出・ロード・初期局面から深さ2の探索を行います。

```sh
node scripts/smoke-nnue.mjs /path/to/kingrank9.bin kingrank9
node scripts/smoke-nnue.mjs /path/to/progress.bin progresskpabs 8 /path/to/coeff.bin
node scripts/smoke-nnue.mjs /path/to/halfkp.bin
node scripts/smoke-nnue.mjs /path/to/yaneuraou-nn.bin kingrank9
node scripts/smoke-nnue.mjs /path/to/yo-progress-nn.bin progresskpabsq16 8 /path/to/progress.bin
```

Rust の両ワークスペースには外部モデルを使う ignored test もあります。
`NNUE_TEST_FILE`、必要なら `NNUE_TEST_ROUTING`（例:
`{"bucketMode":"progresskpabs","progressBuckets":8}`）と `NNUE_TEST_PROGRESS_FILE`
を設定し、`cargo test real_model_load_and_search -- --ignored --nocapture` で実行します。
