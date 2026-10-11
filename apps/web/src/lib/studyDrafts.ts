/**
 * 研究ノートの、まだ保存できていないコメントの入力（下書き）の置き場所。
 *
 * コメントを書いている途中でログインが切れると、ノートに保存できなくなる。入力を失わないよう、
 * このブラウザの中（localStorage）に、**ノートの持ち主と一緒に**残しておく。同じ持ち主として
 * ノートを開けたときだけ戻し、別のアカウントでは表示も保存もしない。
 *
 * 表示状態の保存口（`setViewState`）は、ノートが見えない間は書き込めないので使えない。
 */

const STORAGE_KEY = "ramu-study-comment-drafts";
/** 残しておく下書きの数（新しい順）。 */
const MAX_DRAFTS = 20;

interface StoredDraft {
    /** ノートの持ち主（匿名のノートは null）。 */
    ownerId: string | null;
    /** コメントを書いていた手（保存用の `nodeId`）。 */
    nodeId: string;
    text: string;
    /** 書いた時刻（Unix ミリ秒）。 */
    at: number;
}

type DraftMap = Record<string, StoredDraft>;

const readAll = (): DraftMap => {
    try {
        const raw = globalThis.localStorage?.getItem(STORAGE_KEY);
        if (!raw) return {};
        const parsed: unknown = JSON.parse(raw);
        return parsed !== null && typeof parsed === "object" ? (parsed as DraftMap) : {};
    } catch {
        return {};
    }
};

const writeAll = (drafts: DraftMap): void => {
    try {
        const kept = Object.entries(drafts)
            .sort(([, a], [, b]) => (b.at ?? 0) - (a.at ?? 0))
            .slice(0, MAX_DRAFTS);
        globalThis.localStorage?.setItem(STORAGE_KEY, JSON.stringify(Object.fromEntries(kept)));
    } catch {
        // 残せなくても画面は動く（入力は画面の中には残っている）。
    }
};

/**
 * ノートの下書きを読む。`ownerId` がそのノートの持ち主と一致するときだけ返す
 * （別のアカウントが書いた下書きは返さない）。
 */
export function readStudyCommentDraft(
    studyId: string,
    ownerId: string | null,
): { nodeId: string; text: string } | null {
    const drafts = readAll();
    if (!Object.hasOwn(drafts, studyId)) return null;
    const draft = drafts[studyId];
    if (
        draft.ownerId !== ownerId ||
        typeof draft.nodeId !== "string" ||
        typeof draft.text !== "string"
    ) {
        return null;
    }
    return { nodeId: draft.nodeId, text: draft.text };
}

/**
 * ノートの下書きを残す。`text` が null なら（保存できたので）消す。
 * 別の持ち主の下書きが残っているときは、消さない（その人が戻ってきたときのために残す）。
 */
export function writeStudyCommentDraft(
    studyId: string,
    ownerId: string | null,
    nodeId: string,
    text: string | null,
    now: number = Date.now(),
): void {
    const drafts = readAll();
    const existing = Object.hasOwn(drafts, studyId) ? drafts[studyId] : undefined;
    if (text === null) {
        if (!existing || existing.ownerId !== ownerId || existing.nodeId !== nodeId) return;
        delete drafts[studyId];
        writeAll(drafts);
        return;
    }
    drafts[studyId] = { ownerId, nodeId, text, at: now };
    writeAll(drafts);
}
