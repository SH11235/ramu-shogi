# ramu-shogi IaC (Pulumi) Runbook

`infra/pulumi/` に置いた Pulumi project で ramu-shogi の Cloudflare 上のリソースを
**段階的に** IaC 管理する運用手順。

[issue #50](https://github.com/SH11235/ramu-shogi/issues/50) Phase 1.5 着地時点では
**R2 bucket 1 件のみ Pulumi 管理** で、Worker script (`ramu-shogi` /
`ramu-shogi-stg`) / Durable Object (`RoomDO`) / Service binding (`BACKEND` →
`ramu-shogi-backend(-stg)`) / Rate limit binding (`ROOM_RATE_LIMITER`) /
R2 binding (`NNUE_BUCKET`) / Assets binding / SPA 設定 / vars / secrets /
migrations は引き続き `apps/web/wrangler.toml` で管理する (理由は §3 参照)。

## 1. アーキテクチャ概要

```
┌──────────── Pulumi Cloud (sh11235 個人 org) ────────────┐
│ project: ramu-shogi                                    │
│   stack: production  ─── R2: shogi-nnue                │
└────────────────────────────────────────────────────────┘
            ▲                                          ▲
            │ pulumi up (R2 のみ)                       │ wrangler deploy
            │                                          │ (Worker / DO / Service binding /
            │                                          │  Rate limit / vars / secrets /
            │                                          │  Assets / SPA / migrations)
            │                                          │
   ┌─────────────────────┐                  ┌─────────────────────┐
   │ infra/pulumi/       │                  │ apps/web/           │
   │   index.ts          │                  │   wrangler.toml     │
   │   Pulumi.production │                  │                     │
   │     .yaml           │                  │                     │
   └─────────────────────┘                  └─────────────────────┘
```

「**R2 = Pulumi**, **Worker / DO / Service binding 関連 = wrangler**」の責務分離を
Phase 1.5 では維持する。Phase 2 以降で WAF / Cloudflare Access / Custom Domain 等の
zone-level resource を Pulumi 配下に追加していくことを想定している (issue #50
follow-up を参照)。

ramu-shogi は **single stack (`production`) のみ**。`apps/web/wrangler.toml` には
`env.stg` (`ramu-shogi-stg`) も定義されているが、**R2 bucket (`shogi-nnue`) は
default + env.stg で共有** されており (= staging 専用 R2 が無い)、stack 分割しても
Pulumi 側で管理する resource 集合が変わらない。stack 分離 / R2 env 分離は別 issue
で扱う (§4.2 参照)。

## 2. 初回セットアップ (新規 operator 向け)

### 2.1 必要なもの

| 区分                    | 要件                                                                           |
| ----------------------- | ------------------------------------------------------------------------------ |
| Pulumi CLI              | v3.237.0+ (`pulumi version` で確認)                                            |
| Pulumi Cloud アカウント | Individual tier で十分 (個人プロジェクト無料)                                  |
| Cloudflare API token    | §2.3 の scope を満たす token                                                   |
| Cloudflare Account ID   | `d5d9818649d8722f73cd798c3b1ffb70` (Cloudflare dashboard 右サイドバーから取得) |
| Node                    | v24.15.0 (`infra/pulumi/.node-version`)                                        |
| pnpm                    | v10.24.0 (`packageManager` で pin)                                             |

### 2.2 Pulumi CLI install + login

```bash
# install (推奨は公式インストーラ、asdf / mise 等でも可)
curl -fsSL https://get.pulumi.com | sh

# Pulumi Cloud にログイン (ブラウザで OAuth)
pulumi login
# → Logged in to pulumi.com as <your-username>

pulumi whoami   # 自分の personal org 名 (SH11235) が表示されればOK
```

### 2.3 Cloudflare API token 発行

https://dash.cloudflare.com/profile/api-tokens → "Create Token" → "Create Custom Token"

Phase 1.5 では Pulumi が R2 のみ管理するため、**最小権限は R2 Storage Edit +
Account Settings Read の 2 行**。D1 や Worker / Service binding 関連
(`Workers Scripts: Edit` 等) は Phase 1.5 では不要 — 将来 Worker を Pulumi 配下に
入れる段階 (issue #50 follow-up 想定) で追加する。

| 項目              | 値                                              |
| ----------------- | ----------------------------------------------- |
| Token name        | `pulumi-ramu-shogi-iac` (任意、用途識別用)      |
| Permissions       | Account → Workers R2 Storage: Edit              |
|                   | Account → Account Settings: Read                |
| Account Resources | Include → Specific account → 自分の個人 account |
| Zone Resources    | 設定不要 (Custom Domain は Phase 1.5 範囲外)    |
| TTL               | 未設定                                          |

→ token 文字列をコピー (1 回しか表示されない)。

> **既存の wrangler 用 `CLOUDFLARE_API_TOKEN` を流用しない**:
> Pulumi は wrangler と異なるリソース集合 (R2 storage) を独占管理する。
> 同じ token を使うと audit log で wrangler / pulumi 由来を識別できず、
> rotation 時の影響範囲も切り分けにくくなる。独立 token を推奨。

> **token 権限拡張時の rotation 契約**: 将来 Worker / DO / Service binding 等を
> Pulumi 配下に追加する PR では、本 §2.3 の Permissions 表を更新 + 既存 token を
> 新 scope で再発行 + `Pulumi.production.yaml` の `cloudflare:apiToken` を再投入の
> **3 点セット** で扱う。表だけ広げて token を rotation し忘れると最小権限原則が
> 崩れるので、PR review で 3 点同期を確認する運用とする。

### 2.4 Pulumi project の deps install

```bash
cd infra/pulumi
corepack enable                 # Node 同梱の corepack で pnpm を有効化
pnpm install --frozen-lockfile  # packageManager フィールドの pnpm@10.24.0 が解決される
```

`infra/pulumi/` には独立した `pnpm-workspace.yaml` (`packages: []`) を置いており、
リポジトリルートの `pnpm-workspace.yaml` (`apps/*` / `packages/*`) には属さない。
これは Pulumi 用の deps (`@pulumi/cloudflare` 等) を ramu-shogi アプリ runtime に
持ち込まず、IaC 用の独立 lockfile を保つための境界。

### 2.5 stack 切替 + config 投入

stack は `production` のみ:

```bash
pulumi stack select production
pulumi config set --secret cloudflare:apiToken '<貼り付け>'
pulumi config set accountId 'd5d9818649d8722f73cd798c3b1ffb70'   # secret ではない
```

> **config namespace に注意**: `@pulumi/cloudflare` v6 では `accountId` は
> provider-level config を持たず、各 resource の引数として受け取る。
> したがって `cloudflare:accountId` ではなく project namespace
> (`ramu-shogi:accountId`、CLI では prefix なしで `accountId`) に置く。
> 誤って `cloudflare:accountId` で set すると "not a valid configuration key
> for the cloudflare provider" エラーになる。

## 3. Phase 1.5 で Worker を Pulumi 配下に入れていない理由

ramu-shogi のフロント Worker は素の TypeScript (worker/index.ts、SPA + API proxy
構成) で、rshogi の WASM Worker が抱える provider bug (UTF-8 marshal 失敗) は
発生しない可能性が高い。それでも Phase 1.5 で Worker を Pulumi 配下に入れない
理由は以下:

- **wrangler との二重管理回避**: `cloudflare.WorkersScript` (または beta な
  `Worker` + `WorkerVersion` + `WorkersDeployment`) で content を declare すると、
  Pulumi 経由で content upload が必須化され、`wrangler deploy` との二重管理
  が発生する。`apps/web/` 側のビルド成果物 (Vite build + Worker bundle) を
  Pulumi pipeline に乗せるには `pulumi.asset.FileAsset` 経由の配線追加が
  必要で、現行の `pnpm run deploy:web` (=`wrangler deploy`) 運用とぶつかる。
- **bindings / DO migrations / Service binding / Rate limit binding の所有権
  が wrangler 側に残る**: R2 binding (`NNUE_BUCKET`)、Durable Object binding
  (`ROOM` → `RoomDO`)、Service binding (`BACKEND` → `ramu-shogi-backend(-stg)`)、
  Rate limit binding (`ROOM_RATE_LIMITER`、`unsafe.bindings`)、Assets binding
  (`ASSETS`、SPA 設定 `not_found_handling`)、`vars`、`migrations` は wrangler.toml
  の宣言に紐づく。Pulumi 側で binding を定義しても wrangler.toml の宣言と
  どちらが source of truth か曖昧になる。特に `migrations` は DO クラスの
  ライフサイクル管理 (`new_sqlite_classes` など) を含み、wrangler 側でしか
  整合的に扱えない。
- **Service binding の cross-repo 整合性**: `BACKEND` は別リポの Worker
  (`ramu-shogi-backend(-stg)`) を参照する。Pulumi 側で binding を declare
  すると、本リポの Pulumi state と他リポの Worker resource が暗黙的に
  結合してしまう。string ベースで wrangler に委ねる方が責務分離が明確。
- **Phase 1.5 のスコープを最小に保つ**: rshogi PR #677 / nnue-lab PR #4 /
  ramu-shogi-backend issue #2 と同じ「IaC 移行は storage layer から段階的に」
  の方針に揃え、まずは destroy リスクの大きい R2 を `protect: true` で守ることに
  集中する。

`WorkersScript` の docstring 上は beta `cloudflare.Worker` +
`cloudflare.WorkerVersion` + `cloudflare.WorkersDeployment` への移行を
推奨しているが、上記の二重管理 / 所有権の問題は Worker resource type が
変わっても変わらない。Phase 1.5 では Worker / DO / Service binding / Rate limit
binding 管理を wrangler に残す決定とした (将来の追加移行は issue #50 follow-up
で再検討)。

## 4. 通常運用フロー

> **対象読者**: 既に bootstrap 済み (Pulumi Cloud project + `production` stack +
> R2 import 済) の状態を引き継ぐ運用者。
> 通常運用では **新規 stack を作らない** / **`pulumi up` で R2 を新規作成しない**
> のが既定 (既存 resource は `protect: true` で守られているため誤 destroy も
> block される)。
> bootstrap が必要な状況 (新規アカウント / 旧 state 喪失 / 別環境追加) は §4.4 参照。

### 4.1 R2 設定の変更 (lifecycle, CORS など追加する場合)

```bash
cd infra/pulumi
pulumi stack select production
# index.ts を編集 (例: cloudflare.R2BucketCors を追加)
pulumi preview              # 差分確認
pulumi up                   # 適用
```

ramu-shogi には独立 staging stack が無いため、preview 段階で diff を慎重に確認する。

### 4.2 wrangler 経由 deploy との関係 / R2 が staging-production で共有される事実

- Worker / DO / Service binding / Rate limit binding / vars / secrets / DO
  migrations の変更は今まで通り `apps/web/wrangler.toml` を編集し、
  `pnpm --filter web run deploy` (default = production) /
  `pnpm --filter web run deploy:stg` 相当のコマンドで反映する。
- R2 binding の `bucket_name` は wrangler.toml にも書かれているが、resource
  自体の作成 / 削除 / 設定は Pulumi 側が source of truth。名前が一致していれば
  binding は wrangler の意図通り張られる。
- bucket 名を変更する場合は **Pulumi 側で新名で作成 → wrangler.toml の名前を
  更新 → wrangler deploy → Pulumi 側で旧 resource を destroy** の順
  (worker 側 binding が消える前に resource を消すと一時的にデータアクセス
  失敗するため)。

#### R2 が staging / production で共有されている事実

`apps/web/wrangler.toml` の default (production) と `env.stg` の双方で
`[[r2_buckets]]` が `bucket_name = "shogi-nnue"` を指している。つまり staging
Worker (`ramu-shogi-stg`) も同じ `shogi-nnue` バケットを読み書きする。

この設計の含意:

- Phase 1.5 の Pulumi 側は bucket を **1 件だけ宣言**する (env 別に複製しても
  実体は同じ resource を 2 回宣言することになり破綻する)。
- staging で R2 bucket の lifecycle / CORS 設定を試したいケースでは、production
  にも同時に影響する。試験用に分離したい場合は env 別 bucket への移行が必要。

#### env 別 R2 bucket に分離したい場合 (別 issue 想定)

例えば `shogi-nnue` (production) / `shogi-nnue-stg` (staging) に分離する場合の
概略手順:

1. Pulumi index.ts に `nnueBucketStaging` (= `shogi-nnue-stg`) を追加宣言
2. `pulumi up` で新 bucket を作成
3. `wrangler r2 object` 等で必要な NNUE モデルを copy
4. `apps/web/wrangler.toml` の `env.stg.r2_buckets[0].bucket_name` を
   `shogi-nnue-stg` に変更 → `wrangler deploy --env stg`
5. (任意) フロントから検証後、staging が production R2 を参照しなくなったことを
   audit log で確認

ただし上記は本 Phase 1.5 のスコープ外。実施時は別 issue で扱う。

### 4.3 secret 値の追加 / rotation

**`ROOM_DO_SECRET` のみ Pulumi ESC 管理 (Phase 2-D 補完 / issue #52)**。
それ以外の Worker secret (将来の `ADMIN_API_TOKEN` 等) は **wrangler 経由のみ**で
管理する:

```bash
cd apps/web
# production
pnpm exec wrangler secret put <SECRET_NAME>
# staging
pnpm exec wrangler secret put <SECRET_NAME> --env stg
```

`ROOM_DO_SECRET` の追加 / rotation 手順は §8 を参照。新規 secret も Pulumi ESC
管理に乗せる場合は §8.1 を踏襲して `secret-sync.yml` の `required_keys` を更新する。

### 4.4 bootstrap (新規 stack / 別環境 / state 復旧)

**通常運用では使わない**。以下の状況でのみ実行:

- 新規 Cloudflare アカウントに本 Pulumi project を移植する
- 既存 Pulumi Cloud stack を消してしまい再作成する必要がある
- production 以外の新環境 (例: staging / pr-preview) を追加する

手順:

```bash
cd infra/pulumi
pulumi stack init <new-stack-name>     # 新環境追加時のみ。既に production がある場合はスキップ
pulumi config set --secret cloudflare:apiToken '<token>'
pulumi config set accountId 'd5d9818649d8722f73cd798c3b1ffb70'

# 既存 R2 bucket を import (Cloudflare 上に既に存在している場合)
# import ID 形式: <account_id>/<bucket_name>/<jurisdiction>
# jurisdiction は "default" / "eu" / "fedramp" のいずれか (新規発行時は "default")
pulumi import 'cloudflare:index/r2Bucket:R2Bucket' nnueBucket \
    "d5d9818649d8722f73cd798c3b1ffb70/shogi-nnue/default"

# index.ts に provider が返した実値 (jurisdiction / location / storageClass /
# primaryLocationHint 等) を埋め戻す
# その後 pulumi preview で diff 0 を確認
pulumi preview
```

> **誤 `pulumi up` で resource を新規作成しない**: index.ts に declaration を
> 追加した状態で import を忘れると、`pulumi up` は「Cloudflare 上に存在しない
> resource を作る」操作と解釈する。R2 bucket の場合、グローバルにユニークな
> 名前空間で衝突した場合は failed するが、衝突しない別名で発行されたケースでは
> 既存と並行して空 bucket が作られる経路もあるため要注意。
> 必ず import 完了 + `pulumi preview` diff 0 を確認してから `pulumi up` する。

## 5. 緊急ロールバック

### 5.1 R2 設定変更を取り消す

```bash
pulumi stack history --stack production   # 履歴確認 (Pulumi Cloud Console でも見える)
# 直前の commit へ revert する場合
git revert <commit>
pulumi preview && pulumi up
```

### 5.2 R2 bucket そのものを誤って destroy しそうな PR が来た場合

R2 bucket は `protect: true` で守られているため、`pulumi destroy` や `pulumi up`
で resource が消える操作は failed する。意図して destroy する場合のみ
`pulumi state unprotect <urn>` → `pulumi destroy` を使う。bucket destroy 前に
`wrangler r2 object` で重要 object のバックアップを取ること (NNUE モデルは
チェックポイント artifact から再 upload 可能だが、再生成手順を runbook に
明記しておくこと)。

## 6. CI 連携 (Phase 1.5 では preview のみ)

`.github/workflows/pulumi-preview.yml` は **2 job 構成**:

- **`validate-pr` (`pull_request` trigger)**: secrets を一切使わない静的検証
  (TypeScript 型 check + pnpm install dry)。PR で変更された Pulumi code が
  `PULUMI_ACCESS_TOKEN` 経由で Cloudflare token を漏洩する経路を作らない
  ための分離。
- **`preview-production` (`workflow_dispatch` only)**: 信頼済み運用者が手動で
  `production` stack の `pulumi preview` を実行する経路。`PULUMI_ACCESS_TOKEN`
  を使用。**main 以外の ref からの dispatch は workflow 側で skip** される
  (`if: github.ref == 'refs/heads/main'` で強制)。さらに `environment: production`
  で GitHub Environment protection を gate として利用可能 (§6.3 参照)。
  この 2 重ガードにより、`workflow_dispatch` で PR branch 等の任意 ref を
  指定して secret 付きで実行する経路を塞ぐ。

### 6.1 必要な secret / config (実 preview を動かす場合)

- **GitHub repo secret**: `PULUMI_ACCESS_TOKEN`
  - https://app.pulumi.com/account/tokens で Personal Access Token を発行
  - リポジトリ Settings → Secrets and variables → Actions に登録
- **Pulumi Cloud stack config** (`Pulumi.production.yaml`):
  - `cloudflare:apiToken` (encrypted secret) — §2.5 で投入済
  - `ramu-shogi:accountId` — §2.5 で投入済

両方揃っていないと `preview-production` job は途中で失敗する。`PULUMI_ACCESS_TOKEN`
だけ未設定の場合は warning + skip で job 自体は green に抜ける (secrets 設定後の
最初の dispatch で実 preview が走る)。stack config 不足の場合は `pulumi preview`
内部で error 終了するため job は red になる。

### 6.2 自動 `pulumi up` を Phase 1.5 で行わない理由

現行 wrangler 配線が動いている間に Pulumi 側 deploy 経路も自動化すると
競合 / 想定外 deploy のリスクがある。Phase 2 以降で CI 自動 deploy を慎重に統合する。

### 6.3 (推奨) GitHub Environment protection 設定

`preview-production` job の安全性は二重ガードで担保:

1. **workflow 側**: `if: github.ref == 'refs/heads/main'` で main 以外の ref
   からの dispatch を job レベルで skip (workflow file で強制、リポ設定不要)
2. **リポジトリ側 (推奨追加ガード)**: GitHub Environment protection で
   Required reviewers / Deployment branches を設定

本 workflow は既に `environment: production` を宣言しているので、リポジトリ側で
environment を作成すれば自動的に gate される (workflow への追加変更不要):

1. リポジトリ Settings → Environments → "New environment" → 名前 `production`
2. Protection rules:
   - **Required reviewers**: 自分自身を指定 (1 dispatch ごとに承認操作が必要)
   - **Deployment branches**: `main` (or `Selected branches`) に限定

Environment 未設定でも workflow は動作する (workflow 側の ref 強制が唯一の
防御層になる)。OSS リポとして堅牢化する場合は Environment protection も
設定すると Required reviewers による人手承認 gate も追加される。

## 7. トラブルシューティング

### 7.1 `cloudflare:accountId is not a valid configuration key`

§2.5 「config namespace に注意」を参照。`pulumi config rm cloudflare:accountId`
→ `pulumi config set accountId d5d9818649d8722f73cd798c3b1ffb70` で project
namespace に置き直す。

### 7.2 R2 bucket import 時に `bucket not found`

bucket 名 + jurisdiction の組み合わせを確認 (`wrangler r2 bucket list`)。
shogi-nnue の jurisdiction はデフォルト ("default")。EU / fedramp で作成した
覚えが無ければ `default` で固定。

### 7.3 Pulumi.production.yaml に encrypted secret が出るが commit してよいか

OK。Pulumi Cloud (SaaS backend) を使っている前提で、secret は service-side
key で encrypted されている (`secure: AAA...` の形式)。token 値そのものは
含まない。

Self-managed backend (R2 / S3 等) を使う場合は `PULUMI_CONFIG_PASSPHRASE`
依存になり commit 可否が変わるので、Phase 2 で backend 移行する場合は
本セクションを更新する。

## 8. Pulumi ESC + secret-sync workflow (Phase 2-D 補完 / issue #52)

`ROOM_DO_SECRET` を Pulumi ESC で一元管理し、`.github/workflows/secret-sync.yml`
が `wrangler secret bulk` で Cloudflare Worker secret に反映する仕組み。
兄弟 repo (rshogi #690 / nnue-lab #7 / ramu-shogi-backend #7) と統一した
Phase 2-D pattern を frontend Worker にも展開した実装。

### 8.0 経緯 (2026-05-10 postmortem)

Phase 2-D 初版は ramu-shogi-backend / nnue-lab / rshogi の 3 リポを対象とし、
ramu-shogi (frontend Worker) は対象外としていた。Playwright での対局完走検証で
backend D1 に game record が永続化されない事象が判明し、原因は **frontend Worker
側の `RoomDO.persistGameRecord` で `ROOM_DO_SECRET` が `undefined` のまま
`x-room-do-secret` ヘッダを生成 → backend `/internal/game-records` 401 silent
fail** だった (DO console error は `wrangler tail` に出ず、UI 上も対局終了 UX は
正常に進行する設計のため検出が遅れた)。

frontend Worker と backend Worker は別リポ・別 wrangler だが、
`ROOM_DO_SECRET` は **同じ値を共有**する HMAC ヘッダ (Service Binding 越し
internal API 認証) なので、両側を ESC で一元管理する判断とした。

| 項目                 | frontend (本リポ)                     | backend (兄弟 repo)                                |
| -------------------- | ------------------------------------- | -------------------------------------------------- |
| ESC env (staging)    | `sh11235/ramu-shogi-staging`          | `sh11235/ramu-shogi-backend-staging`               |
| ESC env (production) | `sh11235/ramu-shogi-production`       | `sh11235/ramu-shogi-backend-production`            |
| 管理 secret          | `ROOM_DO_SECRET`                      | `ROOM_DO_SECRET` + 他 3 件 (Google OAuth / cookie) |
| 値の制約             | backend と一致 (Service Binding HMAC) | frontend と一致                                    |

**運用契約**: `ROOM_DO_SECRET` を rotation する場合は両 ESC env (`ramu-shogi-*` /
`ramu-shogi-backend-*`) を **同じ値で同時更新** → 各 repo で `secret-sync.yml`
を即座に連続 dispatch する (推奨順は backend → frontend、低トラフィック時間帯)。
どちらの順でも短時間 401 window が発生する現状制約と、`back-to-back dispatch` で
window を最小化する根拠は §8.1 を参照。

### 8.1 ROOM_DO_SECRET の追加 / rotation 手順

1. **新値を生成** (`openssl rand -base64 48` 等)
2. **両 ESC env を同時更新**
   ```bash
   # backend (兄弟 repo) と frontend (本リポ) の両方を更新
   esc env set sh11235/ramu-shogi-backend-staging \
     values.workerSecrets.ROOM_DO_SECRET '<new>' --secret
   esc env set sh11235/ramu-shogi-backend-production \
     values.workerSecrets.ROOM_DO_SECRET '<new>' --secret
   esc env set sh11235/ramu-shogi-staging \
     values.workerSecrets.ROOM_DO_SECRET '<new>' --secret
   esc env set sh11235/ramu-shogi-production \
     values.workerSecrets.ROOM_DO_SECRET '<new>' --secret
   ```
3. **secret-sync を即座に連続 dispatch** (backend → frontend、staging → production の順):
   - ramu-shogi-backend `Secret Sync (ESC -> wrangler)` workflow を staging で dispatch
   - **キックしたら待たずに** ramu-shogi (本リポ) `Secret Sync (ESC -> wrangler)` workflow を staging で dispatch
   - 同 production も同順
4. **動作確認**: staging で対局 1 局完走 → backend D1 `game_records` に新 row が
   作られたら成功 (401 silent fail が無いことを確認)。

> **rotation 中は短時間 401 window が発生する (現状制約)**: backend / frontend
> どちらの順で更新しても、両側が同じ新 secret を持つまでの間は HMAC mismatch で
> `/internal/game-records` が 401 を返す。`persistGameRecord` は silent fail
> 設計のため UI には影響しないが、その window 中に終局した対局は backend D1 に
> 永続化されない (KV / R2 に game_records 復旧経路が無いため復元不可)。
> back-to-back dispatch (typically 1〜2 分以内に両 workflow 完了) で window を
> 最小化するのが運用上のベストプラクティス。低トラフィック時間帯 (深夜等) を
> 選んで rotation する。
>
> backend → frontend の順を推奨する理由は **検証側を先に更新** すると、frontend
> 旧 secret 経由のリクエストは 401 になり問題顕在化が早い (=サイレントに古い
> 値を使い続ける状態を避けられる) こと。逆順 (frontend 先) は frontend 新 →
> backend 旧で同じく 401 だが、frontend deploy 直後の新 secret が backend に
> 認識されるまでの間にバッチで失敗 row が増える可能性がある。
>
> **完全な zero-downtime rotation が必要な場合**: backend を dual-secret 対応
> (新旧 2 つの secret を allowlist して比較) に改修する必要がある (本 PR スコープ外。
> 別 issue で議論)。現状は短時間 window を許容する運用契約とする。

### 8.2 ESC CLI と Pulumi CLI の違い

`pulumi/esc-action@v1.5.0` は **standalone ESC CLI のみ** を install する。
コマンド形式は `esc env open` / `esc env set` を使う (代替 CLI 形式は
`pulumi env open` / `pulumi env set`、これは full Pulumi CLI 同梱時のみ)。

ローカル運用で `pulumi` バイナリしか持たない環境では `pulumi env ...` を、
CI runner や `pulumi/esc-action` install 環境では `esc env ...` を使う。両者は
等価 (back-end は同じ Pulumi Cloud ESC API)。

### 8.3 ESC environment YAML 構造

```yaml
values:
  workerSecrets:
    ROOM_DO_SECRET:
      fn::secret:
        ciphertext: <encrypted>
```

`workerSecrets` は flat object (ネスト無し)。`fn::secret` で暗号化された
ciphertext を保持する。`esc env open --format json` 実行時に decrypt 済 plain
JSON が出力され、workflow が `jq '.workerSecrets'` で抜き出して
`wrangler secret bulk` の入力 (`{"KEY": "value", ...}`) として渡す。

### 8.4 必要な repo secret (GitHub Actions)

`secret-sync.yml` 実行に必要な repo secret:

| Secret 名               | 用途                                                                                                              |
| ----------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `PULUMI_ACCESS_TOKEN`   | ESC env decrypt 用 Pulumi Cloud token (pulumi-preview.yml で設定済)                                               |
| `CLOUDFLARE_API_TOKEN`  | wrangler が secret put に使う token (Workers Scripts: Edit + Account Settings: Read、Pulumi 用 R2 token とは独立) |
| `CLOUDFLARE_ACCOUNT_ID` | wrangler 4.x が `/memberships` API call を skip するために必要 (`d5d9818649d8722f73cd798c3b1ffb70`)               |

`CLOUDFLARE_ACCOUNT_ID` は **secret として登録** することを兄弟 repo と揃える
(env var として読まれる。public 値だが env var inject の便宜上 secret 扱い)。

### 8.5 wrangler env 命名マッピング

`apps/web/wrangler.toml` の env 構造:

| input `environment` | wrangler --env フラグ | Worker 名        |
| ------------------- | --------------------- | ---------------- |
| `production`        | (フラグなし)          | `ramu-shogi`     |
| `staging`           | `--env stg`           | `ramu-shogi-stg` |

workflow 内 `Resolve wrangler --env flag` step で input → flag をマッピング。

### 8.6 トラブルシューティング

**`ESC environment 'sh11235/ramu-shogi-...' に必須 key 不足: ROOM_DO_SECRET`**
ESC env の `workerSecrets` から key が抜けている。`esc env set` で再投入する
(§8.1 の値設定コマンド参照)。

**`wrangler secret bulk` が `Authentication error code: 10000`**
`CLOUDFLARE_API_TOKEN` の scope に `Workers Scripts: Edit` (+ `Account Settings:
Read`) が含まれていない、または expire している。Cloudflare Dashboard で再発行
→ repo secret 更新。

**`Binding name 'ROOM_DO_SECRET' already in use [code: 10053]`**
Worker 上で同名 vars binding が既に存在する状態で secret に切り替えようとして
発生する (本リポでは Phase 2-D 補完時点で `ROOM_DO_SECRET` は既に secret 化
済みのため通常発生しないが、ESC 経由で新規 secret を追加するときは注意)。
発生時は wrangler.toml から該当 vars 宣言を削除 → `wrangler deploy` →
`secret-sync.yml` の順で対処。

**Worker secret に反映されたか確認したい**

```bash
cd apps/web
pnpm exec wrangler secret list --env stg     # staging
pnpm exec wrangler secret list                # production
```

key 名のみ表示される (値は表示されない、Cloudflare 側でも復元不可)。

### 8.7 ローカルから手動で secret を流し込みたい場合

CI を経由せずローカルから ESC → wrangler に流す場合 (緊急 rotation 等):

```bash
cd apps/web
# ESC から JSON 取得
esc env open sh11235/ramu-shogi-staging --format json | jq '.workerSecrets' > /tmp/secrets.json
chmod 600 /tmp/secrets.json
# wrangler secret bulk
pnpm exec wrangler secret bulk /tmp/secrets.json --env stg
rm -f /tmp/secrets.json
```

通常運用は GitHub Actions workflow を dispatch する (audit log と secret 漏洩
リスクを CI runner に閉じ込めるため)。

## 9. 参考

- 設計判断 / 背景: [issue #50](https://github.com/SH11235/ramu-shogi/issues/50)
- 同 pattern の rshogi 実装: [rshogi PR #677](https://github.com/SH11235/rshogi/pull/677) / [docs/csa-server/iac.md](https://github.com/SH11235/rshogi/blob/main/docs/csa-server/iac.md)
- 同 pattern の nnue-lab 実装: [nnue-lab PR #4](https://github.com/SH11235/nnue-lab/pull/4) / [docs/iac.md](https://github.com/SH11235/nnue-lab/blob/main/docs/iac.md)
- 同 pattern の ramu-shogi-backend 実装: [ramu-shogi-backend issue #2](https://github.com/SH11235/ramu-shogi-backend/issues/2) / [docs/iac.md](https://github.com/SH11235/ramu-shogi-backend/blob/main/docs/iac.md)
- [Pulumi Cloudflare Provider Registry](https://www.pulumi.com/registry/packages/cloudflare/)
- [Pulumi Cloud Individual tier](https://www.pulumi.com/pricing/)
- 既存 wrangler 設定: [`apps/web/wrangler.toml`](../apps/web/wrangler.toml)
