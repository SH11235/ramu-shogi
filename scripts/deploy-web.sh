#!/usr/bin/env bash
set -euo pipefail

MODE=${1:-}

if [[ "$MODE" != "stg" && "$MODE" != "prod" ]]; then
  echo "Usage: $0 <stg|prod>" >&2
  exit 1
fi

REPO_ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
cd "$REPO_ROOT"

RUST_LOCKFILE="packages/rust-core/Cargo.lock"
RUST_CARGO_CONFIG="packages/rust-core/.cargo/config.toml"

# 開発用の .cargo/config.toml (gitignore 対象) が rshogi-core をローカル checkout へ
# [patch.crates-io] で差し替えていると、Cargo.lock の版ではなく手元の rshogi の作業状態が
# そのまま配信される。意図して使う場合だけ ALLOW_LOCAL_RSHOGI=1 で許可する。
if [[ -f "$RUST_CARGO_CONFIG" ]] && grep -q '^\[patch' "$RUST_CARGO_CONFIG"; then
  if [[ "${ALLOW_LOCAL_RSHOGI:-}" != "1" ]]; then
    echo "$RUST_CARGO_CONFIG に [patch] があり、rshogi-core がローカルの checkout に差し替わります。" >&2
    echo "Cargo.lock の版で deploy するには [patch] を外してください (意図して使う場合は ALLOW_LOCAL_RSHOGI=1)。" >&2
    exit 1
  fi
  echo "WARNING: ALLOW_LOCAL_RSHOGI=1 のため、ローカルの rshogi checkout でビルドします。" >&2
fi

sha256_of() {
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$1" | cut -d' ' -f1
  else
    shasum -a 256 "$1" | cut -d' ' -f1
  fi
}

lockfile_hash_before=$(sha256_of "$RUST_LOCKFILE")

# Vite 共通 env
export VITE_BASE_PATH="/"
# X-Client header 用のクライアント種識別子 (rshogi#564)。stg / prod で同値。
# 未設定でも build 自体は通るが、viewer API のログで client_kind=unknown 扱いになるため明示しておく。
export VITE_CLIENT_KIND="ramu-shogi-web"

# stg / prod で分岐: NNUE manifest URL も viewer API base URL も環境別に設定する。
if [[ "$MODE" == "stg" ]]; then
  SITE_URL="https://stg.ramu-shogi.sh11235.com"
  export VITE_NNUE_MANIFEST_URL="https://stg.ramu-shogi.sh11235.com/nnue/manifest.json"
  export VITE_RSHOGI_API_BASE="https://stg.rshogi-csa-server.sh11235.com/api/v1"
else
  SITE_URL="https://ramu-shogi.sh11235.com"
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

# ビルド中に cargo が lockfile を書き換えた場合 (依存の解決し直しやローカル差し替え)、
# 配信物は commit 済みの依存と一致しない。
if [[ "$(sha256_of "$RUST_LOCKFILE")" != "$lockfile_hash_before" ]]; then
  echo "ビルド中に $RUST_LOCKFILE が変更されました。commit 済みの依存と異なるため deploy を中止します。" >&2
  exit 1
fi

# 4. デプロイ (wrangler は apps/web の devDependency の版を使う)
if [[ "$MODE" == "stg" ]]; then
  (cd apps/web && pnpm exec wrangler deploy --env stg)
else
  (cd apps/web && pnpm exec wrangler deploy)
fi

# 5. 配信確認: トップページと、ビルドした全 WASM (single / threaded) が配信されていること
status=$(curl -s -o /dev/null -w '%{http_code}' -A 'Mozilla/5.0' "$SITE_URL/")
if [[ "$status" != "200" ]]; then
  echo "$SITE_URL/ が HTTP $status を返しました。" >&2
  exit 1
fi

shopt -s nullglob
wasm_files=(apps/web/dist/assets/*.wasm)
if [[ ${#wasm_files[@]} -eq 0 ]]; then
  echo "apps/web/dist/assets に WASM がありません。" >&2
  exit 1
fi

served=$(mktemp)
trap 'rm -f "$served"' EXIT
for f in "${wasm_files[@]}"; do
  url="$SITE_URL/assets/$(basename "$f")"
  # custom domain への反映直後は古い版が返る場合があるため、数回まで待つ。
  matched=0
  for _ in 1 2 3 4 5 6; do
    if curl -sf -A 'Mozilla/5.0' -o "$served" "$url" && [[ "$(sha256_of "$served")" == "$(sha256_of "$f")" ]]; then
      matched=1
      break
    fi
    sleep 10
  done
  if [[ "$matched" != "1" ]]; then
    echo "$url の内容がビルドした WASM と一致しません。" >&2
    exit 1
  fi
  echo "verified: $url"
done
