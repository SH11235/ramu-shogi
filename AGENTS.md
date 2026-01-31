# Coding Guidelines
- Prefer functional style over classes in TypeScript/JavaScript; use factory functions that close over state instead of `class`.
- Keep API signatures aligned with backend implementations; do not invoke non-existent IPC/commands.
- Use structured JSON for engine events (`info`/`bestmove`/`error`) instead of raw strings.

## Architecture

レイヤー構成: UI層 → アプリケーション層 → ドメイン層 / インフラ層

パッケージ依存関係（`→` は依存方向）:
- apps/web → ui, design-system, app-controller, engine-wasm
- apps/desktop → ui, design-system, app-controller, engine-tauri
- ui → app-core, app-controller, design-system, engine-client
- app-controller → app-core, engine-client
- app-core → (依存なし)
- engine-wasm → engine-client, rust-core
- engine-tauri → engine-client
- engine-client → (依存なし、インターフェース定義のみ)
- design-system → (依存なし)

設計制約:
- app-core: 完全に依存なし（純粋なドメインロジック）
- app-controller: app-coreとengine-clientのみに依存、エンジン制御の状態管理とライフサイクル管理を担当
- engine-wasm/engine-tauri: engine-clientインターフェースの具体的な実装
- 循環依存禁止、単方向の依存フロー必須

## Package roles
- app-core: 局面/棋譜処理、NNUE管理。UI・エンジン実装から完全独立、依存なし
- app-controller: エンジン制御、状態管理、ライフサイクル管理。app-coreとengine-clientを橋渡し
- engine-client: EngineClientインターフェース定義、エラー処理、設定正規化
- engine-wasm: WASMエンジン実装（Worker経由、wasm-bindgen出力を隠蔽）
- engine-tauri: Tauri IPCエンジン実装（invoke/listen）
- rust-core: Rustエンジン本体（探索、評価関数、USIプロトコル）
- ui: 共通UIコンポーネント、design-system前提、必要なものだけ昇格
- design-system: テーマ/トークン/Provider、shadcn/ui基盤

## 実装方針メモ
- Web と Desktop は極力足並みを揃え、同じ UI/ロジックを共有する。独自実装の分岐は最小限にする。

## UI-Specific Notes
- Desktop (Tauri) UI rules: see `apps/desktop/AGENTS.md` (StrictMode impact, engine client handling).
- Web (Wasm) UI rules: see `apps/web/AGENTS.md` (StrictMode impact, engine client handling).

## スタイリングルール

- 色はハードコード（`#ffffff`, `text-[#3a2a16]` 等）せず、デザインシステムの CSS 変数を使用する
  - 一般的な色: `bg-background`, `text-foreground`, `border-border` 等
  - 和風配色: `text-wafuu-sumi`, `bg-wafuu-shu`, `bg-wafuu-ai` 等
  - 将棋盤: `text-shogi-piece-text`, `bg-shogi-piece-bg`, `border-shogi-outer-border` 等
- 新しい色が必要な場合は `packages/design-system/src/theme.css` と `tailwind.preset.ts` に追加する

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
