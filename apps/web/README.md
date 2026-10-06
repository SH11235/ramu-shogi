# React + TypeScript + Vite

This template provides a minimal setup to get React working in Vite with HMR and some ESLint rules.

Currently, two official plugins are available:

- [@vitejs/plugin-react](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react) uses [Babel](https://babeljs.io/) (or [oxc](https://oxc.rs) when used in [rolldown-vite](https://vite.dev/guide/rolldown)) for Fast Refresh
- [@vitejs/plugin-react-swc](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react-swc) uses [SWC](https://swc.rs/) for Fast Refresh

## React Compiler

The React Compiler is not enabled on this template because of its impact on dev & build performances. To add it, see [this documentation](https://react.dev/learn/react-compiler/installation).

## Expanding the ESLint configuration

If you are developing a production application, we recommend updating the configuration to enable type-aware lint rules:

```js
export default defineConfig([
  globalIgnores(['dist']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      // Other configs...

      // Remove tseslint.configs.recommended and replace with this
      tseslint.configs.recommendedTypeChecked,
      // Alternatively, use this for stricter rules
      tseslint.configs.strictTypeChecked,
      // Optionally, add this for stylistic rules
      tseslint.configs.stylisticTypeChecked,

      // Other configs...
    ],
    languageOptions: {
      parserOptions: {
        project: ['./tsconfig.node.json', './tsconfig.app.json'],
        tsconfigRootDir: import.meta.dirname,
      },
      // other options...
    },
  },
])
```

You can also install [eslint-plugin-react-x](https://github.com/Rel1cx/eslint-react/tree/main/packages/plugins/eslint-plugin-react-x) and [eslint-plugin-react-dom](https://github.com/Rel1cx/eslint-react/tree/main/packages/plugins/eslint-plugin-react-dom) for React-specific lint rules:

```js
// eslint.config.js
import reactX from 'eslint-plugin-react-x'
import reactDom from 'eslint-plugin-react-dom'

export default defineConfig([
  globalIgnores(['dist']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      // Other configs...
      // Enable lint rules for React
      reactX.configs['recommended-typescript'],
      // Enable lint rules for React DOM
      reactDom.configs.recommended,
    ],
    languageOptions: {
      parserOptions: {
        project: ['./tsconfig.node.json', './tsconfig.app.json'],
        tsconfigRootDir: import.meta.dirname,
      },
      // other options...
    },
  },
])
```

## オンライン対局のローカル起動と E2E テスト

ルーム API（`/api/rooms/*`）の処理先は `wrangler.toml` の `ROOM_BACKEND` で切り替わる。

- `legacy`: この Worker（`worker/`）の RoomDO
- `backend`: backend Worker（ramu-shogi-backend）の RoomDO

### frontend / backend の両 Worker を起動する

前提:

- ramu-shogi-backend を clone し、その checkout で `pnpm install` を済ませておく
- この repo で `pnpm build` を実行したあと、Worker から配信できる base path で `apps/web/dist` を作り直す

```bash
pnpm build
VITE_BASE_PATH=/ VITE_NNUE_MANIFEST_URL=/nnue/manifest.json pnpm --filter web build
```

起動:

```bash
# backend の RoomDO で処理する（既定）
pnpm --filter web dev:workers

# この Worker の RoomDO で処理する
ROOM_BACKEND=legacy pnpm --filter web dev:workers
```

| 環境変数 | 既定値 | 内容 |
| --- | --- | --- |
| `BACKEND_DIR` | `../ramu-shogi-backend`（この repo の隣） | backend の checkout |
| `ROOM_BACKEND` | `backend` | ルーム API の処理先（`backend` / `legacy`） |
| `PORT` | `8787` | 待ち受けポート |

- `wrangler.toml` は書き換えず、`ROOM_BACKEND` は起動時の `--var` で渡す。
- backend の checkout には書き込まない。backend 用の wrangler 設定、`.dev.vars`（backend の `.dev.vars`、無ければ `.dev.vars.example` を複製）、ローカルの D1 / Durable Object の状態は `apps/web/.wrangler/room-dev/<PORT>/`（git 管理外）に置く。状態を消したいときはこのディレクトリを削除する。
- wrangler はこの repo のものを使う。backend が要求する `compatibility_date` のほうが新しいと、起動時に警告が出て古い日付で動く。
- ローカルではログインできない（backend のログインは別サービスに依存する）。対局はゲスト同士になり、棋譜は保存されない。

### 2 ブラウザの E2E テスト

`src/pages/online/online-game.room.e2e.ts` は、先手・後手（と観戦者）を別々のブラウザで開き、参加から終局まで操作する。起動済みの環境に対して実行し、既定の `pnpm --filter web test:e2e` には含まれない。

```bash
pnpm --filter web exec playwright install chromium   # 初回のみ

# 上の手順で起動したローカル環境（起動時の ROOM_BACKEND と同じ値を渡す）
E2E_ROOM_BACKEND=backend pnpm --filter web test:e2e:rooms
E2E_ROOM_BACKEND=legacy pnpm --filter web test:e2e:rooms

# デプロイ済みの環境
E2E_BASE_URL=https://stg.example.com E2E_ROOM_BACKEND=legacy E2E_DEV_LOGIN=true \
    pnpm --filter web test:e2e:rooms
```

| 環境変数 | 既定値 | 内容 |
| --- | --- | --- |
| `E2E_ROOM_BACKEND` | （必須） | 対象環境でルーム API を処理している側（`backend` / `legacy`） |
| `E2E_BASE_URL` | `http://localhost:8787` | 対象環境の URL |
| `E2E_DEV_LOGIN` | 未設定 | `true` にすると `/api/auth/dev-login` でログインしてから対局し、終局後に棋譜の検討画面へ進めることも確かめる。dev-login が有効な環境でだけ使う |

ルーム作成のレート制限（IP ごとに 60 秒 10 回）に掛かったときは、枠が空くまで待ってやり直す。

処理先によって挙動が違うシナリオは、テストの中にそれぞれの期待値を書いてある。「待機中に開始局面を変更した側も、変更後の局面で対局が始まる」は、どちらの処理先でも変更した側の盤面が変更前のまま始まるため、`test.fail` で失敗を期待値にしている。

| シナリオ | `backend` | `legacy` |
| --- | --- | --- |
| 待機中に開始局面を SFEN 直接入力へ変更 | 入力し終えた局面で対局が始まる | 入力途中の SFEN がエラーになって待機中の接続が切れ、変更した側は待機画面に残る |
| 終局後の再読み込み | 結果ダイアログと「棋譜を検討する」が復元される | 盤面だけが表示され、結果は出ない |
| 同じ席を 2 つ目のタブで開く | 操作権が後から開いたタブへ移り、先のタブには案内が出る | どちらのタブからも指せる |
