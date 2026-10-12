/**
 * 研究ノートの識別子（設計書 5.2）。
 *
 * `H(x)` = `SHA-256(UTF-8(canonicalJSON(x)))` の小文字 hex。backend と同じ計算でなければ
 * サーバーの照合に通らないので、両 repo で同じ fixture（`study-id-fixtures.json`）を検証する。
 */

import { sha256Hex, utf8Encode } from "./sha256";
import type { StudyLayerSpec, StudyOriginKind, StudyRules } from "./types";
import { STUDY_HIRATE_SFEN } from "./types";

type CanonicalValue =
    | null
    | boolean
    | number
    | string
    | readonly CanonicalValue[]
    | { readonly [key: string]: CanonicalValue };

/**
 * 正規化した JSON 文字列を返す。
 *
 * オブジェクトのキーを再帰的に辞書順（UTF-16 コード単位の順）に並べ、配列の順序は保ち、
 * 余分な空白を入れない。数値は有限の整数のみを受け付け、それ以外は例外にする
 * （小数や NaN は実装ごとに文字列化が揺れ、ハッシュが割れるため）。
 * 値が `undefined` のキーは `JSON.stringify` と同じく出力しない。
 */
export function canonicalJSON(value: unknown): string {
    if (value === null) return "null";
    if (typeof value === "boolean") return value ? "true" : "false";
    if (typeof value === "number") {
        if (!Number.isSafeInteger(value)) {
            throw new Error(`canonicalJSON: 数値は有限の整数のみ扱えます: ${String(value)}`);
        }
        // -0 は "0" にする（JSON.stringify と同じ）。
        return String(value === 0 ? 0 : value);
    }
    if (typeof value === "string") return JSON.stringify(value);
    if (Array.isArray(value)) {
        return `[${value.map((item) => canonicalJSON(item === undefined ? null : item)).join(",")}]`;
    }
    if (typeof value === "object") {
        const record = value as Record<string, unknown>;
        const keys = Object.keys(record)
            .filter((key) => record[key] !== undefined)
            .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
        return `{${keys.map((key) => `${JSON.stringify(key)}:${canonicalJSON(record[key])}`).join(",")}}`;
    }
    throw new Error(`canonicalJSON: 扱えない値です: ${typeof value}`);
}

/** `H(x)`: 正規化した JSON の SHA-256（小文字 hex、64 文字）。 */
export function studyHash(value: CanonicalValue): string {
    return sha256Hex(utf8Encode(canonicalJSON(value)));
}

const shortHash = (value: CanonicalValue): string => studyHash(value).slice(0, 32);

/** ルートの `nodeId`。 */
export function studyRootNodeId(startSfen: string, rules: StudyRules): string {
    return shortHash(["ramu-node-v1", startSfen, { ...rules }]);
}

/** 子の `nodeId`。親と指し手だけで決まるので、同じ手順なら必ず同じ ID になる。 */
export function studyChildNodeId(parentNodeId: string, usiMove: string): string {
    return shortHash(["ramu-node-v1", parentNodeId, usiMove]);
}

/** `layerId`。`spec` のハッシュ。 */
export function studyLayerId(spec: StudyLayerSpec): string {
    return shortHash(spec as unknown as CanonicalValue);
}

/** `originKey`。`paste`（または元棋譜の識別子が無い）は null。 */
export function studyOriginKey(
    originKind: StudyOriginKind,
    originRef: string | null,
): string | null {
    if (originKind === "paste" || originRef === null) return null;
    return shortHash(["ramu-origin-v1", originKind, originRef]);
}

/**
 * 開始局面を保存用の SFEN（4 フィールドを空白 1 つで区切った文字列）にする。
 *
 * `startpos` と `sfen ` 接頭辞つきの表記を受け付ける。手数フィールドが無ければ 1 を補う。
 * 4 フィールドに満たない・多すぎる入力は例外にする。
 */
export function normalizeStudyStartSfen(startSfen: string): string {
    const trimmed = startSfen.trim();
    if (trimmed === "startpos" || trimmed === "position startpos") return STUDY_HIRATE_SFEN;
    const fields = trimmed.split(/\s+/);
    if (fields[0] === "position") fields.shift();
    if (fields[0] === "sfen") fields.shift();
    if (fields.length === 3) fields.push("1");
    if (fields.length !== 4) {
        throw new Error(`SFEN の形式が正しくありません: ${startSfen}`);
    }
    return fields.join(" ");
}
