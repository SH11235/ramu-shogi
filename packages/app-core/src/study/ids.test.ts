import { describe, expect, it } from "vitest";
import {
    canonicalJSON,
    normalizeStudyStartSfen,
    studyChildNodeId,
    studyHash,
    studyLayerId,
    studyOriginKey,
    studyRootNodeId,
} from "./ids";
import { sha256Hex, utf8Encode } from "./sha256";
import fixtures from "./study-id-fixtures.json";
import type { StudyLayerSpec, StudyOriginKind, StudyRules } from "./types";
import { STUDY_HIRATE_SFEN } from "./types";

const webCryptoSha256Hex = async (text: string): Promise<string> => {
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
    return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join(
        "",
    );
};

describe("sha256Hex", () => {
    it("既知のテストベクタと一致する", () => {
        expect(sha256Hex(utf8Encode(""))).toBe(
            "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
        );
        expect(sha256Hex(utf8Encode("abc"))).toBe(
            "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
        );
        expect(
            sha256Hex(utf8Encode("abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq")),
        ).toBe("248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1");
    });

    it("ブロック境界をまたぐ長さと多バイト文字で WebCrypto と一致する", async () => {
        const samples = [
            "a".repeat(55),
            "a".repeat(56),
            "a".repeat(63),
            "a".repeat(64),
            "a".repeat(65),
            "a".repeat(1000),
            "日本語のコメント😀と𠮷野家",
            "é߿ࠀ￿",
        ];
        for (const sample of samples) {
            expect(sha256Hex(utf8Encode(sample))).toBe(await webCryptoSha256Hex(sample));
        }
    });

    it("UTF-8 の符号化が TextEncoder と一致する（対になっていないサロゲートを含む）", () => {
        for (const sample of ["abc", "日本語", "😀", "\ud83d", "\ude00x", "a\ud83dz"]) {
            expect(Array.from(utf8Encode(sample))).toEqual(
                Array.from(new TextEncoder().encode(sample)),
            );
        }
    });
});

// `study-id-fixtures.json` は backend（ramu-shogi-backend の
// `apps/api-worker/src/studies/study-id-fixtures.json`）と同じ内容。片方だけ変えないこと。
describe("canonicalJSON", () => {
    it("fixture: キーを UTF-16 コード単位の昇順に並べ、配列の順序を保ち、空白を入れない", () => {
        expect(fixtures.canonicalJson.length).toBeGreaterThan(0);
        for (const item of fixtures.canonicalJson) {
            expect(canonicalJSON(item.input)).toBe(item.expected);
        }
    });

    it("文字列は JSON.stringify と同じ規則でエスケープする", () => {
        const value = { 'k"': 'a"b\\c\n', あ: "い" };
        expect(canonicalJSON(value)).toBe('{"k\\"":"a\\"b\\\\c\\n","あ":"い"}');
        expect(canonicalJSON(value)).toBe(JSON.stringify(value));
    });

    it("安全な整数以外の数値は例外にする。-0 は 0", () => {
        expect(canonicalJSON([0, -0, 12, -3])).toBe("[0,0,12,-3]");
        expect(() => canonicalJSON({ a: 1.5 })).toThrow();
        expect(() => canonicalJSON([Number.NaN])).toThrow();
        expect(() => canonicalJSON([Number.POSITIVE_INFINITY])).toThrow();
        expect(() => canonicalJSON([Number.MAX_SAFE_INTEGER + 1])).toThrow();
    });

    it("値が undefined のキーは出力しない", () => {
        expect(canonicalJSON({ a: undefined, b: 1 })).toBe('{"b":1}');
    });
});

describe("識別子", () => {
    it("fixture: H は正規化した JSON の SHA-256", async () => {
        expect(fixtures.hash.length).toBeGreaterThan(0);
        for (const item of fixtures.hash) {
            const input = item.input as Parameters<typeof studyHash>[0];
            expect(studyHash(input)).toBe(item.sha256);
            expect(studyHash(input)).toBe(await webCryptoSha256Hex(canonicalJSON(input)));
        }
    });

    it("fixture: ルートの nodeId", () => {
        expect(fixtures.rootNodeIds.length).toBeGreaterThan(0);
        for (const item of fixtures.rootNodeIds) {
            const rules = item.rules as StudyRules;
            expect(studyHash(item.hashInput).slice(0, 32)).toBe(item.nodeId);
            expect(studyRootNodeId(item.startSfen, rules)).toBe(item.nodeId);
        }
        expect(studyRootNodeId(STUDY_HIRATE_SFEN, { variant: "standard" })).toBe(
            "6c3e7548e58759b28e57ec9f892f6edd",
        );
    });

    it("fixture: 子の nodeId", () => {
        expect(fixtures.childNodeIds.length).toBeGreaterThan(0);
        for (const item of fixtures.childNodeIds) {
            expect(studyHash(item.hashInput).slice(0, 32)).toBe(item.nodeId);
            expect(studyChildNodeId(item.parentNodeId, item.usiMove)).toBe(item.nodeId);
        }
    });

    it("fixture: layerId は spec のキーの順序に依存しない", () => {
        expect(fixtures.layerIds.length).toBeGreaterThan(0);
        for (const item of fixtures.layerIds) {
            const spec = item.spec as StudyLayerSpec;
            expect(studyLayerId(spec)).toBe(item.layerId);
            const reordered: StudyLayerSpec = {
                rules: spec.rules,
                multiPv: spec.multiPv,
                limits: {
                    nodes: spec.limits.nodes,
                    depth: spec.limits.depth,
                    timeMs: spec.limits.timeMs,
                },
                evaluation: spec.evaluation,
                engine: spec.engine,
                version: 1,
            };
            expect(studyLayerId(reordered)).toBe(item.layerId);
            expect(studyLayerId({ ...spec, multiPv: spec.multiPv + 1 })).not.toBe(item.layerId);
        }
        // 設計書 5.5 の例。
        expect(fixtures.layerIds[0].layerId).toBe("09eaa9172ee511340bd1b3e2f3c7c80d");
    });

    it("fixture: originKey。paste は null", () => {
        expect(fixtures.originKeys.length).toBeGreaterThan(0);
        for (const item of fixtures.originKeys) {
            expect(studyOriginKey(item.kind as StudyOriginKind, item.ref)).toBe(item.originKey);
        }
        expect(studyOriginKey("game_record", null)).toBeNull();
    });
});

describe("normalizeStudyStartSfen", () => {
    it("startpos を平手の SFEN にする", () => {
        expect(normalizeStudyStartSfen("startpos")).toBe(STUDY_HIRATE_SFEN);
    });

    it("sfen 接頭辞と余分な空白を外し、手数が無ければ 1 を補う", () => {
        expect(normalizeStudyStartSfen("sfen  4k4/9/9/9/9/9/9/9/4K4  w  2P ")).toBe(
            "4k4/9/9/9/9/9/9/9/4K4 w 2P 1",
        );
        expect(normalizeStudyStartSfen("4k4/9/9/9/9/9/9/9/4K4 b - 12")).toBe(
            "4k4/9/9/9/9/9/9/9/4K4 b - 12",
        );
    });

    it("フィールド数が合わない入力は例外にする", () => {
        expect(() => normalizeStudyStartSfen("4k4/9/9/9/9/9/9/9/4K4 b")).toThrow();
    });
});
