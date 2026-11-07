/**
 * しおりを付けた局面（定跡の局面のキー）を localStorage に残す。局面に付けるので、別の定跡ファイルでも
 * 同じ局面があれば出る。保存できない環境（プライベートウィンドウ等）では、開いている間だけ持つ。
 */
const STORAGE_KEY = "book-tree-viewer:bookmarks";

export function loadBookmarks(): string[] {
    try {
        const value: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "[]");
        return Array.isArray(value) ? value.filter((key) => typeof key === "string") : [];
    } catch {
        return [];
    }
}

export function saveBookmarks(keys: readonly string[]): void {
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(keys));
    } catch {
        // 保存できなくても、開いている間はしおりを使える。
    }
}
