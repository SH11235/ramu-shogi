# Coding Guidelines
- Prefer functional style over classes in TypeScript/JavaScript; use factory functions that close over state instead of `class`.
- Keep API signatures aligned with backend implementations; do not invoke non-existent IPC/commands.
- Use structured JSON for engine events (`info`/`bestmove`/`error`) instead of raw strings.

## Architecture

レイヤー構成: UI層 → アプリケーション層 → ドメイン層 / インフラ層。
パッケージ間の実際の依存は各 `package.json` を見る。

設計制約:
- app-core / engine-client / match-protocol / design-system / api-contract は他のパッケージに依存しない（app-core は純粋なドメインロジック、engine-client はインターフェース定義のみ）
- app-controller は app-core と engine-client にだけ依存する
- engine-wasm / engine-tauri は engine-client インターフェースの具体的な実装
- study-client は api-contract を型だけで使う（`import type`）
- 循環依存禁止、単方向の依存フロー必須

## Package roles
- app-core: 局面/棋譜処理、NNUE管理
- app-controller: エンジン制御、状態管理、ライフサイクル管理。app-coreとengine-clientを橋渡し
- engine-client: EngineClientインターフェース定義、エラー処理、設定正規化
- engine-wasm: WASMエンジン実装（Worker経由、wasm-bindgen出力を隠蔽）
- engine-tauri: Tauri IPCエンジン実装（invoke/listen）
- rust-core: Rustエンジン本体（探索、評価関数、USIプロトコル）
- ui: 共通UIコンポーネント、design-system前提、必要なものだけ昇格
- match-client: WebSocket ルームクライアント、rshogi の CSA 中継（棋譜・ライブ観戦）のクライアント
- match-protocol: ルーム通信のプロトコル型定義
- study-client: 研究ノートのローカル保存（IndexedDB）、サーバーとの同期、API クライアント。ブラウザ API（IndexedDB / Web Locks / BroadcastChannel / fetch）に依存する層。型と純粋ロジックは app-core の `study/`
- design-system: テーマ/トークン/Provider、shadcn/ui基盤

## 実装方針メモ
- Web と Desktop は極力足並みを揃え、同じ UI/ロジックを共有する。独自実装の分岐は最小限にする。
- React Compiler が有効なため、`useMemo`/`useCallback`/`React.memo` の手動最適化は不要。
- エフェクト内のスタールクロージャ問題は `useEffectEvent`（React 19.2 stable）で解決する。

## UI-Specific Notes
- Desktop (Tauri) UI rules: see `apps/desktop/AGENTS.md` (StrictMode impact, engine client handling).
- Web (Wasm) UI rules: see `apps/web/AGENTS.md` (StrictMode impact, engine client handling).

## スタイリングルール

- 色はハードコード（`#ffffff`, `text-[#3a2a16]` 等）せず、デザインシステムの CSS 変数を使用する
  - 一般的な色: `bg-background`, `text-foreground`, `border-border` 等
  - 和風配色: `text-wafuu-sumi`, `bg-wafuu-shu`, `bg-wafuu-ai` 等
  - 将棋盤: `bg-shogi-cell-light`, `text-shogi-coord-text`, `border-shogi-border` 等
- 新しい色が必要な場合は `packages/design-system/src/theme.css` と `tailwind.preset.ts` に追加する
- 画面全体に重なる層・モーダルの幕・影には、デザインシステムの名前付きトークンを使う（`z-modal`, `bg-overlay`, `shadow-panel` 等）
  - 影は、浮く面（欄・通知・ダイアログ・ポップオーバー）が名前付きトークン、ページ内の面とボタンなどの部品は `shadow-sm` / `shadow-md` まで。任意値（`shadow-[…]` `rounded-[…]` `z-[…]`）は `pnpm check:design-tokens` が拒否する
  - z-index・影の名前付きトークンを追加したら、`packages/design-system/src/lib/cn.ts` にも登録する
- 見た目を維持するリファクタリングでは、同じ環境で変更前に `pnpm --filter web test:visual:update`、変更後に `pnpm --filter web test:visual` を実行する

## テストファイルの配置

- テストファイルはソースファイルと同じディレクトリに `*.test.ts` または `*.test.tsx` として配置する
- `__tests__/` ディレクトリは使用しない
- 例: `hooks/useEngineManager.ts` → `hooks/useEngineManager.test.ts`

## モジュールエクスポートルール

- サブディレクトリに `index.ts` を作成してはいけない
- パッケージルート `index.ts` では `export *` を使わず、明示的な export のみ使用
- 型は `export type { ... }` で明示

## Git操作に関する注意

**重要**: ユーザーの明示的な指示なしに、以下の操作を行ってはいけない:
- `git checkout` や `git restore` でファイルの変更を元に戻す
- `git reset` でコミットを取り消す
- その他、ユーザーの作業を勝手に変更・削除する操作

ユーザーは別セッションで並行作業している可能性があるため、ビルドエラーやテスト失敗が発生しても、勝手にコードをリセットせず、まずユーザーに確認すること。

ユーザーへの返答は日本語で行う事
