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
            // 契約が保証するのは csa_code ⇄ end_reason 対応まで。decoded.kind
            // ("resignation" 等)は client 内部表現でサーバマニフェストに無いため
            // 契約テストの対象外(kind のマッピング健全性は live.test.ts が担当)。
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

    // NOTE: マニフェストの `csa_outcome_codes` (#WIN/#LOSE/#DRAW/#CENSORED) は終局
    // 結果に付随する outcome 行で、client の decodeResultCode は reason コード
    // (#RESIGN 等)のみを解釈し outcome 行は消費しない。よって本契約テストでは
    // 検証しない(将来 live.ts で使い始めたら同様の網羅チェックを追加すること)。
    // リポジトリ間のコピー乖離自体は drift 検知 workflow が担保する。

    it("wire union の網羅性(コンパイル時ガード: このテストが実行される時点で型検査済み)", () => {
        // 型エラーなくここに到達している = コンパイル時に exhaustive が成立している。
        // ランタイムでは常に true だが、ガードが存在することを明示的に文書化する。
        expect(endReasonExhaustive).toBe(true);
        expect(resultKindExhaustive).toBe(true);
    });
});
