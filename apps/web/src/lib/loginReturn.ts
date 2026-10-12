/**
 * ログインを始めた画面を覚えておき、ログイン後にそこへ戻すための「戻り先」。
 *
 * 戻り先は、ログインの画面の URL（`/auth?next=<戻り先>`）に載せて運ぶ。ログインの画面は
 * それを backend の `GET /api/auth/google/start?next=...` へ渡し、backend は OAuth の往復の
 * 間だけ cookie（10 分で切れ、コールバックで消える）に持って、ログイン後にそこへ送り返す。
 * ブラウザ側には何も保存しないので、ログインをやめた・失敗したあとに、古い戻り先で
 * 突然飛ばされることはない（タブごとに URL が別なので、別のタブとも混ざらない）。
 *
 * 戻り先として受け付けるのは、このサイトの中のページを指す相対パス
 * （パス + クエリ + ハッシュ）だけ。それ以外は捨てて、トップへ戻す。
 */

/** ログインの画面。ここへ戻すと、ログイン後にまたログインの画面が出てしまう。 */
const AUTH_PATH = "/auth";

/**
 * 戻り先の長さの上限。backend は OAuth の往復の間、戻り先を cookie に持つ
 * （1 つ 4096 バイトまで）。URL エンコードで膨らむ分を見込んで、余裕を持たせる。
 */
const MAX_RETURN_PATH_LENGTH = 1024;

/** 判定のためだけに使う、仮のオリジン（相対パスを URL として解釈するための土台）。 */
const PARSE_BASE = "https://return-path.invalid";

const hasControlCharacter = (value: string): boolean =>
    Array.from(value).some((char) => {
        const code = char.charCodeAt(0);
        return code < 32 || code === 127;
    });

/** パスに、エンコードした `/`（`%2F`）か `\`（`%5C`）が含まれるか。 */
const ENCODED_SEPARATOR = /%2f|%5c/i;

/**
 * パスが指す先を、ルーターと同じ見方（パーセントエンコードを解き、大文字小文字を区別しない）で
 * 分類する。`/AUTH` や `/%61uth` も、ルーターはログインの画面として開く。
 *
 * - `auth`: ログインの画面（`/auth`、`/auth/...`）
 * - `api`: API（`/api`、`/api/...`）
 * - `invalid`: 解けないエンコード、エンコードした区切り文字（解く層によって別のパスになる）、
 *   解くと制御文字になるもの
 * - `page`: それ以外
 */
const classifyPath = (pathname: string): "auth" | "api" | "invalid" | "page" => {
    if (ENCODED_SEPARATOR.test(pathname)) return "invalid";
    let decoded: string;
    try {
        decoded = decodeURIComponent(pathname).toLowerCase();
    } catch {
        return "invalid";
    }
    if (hasControlCharacter(decoded)) return "invalid";
    if (decoded === AUTH_PATH || decoded.startsWith(`${AUTH_PATH}/`)) return "auth";
    if (decoded === "/api" || decoded.startsWith("/api/")) return "api";
    return "page";
};

/**
 * 戻り先として使ってよい値なら、正規化した相対パス（パス + クエリ + ハッシュ）を返す。
 * 使えない値は `null`（呼び出し側はトップへ戻す）。
 *
 * - `/` で始まる相対パスだけ（`https://...` や `javascript:` などスキーム付きは不可）
 * - `//host` や `/\host`（ブラウザが別のサイトとして解釈する）は不可。`\` と制御文字は
 *   どこにあっても不可。パスの中の `%2F`・`%5C`（エンコードした `/`・`\`）も不可
 * - URL として解釈した結果が別のオリジンになるものは不可
 * - ログインの画面（`/auth`）と API（`/api/...`。ログアウトなど）は不可
 *   （`/x/../auth` のような書き方も、正規化してから判定する。`/AUTH` や `/%61uth` のような
 *   大文字・パーセントエンコードの書き方も、解いて小文字にそろえてから判定する）
 * - パスのパーセントエンコードが解けないもの（`/%zz`）は不可
 * - 長すぎるものは不可
 */
export function sanitizeReturnPath(raw: unknown): string | null {
    if (typeof raw !== "string" || raw === "") return null;
    if (raw.length > MAX_RETURN_PATH_LENGTH) return null;
    if (!raw.startsWith("/") || raw.startsWith("//")) return null;
    if (raw.includes("\\") || hasControlCharacter(raw)) return null;

    let url: URL;
    try {
        url = new URL(raw, PARSE_BASE);
    } catch {
        return null;
    }
    if (url.origin !== PARSE_BASE) return null;

    const { pathname } = url;
    if (pathname.startsWith("//")) return null;
    if (classifyPath(pathname) !== "page") return null;

    const normalized = `${pathname}${url.search}${url.hash}`;
    // トップは既定の戻り先なので、覚えておく必要がない。
    if (normalized === "/") return null;
    return normalized.length > MAX_RETURN_PATH_LENGTH ? null : normalized;
}

/** ログインの画面の URL に載っている戻り先（`?next=...`）を読む。 */
export function readReturnPathFromSearch(search: string): string | null {
    return sanitizeReturnPath(new URLSearchParams(search).get("next"));
}

interface LocationLike {
    pathname: string;
    search: string;
    hash: string;
}

/**
 * いま開いている画面を、ログイン後の戻り先にする。
 * ログインの画面にいるときは、その画面が運んできた戻り先（`?next=...`）を引き継ぐ。
 */
export function currentReturnPath(
    location: LocationLike | undefined = typeof window === "undefined"
        ? undefined
        : window.location,
): string | null {
    if (!location) return null;
    // ログインの画面かどうかは、戻り先の検証と同じ規則で見る（`/AUTH` や `/auth/` も同じ画面）。
    if (classifyPath(location.pathname) === "auth") {
        return readReturnPathFromSearch(location.search);
    }
    return sanitizeReturnPath(`${location.pathname}${location.search}${location.hash}`);
}

/** ログインの画面へのリンク。戻り先が使える値なら `?next=...` を付ける。 */
export function buildLoginHref(returnPath: string | null | undefined): string {
    const safe = sanitizeReturnPath(returnPath);
    return safe === null ? AUTH_PATH : `${AUTH_PATH}?next=${encodeURIComponent(safe)}`;
}

/**
 * ログインの画面への `<Link to="/auth" search={loginSearch}>` に渡す検索パラメータ。
 * 押した時点で開いている画面を戻り先にする（リンクを描いたあとに URL のクエリが
 * 変わっていても、押した時点の URL へ戻る）。
 */
export function loginSearch(): { next: string | undefined } {
    return { next: currentReturnPath() ?? undefined };
}
