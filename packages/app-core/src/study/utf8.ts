/**
 * UTF-8 にしたときのバイト数（上限の判定用）。数え方はここ 1 か所にまとめる。
 * 対になっていないサロゲートは U+FFFD（3 バイト）として数える（TextEncoder と同じ）。
 */

/** UTF-8 にしたときのバイト数。`stopAfter` を超えた時点で数えるのをやめる。 */
export function utf8ByteLength(text: string, stopAfter: number = Number.POSITIVE_INFINITY): number {
    let bytes = 0;
    for (let i = 0; i < text.length; i++) {
        const code = text.charCodeAt(i);
        if (code < 0x80) bytes += 1;
        else if (code < 0x800) bytes += 2;
        else if (code >= 0xd800 && code <= 0xdbff) {
            const next = i + 1 < text.length ? text.charCodeAt(i + 1) : 0;
            if (next >= 0xdc00 && next <= 0xdfff) {
                bytes += 4;
                i++;
            } else bytes += 3;
        } else bytes += 3;
        if (bytes > stopAfter) return bytes;
    }
    return bytes;
}

/**
 * UTF-8 にしたときのバイト数が limit を超えるか。UTF-16 の 1 コード単位は UTF-8 で 1〜3 バイト
 * なので、長さだけで決まる場合は数えない（数百 KB の JSON を毎回数えないため）。
 */
export function exceedsUtf8Bytes(text: string, limit: number): boolean {
    if (text.length > limit) return true;
    if (text.length * 3 <= limit) return false;
    return utf8ByteLength(text, limit) > limit;
}
