# @shogi/design-system

テーマのトークン（`src/theme.css`）と、それを Tailwind のクラスにする preset（`tailwind.preset.ts`）。

## 色の使い分け

色は、部品の**役割**から選ぶ。機能ごとに色を作らない。

### ボタン

`@shogi/ui` の `Button` の種類で決める。

| 役割 | 種類 | 例 |
|---|---|---|
| 主の操作（1 画面に 1 つ） | `default`（`primary` の塗り） | 研究ノートの「全体を解析」、確認の画面の決定 |
| 別の種類の操作 | `secondary`（淡い地） | ページを移る・ノートに手を足すなど、並んだ操作と性質が違うもの |
| ふつうの操作 | `outline`（枠だけ） | コピー、ファイルに保存 |
| 控えめな操作 | `ghost`（枠もなし） | 表示の切り替え |
| 消す操作 | `destructive` | 削除など、元に戻せないもの |

### 和の色

`wafuu-shu`（朱）・`wafuu-ai`（藍）・`wafuu-kin`（金）は、盤と対局の意味に使う。

- 朱は先手、藍は後手。
- 金は盤の最終手・選んでいるもの。

ボタンの役割の色には使わない（「後手の操作」「選んでいるもの」と読めてしまう）。

### 中立の色

面・枠は `background`・`card`・`muted`・`secondary`・`border` を使う。`muted`・`secondary`・`border`・`input` は和紙の系統（`wafuu-washi`・`wafuu-washi-warm`・`wafuu-border`）の値を指す。同じ役割に別の系統の色を持ち込まない。
