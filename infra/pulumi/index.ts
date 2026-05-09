// ramu-shogi の Cloudflare resources を Pulumi で IaC 管理する。
//
// Phase 1.5 (issue #50) スコープ:
// - R2 bucket (`shogi-nnue`) のみ宣言する。
// - Worker script (`ramu-shogi` / `ramu-shogi-stg`) と Durable Object
//   (`RoomDO`) / vars / secrets / Service binding (`BACKEND` →
//   `ramu-shogi-backend(-stg)`) / Rate limit binding (`ROOM_RATE_LIMITER`) /
//   R2 binding (`NNUE_BUCKET`) / Assets binding / SPA 設定 / migrations は
//   **`apps/web/wrangler.toml` による管理を継続** する。理由は `docs/iac.md` §3 参照。
// - Worker / wrangler 側との binding 整合性は「bucket_name が wrangler.toml と
//   Pulumi 宣言で一致していること」で担保する (binding 自体は wrangler が張る)。
//
// **重要: R2 bucket は staging / production で共有されている**
// - `apps/web/wrangler.toml` の default (production) と `env.stg` の双方で
//   `[[r2_buckets]]` が `bucket_name = "shogi-nnue"` を指している。
// - したがって本 Pulumi project は **bucket を 1 件しか宣言しない**。
// - env 別バケット (`shogi-nnue` / `shogi-nnue-stg`) に分離したい場合は別 issue で扱う。
//   分離手順は `docs/iac.md` §4.2 を参照。
//
// stack: 単一 `production` (ramu-shogi のフロント Worker は default が production
// で、env.stg は同 Cloudflare account 上の補助環境という位置付け。R2 が共有な以上
// Pulumi 側で stack を分けても resource 集合が変わらないため、stack も `production`
// 1 つだけで運用する)。
// config:
//   - `ramu-shogi:accountId` (project namespace, plain — URL に出る情報)
//   - `cloudflare:apiToken` (provider, secret)

import * as cloudflare from "@pulumi/cloudflare";
import * as pulumi from "@pulumi/pulumi";

const config = new pulumi.Config();
const accountId = config.require("accountId");

// ----------------------------------------------------------------------------
// R2 bucket (NNUE モデル配信用)
// ----------------------------------------------------------------------------
// `apps/web/wrangler.toml` の `[[r2_buckets]]` (default + env.stg 共有) で
// 参照される `NNUE_BUCKET` → bucket_name "shogi-nnue" を Pulumi 管理に取り込む。
//
// 引数 (jurisdiction / location / storageClass) は
// `pulumi import 'cloudflare:index/r2Bucket:R2Bucket' nnueBucket '<account_id>/shogi-nnue/default'`
// で state を吸い上げてから埋める (docs/iac.md §4.4 参照)。Phase 1.5 着地時点では
// 必須引数 `name` と `accountId` のみで宣言し、import 後に provider 側の現状値を
// そのまま記述する流儀。
//
// `protect: true` で誤 destroy をブロック。R2 bucket は中身に NNUE モデル
// (フロント配信用) が入っており、誤って destroy するとフロントが NNUE モデルを
// fetch できなくなる (バケット名がユニーク命名空間で、再作成しても旧 URL は
// 復活しない)。
export const nnueBucket = new cloudflare.R2Bucket(
    "nnueBucket",
    {
        accountId,
        jurisdiction: "default",
        location: "APAC",
        name: "shogi-nnue",
        storageClass: "Standard",
    },
    { protect: true },
);
