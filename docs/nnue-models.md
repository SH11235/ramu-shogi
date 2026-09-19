# NNUE モデルの読み込み

Web と Desktop は rshogi-core 0.7.0 の `edition-universal` を使います。
NNUE の特徴量・次元・拡張はモデルヘッダーから読み取ります。
Web は crates.io 版、Desktop は CSA クライアントと同じ rshogi v1.5.0 の
Git revision を参照しています。Desktop の core と CSA クライアントの revision は
同時に更新してください。

## LayerStacks の設定

評価関数ファイル管理で NNUE をインポートし、作者が指定する FV_SCALE と
LayerStacks の振り分け方式を設定してください。登録済みモデルの設定も変更できます。
ヘッダーの形式や格納バケット数だけから学習時の振り分け方式は推測できません。

- **KingRank9**: 玉の位置に応じた9バケット。進行度係数は不要です。
- **progresskpabs**: 学習時の進行度バケット数（1〜16、モデルの格納数以下）と、
  学習時に使った進行度係数ファイルを指定します。バケット数1だけは係数不要です。
  旧形式の格納9バケットを `floor(p × 8)` で学習したモデルでは8を指定します。

進行度係数は **1,003,104 bytes**（81 × 1548 個の little-endian f64）のファイルです。
アプリはサイズと有限値を検証し、モデルのメタデータとともにローカル保存します。
モデルを選び直す場合や Web Worker が再起動した場合も、同じ設定が使われます。
HalfKP / HalfKA 系では LayerStacks の設定を指定しません。
ロード済みモデルの設定を変更した場合、Web はページを再読み込みし、
Desktop はアプリを終了して再起動してください。

## YaneuraOu SFNN

通常の 8bit `SFNNWithoutPsqt`（version `0x7AF32F16`）を直接インポートできます。
ロード時に rshogi の LayerStacks 形式へ変換し、整数重みは変更しません。
モデル設定は **KingRank9** を選択し、通常の SFNN では **FV_SCALE=28** を指定します。

対応する特徴量は HalfKP、HalfKA1、HalfKA2、HalfKA_hm1、HalfKA_hm2 です。
対応ヘッダーは HalfKA_hm2 の `SFNN-1536` / `SFNN-1536-V2`、または形状が明記された
`SFNN_<feature>_<FT>_<H1>_<H2>_K3K3`（H1=8n−1、shortcut あり）です。
BulletOu の baseline 1536/15/32 モデルもこの経路で読み込みます。

NN16（16bit 重み）、PSQT、common+shard、shortcut なし、KingRank9 以外の
YaneuraOu bucket 構成は未対応です。形状を省略した非 baseline の BulletOu export も、
誤った評価器として読まないよう拒否します。ヘッダー・hash・圧縮値・padding・末尾の
不整合はロード時にエラーになります。

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
```

Rust の両ワークスペースには外部モデルを使う ignored test もあります。
`NNUE_TEST_FILE`、必要なら `NNUE_TEST_ROUTING`（例:
`{"bucketMode":"progresskpabs","progressBuckets":8}`）と `NNUE_TEST_PROGRESS_FILE`
を設定し、`cargo test real_model_load_and_search -- --ignored --nocapture` で実行します。
