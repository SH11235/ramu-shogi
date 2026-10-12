import type {
    CreateStudyRequest as ContractCreateStudyRequest,
    StudyLimitName as ContractLimitName,
    StudyLimits as ContractLimits,
    ApplyStudyOpsRequest as ContractOpsRequest,
    StudyDetail as ContractStudyDetail,
    StudyOp as ContractStudyOp,
} from "@shogi/api-contract";
import { STUDY_LIMITS, type StudyLimitName, type StudyOp } from "@shogi/app-core";
import { describe, expect, it } from "vitest";
import type { CreateStudyRequest, StudyDetail, StudyOpsRequest } from "./api-types";

/** A が B に代入できれば true。 */
type Extends<A, B> = [A] extends [B] ? true : false;
type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;

describe("手書きの型と、backend の OpenAPI から生成した型の整合", () => {
    it("送るもの（作成リクエスト・操作バッチ）は、生成型に代入できる", () => {
        // 型が合わなくなると、ここがコンパイルエラーになる（`pnpm typecheck` で検出する）。
        const checks: [
            Extends<CreateStudyRequest, ContractCreateStudyRequest>,
            Extends<StudyOpsRequest, ContractOpsRequest>,
            Extends<StudyOp, ContractStudyOp>,
            // 操作の種類に過不足が無い。
            Same<StudyOp["type"], ContractStudyOp["type"]>,
        ] = [true, true, true, true];
        expect(checks).toEqual([true, true, true, true]);
    });

    it("受け取るもの（ノートの全体）は、レイヤー以外は生成型からそのまま代入できる", () => {
        // レイヤーの spec.evaluation.layerStacks と display は、サーバーの型が「任意の JSON」
        // 「label 以外のキーも自由」と広いので、クライアントが書く形に絞った型で読む。
        const checks: [
            Extends<Omit<ContractStudyDetail, "layers">, Omit<StudyDetail, "layers">>,
            Extends<
                ContractStudyDetail["layers"][number]["results"],
                StudyDetail["layers"][number]["results"]
            >,
            Extends<StudyDetail["layers"], ContractStudyDetail["layers"]>,
        ] = [true, true, true];
        expect(checks).toEqual([true, true, true]);
    });

    it("上限の名前と初期値の表が、生成型の上限と同じキーを持つ", () => {
        const names: Same<StudyLimitName, ContractLimitName> = true;
        const table: Extends<typeof STUDY_LIMITS, ContractLimits> = true;
        expect([names, table]).toEqual([true, true]);
        expect(Object.keys(STUDY_LIMITS).sort()).toEqual(
            [
                "commentBytes",
                "createBodyBytes",
                "layerDisplayBytes",
                "layerResultsBytes",
                "layerSpecBytes",
                "layersPerStudy",
                "lineLength",
                "metaBytes",
                "multiPv",
                "nodesPerStudy",
                "opsBatchBytes",
                "opsPerBatch",
                "pvLength",
                "studiesPerUser",
                "titleLength",
                "treeBytes",
            ].sort(),
        );
    });
});
