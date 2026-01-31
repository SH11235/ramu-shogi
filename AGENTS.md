# Coding Guidelines
- Prefer functional style over classes in TypeScript/JavaScript; use factory functions that close over state instead of `class`.
- Keep API signatures aligned with backend implementations; do not invoke non-existent IPC/commands.
- Use structured JSON for engine events (`info`/`bestmove`/`error`) instead of raw strings.

## Architecture

本プロジェクトは、明確なレイヤー分離に基づいたアーキテクチャを採用しています：

```
┌─────────────────────────────────────┐
│  UI層 (apps/*, packages/ui)         │
├─────────────────────────────────────┤
│  アプリケーション層                    │
│  (packages/app-controller)          │
├─────────────────────────────────────┤
│  ドメイン層 (packages/app-core)      │
├─────────────────────────────────────┤
│  インフラ層                           │
│  (packages/engine-client,           │
│   packages/engine-wasm,             │
│   packages/engine-tauri)            │
└─────────────────────────────────────┘
```

### Package Dependency Graph

具体的なパッケージ間の依存関係（`→` は依存の方向）：

```
【アプリケーション層】
apps/web ──┬──→ ui ──────────┬──→ app-controller ──┬──→ app-core (依存なし)
           │                 │                      └──→ engine-client
           ├──→ design-system│
           ├──→ app-controller
           └──→ engine-wasm ──→ engine-client
                             └──→ rust-core

apps/desktop ┬──→ ui
             ├──→ design-system
             ├──→ app-controller
             └──→ engine-tauri ──→ engine-client

【重要な設計原則】
✓ app-core: 完全に依存なし（純粋なドメインロジック）
✓ app-controller: app-core と engine-client のみに依存
  - エンジン制御の状態管理とライフサイクル管理を担当
  - ドメインロジックとインフラ層を橋渡し
✓ engine-client: インターフェース定義のみ（依存なし）
✓ engine-wasm/engine-tauri: engine-client の具体的な実装
✓ ui: app-controller を使用してエンジン機能を利用
✓ 循環依存なし、単方向の依存フロー
```

## Package roles (packages/*)

### ドメイン層
- `app-core`: ドメインロジック（局面/棋譜処理、NNUEなど）。**依存なし**。UI・エンジン実装から独立。

### アプリケーション層
- `app-controller`: エンジン制御、状態管理。`app-core`と`engine-client`に依存。

### インフラ層
- `engine-client`: EngineClient インターフェース定義とユーティリティ。
- `engine-wasm`: Web/Wasm エンジン実装（Worker 経由、wasm-bindgen 出力を隠蔽）。
- `engine-tauri`: Tauri IPC エンジン実装（invoke/listen）。実エンジン接続はここ経由。
- `rust-core`: Rust エンジン本体（engine-core/engine-usi 等）。

### UI層
- `design-system`: テーマ/トークン/Provider。shadcn/ui に依存する下地。
- `ui`: 共通 UI コンポーネント（デザインシステム前提）。必要になったものだけ昇格する。

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

## Git操作に関する注意

**重要**: ユーザーの明示的な指示なしに、以下の操作を行ってはいけない:
- `git checkout` や `git restore` でファイルの変更を元に戻す
- `git reset` でコミットを取り消す
- その他、ユーザーの作業を勝手に変更・削除する操作

ユーザーは別セッションで並行作業している可能性があるため、ビルドエラーやテスト失敗が発生しても、勝手にコードをリセットせず、まずユーザーに確認すること。

ユーザーへの返答は日本語で行う事
