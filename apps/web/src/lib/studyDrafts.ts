/**
 * 研究ノートの、まだ保存できていないコメントの入力（下書き）の置き場所。
 *
 * コメントを書いている途中でログインが切れると、ノートに保存できなくなる。また、長すぎる
 * コメントは短くするまで保存されない。どちらの入力も失わないよう、このブラウザの中
 * （localStorage）に、**ノートの持ち主と一緒に**、手ごとに残しておく。同じ持ち主として
 * ノートを開けたときだけ戻し、別のアカウントでは表示も保存もしない。
 *
 * 表示状態の保存口（`setViewState`）は、ノートが見えない間は書き込めないので使えない。
 */

const STORAGE_KEY = "ramu-study-comment-drafts";
/** 残しておくノートの数（新しい順）。 */
const MAX_STUDIES = 20;
/** 1 つのノートで残しておく手の数（新しい順）。 */
const MAX_NODES_PER_STUDY = 8;

/** ある手の下書き。 */
interface StudyCommentDraftEntry {
    /** コメントを書いていた手（保存用の `nodeId`）。 */
    nodeId: string;
    text: string;
}

interface StoredDrafts {
    /** ノートの持ち主（匿名のノートは null）。 */
    ownerId: string | null;
    /** 手ごとの下書き。書いた順（最後が最も新しい）。 */
    nodes: StudyCommentDraftEntry[];
    /** 最後に書いた時刻（Unix ミリ秒）。 */
    at: number;
}

type DraftMap = Record<string, StoredDrafts>;

const isEntry = (value: unknown): value is StudyCommentDraftEntry =>
    value !== null &&
    typeof value === "object" &&
    "nodeId" in value &&
    typeof value.nodeId === "string" &&
    "text" in value &&
    typeof value.text === "string";

/** 保存してあった値を、いまの形に直す（以前は 1 つのノートに 1 つの手だけを残していた）。 */
const normalize = (value: unknown): StoredDrafts | null => {
    if (value === null || typeof value !== "object") return null;
    const ownerId = "ownerId" in value && typeof value.ownerId === "string" ? value.ownerId : null;
    const at = "at" in value && typeof value.at === "number" ? value.at : 0;
    if ("nodes" in value && Array.isArray(value.nodes)) {
        const nodes = value.nodes.filter(isEntry);
        return nodes.length > 0 ? { ownerId, nodes, at } : null;
    }
    return isEntry(value)
        ? { ownerId, nodes: [{ nodeId: value.nodeId, text: value.text }], at }
        : null;
};

const readAll = (): DraftMap => {
    try {
        const raw = globalThis.localStorage?.getItem(STORAGE_KEY);
        if (!raw) return {};
        const parsed: unknown = JSON.parse(raw);
        if (parsed === null || typeof parsed !== "object") return {};
        const drafts: DraftMap = {};
        for (const [studyId, value] of Object.entries(parsed)) {
            const stored = normalize(value);
            if (stored) drafts[studyId] = stored;
        }
        return drafts;
    } catch {
        return {};
    }
};

const writeAll = (drafts: DraftMap): void => {
    try {
        const kept = Object.entries(drafts)
            .sort(([, a], [, b]) => b.at - a.at)
            .slice(0, MAX_STUDIES);
        globalThis.localStorage?.setItem(STORAGE_KEY, JSON.stringify(Object.fromEntries(kept)));
    } catch {
        // 残せなくても画面は動く（入力は画面の中には残っている）。
    }
};

/**
 * ノートの下書きを読む（書いた順。最後が最も新しい）。`ownerId` がそのノートの持ち主と一致する
 * ときだけ返す（別のアカウントが書いた下書きは返さない）。
 */
export function readStudyCommentDrafts(
    studyId: string,
    ownerId: string | null,
): StudyCommentDraftEntry[] {
    const drafts = readAll();
    if (!Object.hasOwn(drafts, studyId)) return [];
    const stored = drafts[studyId];
    return stored.ownerId === ownerId ? stored.nodes.map((entry) => ({ ...entry })) : [];
}

/**
 * ある手の下書きを残す。`text` が null なら（保存できたので）消す。
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
    const sameOwner = existing !== undefined && existing.ownerId === ownerId;
    const others = sameOwner ? existing.nodes.filter((entry) => entry.nodeId !== nodeId) : [];
    if (text === null) {
        if (!sameOwner || others.length === existing.nodes.length) return;
        if (others.length === 0) delete drafts[studyId];
        else drafts[studyId] = { ...existing, nodes: others };
        writeAll(drafts);
        return;
    }
    drafts[studyId] = {
        ownerId,
        nodes: [...others, { nodeId, text }].slice(-MAX_NODES_PER_STUDY),
        at: now,
    };
    writeAll(drafts);
}
