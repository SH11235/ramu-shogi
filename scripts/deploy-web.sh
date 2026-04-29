#!/usr/bin/env bash
set -euo pipefail

MODE=${1:-}

if [[ "$MODE" != "stg" && "$MODE" != "prod" ]]; then
  echo "Usage: $0 <stg|prod>" >&2
  exit 1
fi

# Vite 共通 env
export VITE_BASE_PATH="/"
# X-Client header 用のクライアント種識別子 (rshogi#564)。stg / prod で同値。
# 未設定でも build 自体は通るが、viewer API のログで client_kind=unknown 扱いになるため明示しておく。
export VITE_CLIENT_KIND="ramu-shogi-web"

# stg / prod で分岐: NNUE manifest URL も viewer API base URL も環境別に設定する。
if [[ "$MODE" == "stg" ]]; then
  export VITE_NNUE_MANIFEST_URL="https://stg.ramu-shogi.sh11235.com/nnue/manifest.json"
  export VITE_RSHOGI_API_BASE="https://stg.rshogi-csa-server.sh11235.com/api/v1"
else
  export VITE_NNUE_MANIFEST_URL="https://ramu-shogi.sh11235.com/nnue/manifest.json"
  export VITE_RSHOGI_API_BASE="https://rshogi-csa-server.sh11235.com/api/v1"
fi

# defense-in-depth: 空チェック (export 後でも 0 文字なら fail)
for v in VITE_BASE_PATH VITE_NNUE_MANIFEST_URL VITE_RSHOGI_API_BASE; do
  if [[ -z "${!v:-}" ]]; then
    echo "$v is required" >&2
    exit 1
  fi
done

# 1. engine-wasm 以外の web 依存パッケージをビルド
pnpm --filter "web^..." --filter '!@shogi/engine-wasm' build

# 2. WASM production ビルド（WASM + TypeScript、1回のみ）
pnpm --filter @shogi/engine-wasm build:production

# 3. Web のみビルド
pnpm --filter web build

# 4. デプロイ
if [[ "$MODE" == "stg" ]]; then
  (cd apps/web && pnpx wrangler deploy --env stg)
else
  (cd apps/web && pnpx wrangler deploy)
fi
