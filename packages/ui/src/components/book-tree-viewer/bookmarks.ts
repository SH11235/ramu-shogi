/**
 * しおりを付けた局面（定跡の局面のキー）を localStorage に残す。局面に付けるので、別の定跡ファイルでも
 * 同じ局面があれば出る。保存できない環境（プライベートウィンドウ等）では、開いている間だけ持つ。
 */
const STORAGE_KEY = "book-tree-viewer:bookmarks";

/** 保存されたしおり。読めなければ null、保存された値が配列でなければ空。 */
export function loadBookmarks(): string[] | null {
    try {
        const value: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "[]");
        return Array.isArray(value) ? value.filter((key) => typeof key === "string") : [];
    } catch {
        return null;
    }
}

/** 保存できたかを返す。 */
export function saveBookmarks(keys: readonly string[]): boolean {
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(keys));
        return true;
    } catch {
        return false;
    }
}
