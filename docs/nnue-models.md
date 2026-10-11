# NNUE モデルの読み込み

評価関数ファイル管理で NNUE をインポートして使います。
特徴量・次元・拡張はモデルヘッダーから自動判定されます。

## 配布 AI

Web と Desktop の AI 選択では、共通の配布 manifest から次のモデルを選べます。

| AI | モデル | FV_SCALE | LayerStacks 設定 |
| --- | --- | --- | --- |
| COCO | HalfKP 256x2-32-32 | 14 | 不要 |
| RAMU | LayerStacks 1536x16x32（2026年6月版） | 24 | progresskpabs、9バケット、配布された進行度係数 |

COCO は軽さを重視し、スマートフォンや気軽な対局におすすめです。
RAMU は棋力を重視し、実戦や検討におすすめです。処理性能とメモリに余裕のある環境でお使いください。

プリセットの `usageLabel` と `description` を AI 選択画面の案内に使います。
アーキテクチャ名と層の次元は `format.architecture` と `format.l1Dimension` / `l2Dimension` / `l3Dimension` に保持し、
評価関数ファイル管理にも表示します。ダウンロード後のモデルメタデータにも `format` を保存します。

RAMU のダウンロードでは進行度係数も取得し、モデルとともにサイズ・SHA-256 を検証して保存します。
既存の `ramu` プリセットを更新すると RAMU に切り替わります。

配布一覧の正本は `apps/web/nnue/manifest.json` です。
モデルと係数は R2 の `shogi-nnue` バケットに置き、最後にこの manifest を `manifest.json` として反映します。
モデルを変更する場合はキャッシュとの混同を避けるためファイル名と URL を変更してください。
NNUE 本体のバイナリは Git へ追加しません。

プリセットの `iconUrl` に画像の URL を指定すると、その AI を選んだ側のアイコンに使われます。
COCO はココの写真、RAMU と画像未設定の AI は従来のラム画像を使います。
画像も `/nnue/files/` で配信でき、変更する場合は新しいファイル名を使ってください。

Web の WASM、Desktop の core と CSA クライアントは同じ rshogi Git revision を参照します。
更新時は `packages/rust-core/crates/engine-wasm/Cargo.toml` と
`apps/desktop/src-tauri/Cargo.toml` の3つの依存、および両 `Cargo.lock` を揃えてください。

## LayerStacks の設定

LayerStacks 系のモデルは、モデル作者が指定する FV_SCALE と振り分け方式（バケット方式）を
インポート時に設定してください。登録済みモデルの設定も後から変更できます。
ヘッダーの形式や格納バケット数だけでは、学習時の振り分け方式は判別できません。

- **KingRank9 / k3k3**: 両玉の段を3区分ずつに分けた9バケット。
  rshogi の KingRank9 と YaneuraOu の k3k3 は同じ方式です。進行度係数は不要です。
- **progresskpabs（tatara / rshogi）**: 学習時の進行度バケット数（1〜16、モデルの格納数以下）と、
  学習時に使った進行度係数ファイルを指定します。バケット数1だけは係数不要です。
  旧形式の格納9バケットを `floor(p × 8)` で学習したモデルでは8を指定します。
- **progressN Q16（YaneuraOu / BulletOu）**: 単独 progress2 / progress4 / progress8 /
  progress16 のモデルと、同じ checkpoint の `progress.bin` を指定します。

境界付近の振り分けを学習時と揃えるため、モデルの配布元に対応する方式を選択してください。

進行度係数ファイルは 1,003,104 bytes（81 × 1548 個の little-endian f64）です。
サイズと値を検証したうえでモデルとともに端末内に保存され、再起動後も同じ設定が使われます。
HalfKP / HalfKA 系では LayerStacks の設定は不要です。
ロード済みモデルの設定を変更した場合、Web はページを再読み込みし、
Desktop はアプリを再起動してください。

## YaneuraOu SFNN

通常の 8bit `SFNNWithoutPsqt`（version `0x7AF32F16`）を直接インポートできます。
モデル設定は k3k3 なら **KingRank9**、単独 progressN なら **progressN Q16** を選択し、
通常の SFNN では **FV_SCALE=28** を指定します。

対応する特徴量は HalfKP、HalfKA1、HalfKA2、HalfKA_hm1、HalfKA_hm2 です。
対応ヘッダーは HalfKA_hm2 の `SFNN-1536` / `SFNN-1536-V2`、または形状が明記された
`SFNN_<feature>_<FT>_<H1>_<H2>_K3K3` / `..._PROGRESS<N>`（H1=8n−1、shortcut あり）です。
BulletOu の baseline 1536/15/32 モデルも読み込めます。
BulletOu の短いヘッダーは方式名を保存しないため、配布元の architecture 名から
k3k3 か単独 progressN かを確認してください。

未対応: NN16（16bit 重み）、YO形式の PSQT、common+shard、shortcut なし、hand 系、
k3k3×progressN 等の複合 routing。形状を省略した非 baseline の BulletOu export も拒否されます。
ヘッダーや内容に不整合があるファイルはロード時にエラーになります。

## tatara の Threat / PSQT

LayerStacks の標準 Threat（profile 0）と PSQT を読み込めます。
通常のモデルと同じ方式・係数設定でインポートしてください。
symdedup 等の非0 ThreatProfile は未対応です。
