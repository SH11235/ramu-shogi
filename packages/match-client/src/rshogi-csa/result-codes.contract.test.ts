import { describe, expect, it } from "vitest";
import type { RshogiEndReasonWire, RshogiResultKindWire } from "./fixtures";
import { decodeResultCode } from "./live";
import contract from "./result-codes.json";

/**
 * 結果コード契約テスト。
 *
 * `result-codes.json` は rshogi
 * (`crates/rshogi-csa-server-workers/contracts/result-codes.json`) の canonical
 * マニフェストの **byte-identical コピー**。rshogi 側は generate-and-compare
 * テストで enum との一致をコンパイル時 + `cargo test` で強制し、こちら側は本
 * テストで client の decode 実装がマニフェスト語彙を漏れなく扱うことを保証する。
 * 2 リポジトリ間のコピー乖離の常時監視は
 * `.github/workflows/result-codes-contract-drift.yml` が担う。
 *
 * 注意: `live.ts` の `#ILLEGAL` は client 側の寛容な alias であり、マニフェスト
 * には存在しない(サーバ正準は `#ILLEGAL_MOVE`)。将来のリファクタでこの alias
 * case を「マニフェストに無いから」と削除しないこと。
 */

// wire リテラルを列挙。`satisfies` で各値が union のメンバであることをコンパイル時保証
// (typo / union に無い値を書くと型エラー)。
const EXPECTED_END_REASONS = [
    "RESIGN",
    "TIME_UP",
    "ILLEGAL",
    "JISHOGI",
    "OUTE_SENNICHITE",
    "SENNICHITE",
    "MAX_MOVES",
    "ABNORMAL",
] as const satisfies readonly RshogiEndReasonWire[];

const EXPECTED_RESULT_KINDS = [
    "WIN_BLACK",
    "WIN_WHITE",
    "DRAW",
    "ABORT",
] as const satisfies readonly RshogiResultKindWire[];

// 逆方向(union 側に列挙漏れが無いこと)をコンパイル時保証。列挙から漏れた union
// メンバがあると `Exclude<...>` が never にならず、代入が型エラーになる。
type EndReasonExhaustive =
    Exclude<RshogiEndReasonWire, (typeof EXPECTED_END_REASONS)[number]> extends never
        ? true
        : false;
const endReasonExhaustive: EndReasonExhaustive = true;

type ResultKindExhaustive =
    Exclude<RshogiResultKindWire, (typeof EXPECTED_RESULT_KINDS)[number]> extends never
        ? true
        : false;
const resultKindExhaustive: ResultKindExhaustive = true;

describe("result-codes contract", () => {
    it("全 variant の csa_code が fallback 無しで decode され end_reason が一致する", () => {
        for (const variant of contract.variants) {
            const decoded = decodeResultCode(variant.csa_code, "sente");
            // decodeResultCode は未知コードで undefined を返す(fallback 無し)ので、
            // defined であること = switch がその csa_code を直接扱っていること。
            expect(decoded, `${variant.variant} (${variant.csa_code})`).toBeDefined();
            expect(decoded?.endReason, variant.csa_code).toBe(variant.end_reason);
        }
    });

    it("マニフェストの end_reason 集合が RshogiEndReasonWire と双方向一致する", () => {
        expect(new Set(contract.variants.map((v) => v.end_reason))).toEqual(
            new Set(EXPECTED_END_REASONS),
        );
    });

    it("マニフェストの result_kinds 集合が RshogiResultKindWire と双方向一致する", () => {
        expect(new Set(contract.result_kinds)).toEqual(new Set(EXPECTED_RESULT_KINDS));
    });

    it("wire union の網羅性(コンパイル時ガード)が保たれている", () => {
        expect(endReasonExhaustive).toBe(true);
        expect(resultKindExhaustive).toBe(true);
    });
});
