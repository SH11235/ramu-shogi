/**
 * URL のクエリ (`?event=WCSC36&venue=floodgate`) と検索パラメータの相互変換。
 *
 * TanStack Router の既定の変換は、値を JSON として解釈する。そのため `?event=2026` は
 * 数値、`?event=true` は真偽値になり、逆に `"2026"` という文字列を書き出すと
 * `?event=%222026%22` と引用符付きになる。このアプリの検索パラメータはすべて文字列
 * (イベント名・対局者名・席など) なので、値を解釈せず文字列のまま往復させる。
 *
 * - 読み込み: 値はすべて文字列。同じキーが複数あれば配列にする。以前の形式で書かれた
 *   引用符付きの文字列 (`%22abc%22`) は中身の文字列として読む。
 * - 書き出し: 文字列はそのまま。文字列以外 (数値・真偽値・オブジェクト) は JSON にする
 *   (読み戻すと文字列になるので、型が要る値を置くルートを作るときは `validateSearch` で
 *   変換すること)。`"` で始まる文字列だけは、読み込み時に引用符付きの値と区別できるよう
 *   JSON の文字列として書く。
 */

const decodeValue = (value: string): string => {
    if (!value.startsWith('"')) return value;
    try {
        const parsed: unknown = JSON.parse(value);
        return typeof parsed === "string" ? parsed : value;
    } catch {
        return value;
    }
};

export function parseSearch(searchStr: string): Record<string, unknown> {
    const params = new URLSearchParams(searchStr.startsWith("?") ? searchStr.slice(1) : searchStr);
    const result: Record<string, unknown> = {};
    for (const [key, raw] of params.entries()) {
        const value = decodeValue(raw);
        const previous = result[key];
        if (previous === undefined) {
            result[key] = value;
        } else if (Array.isArray(previous)) {
            previous.push(value);
        } else {
            result[key] = [previous, value];
        }
    }
    return result;
}

const encodeValue = (value: unknown): string => {
    if (typeof value === "string") {
        return value.startsWith('"') ? JSON.stringify(value) : value;
    }
    return JSON.stringify(value);
};

export function stringifySearch(search: Record<string, unknown>): string {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(search)) {
        if (value === undefined) continue;
        params.set(key, encodeValue(value));
    }
    const text = params.toString();
    return text ? `?${text}` : "";
}
