/**
 * 研究ノートの、まだ保存できていないコメントの入力（下書き）の置き場所。
 *
 * コメントを書いている途中でログインが切れると、ノートに保存できなくなる。また、長すぎる
 * コメントは短くするまで保存されない。どちらの入力も失わないよう、このブラウザの中
 * （localStorage）に、**ノートの持ち主と一緒に**、手ごとに残しておく。同じ持ち主として
 * ノートを開けたときだけ戻し、別のアカウントでは表示も保存もしない。
 *
 * 下書きには、書いた時刻と、**書き始めたときの保存済みのコメント**（`base`）を一緒に残す。
 * 開き直したときに保存済みのコメントがそこから変わっていたら、画面は自動では保存せず、
 * 利用者に選んでもらう（古い下書きが、新しいコメントを黙って上書きしないように）。
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
    /** 書き始めたときの保存済みのコメント。分からなければ null。 */
    base: string | null;
    /** 書いた時刻（Unix ミリ秒）。 */
    at: number;
}

/** 下書きの変化（画面のコメント欄が知らせる内容）。 */
type StudyCommentDraftChange =
    | { type: "set"; text: string; base: string }
    | {
          type: "clear";
          /** 保存できた内容。残っている下書きがこの内容と同じときだけ消す。null なら必ず消す。 */
          savedText: string | null;
      };

interface StoredDrafts {
    /** ノートの持ち主（匿名のノートは null）。 */
    ownerId: string | null;
    /** 手ごとの下書き。書いた順（最後が最も新しい）。 */
    nodes: StudyCommentDraftEntry[];
    /** 最後に書いた時刻（Unix ミリ秒）。 */
    at: number;
}

type DraftMap = Record<string, StoredDrafts>;

/** 保存してあった 1 つの手の下書きを、いまの形に直す。 */
const toEntry = (value: unknown, fallbackAt: number): StudyCommentDraftEntry | null => {
    if (value === null || typeof value !== "object") return null;
    if (!("nodeId" in value) || typeof value.nodeId !== "string") return null;
    if (!("text" in value) || typeof value.text !== "string") return null;
    return {
        nodeId: value.nodeId,
        text: value.text,
        base: "base" in value && typeof value.base === "string" ? value.base : null,
        at: "at" in value && typeof value.at === "number" ? value.at : fallbackAt,
    };
};

/** 保存してあった値を、いまの形に直す（以前は 1 つのノートに 1 つの手だけを残していた）。 */
const normalize = (value: unknown): StoredDrafts | null => {
    if (value === null || typeof value !== "object") return null;
    const ownerId = "ownerId" in value && typeof value.ownerId === "string" ? value.ownerId : null;
    const at = "at" in value && typeof value.at === "number" ? value.at : 0;
    const source = "nodes" in value && Array.isArray(value.nodes) ? value.nodes : [value];
    const nodes: StudyCommentDraftEntry[] = [];
    for (const item of source) {
        const entry = toEntry(item, at);
        if (entry) nodes.push(entry);
    }
    return nodes.length > 0 ? { ownerId, nodes, at } : null;
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
 * ある手の下書きの変化を反映する。
 *
 * 消す通知は、残っている下書きが「保存できた内容」と同じときだけ消す（画面を作り直す前の
 * コメント欄の保存があとから終わっても、そのあとに書いた新しい下書きを消さない）。
 * 別の持ち主の下書きが残っているときは、消さない（その人が戻ってきたときのために残す）。
 */
export function applyStudyCommentDraftChange(
    studyId: string,
    ownerId: string | null,
    nodeId: string,
    change: StudyCommentDraftChange,
    now: number = Date.now(),
): void {
    const drafts = readAll();
    const existing = Object.hasOwn(drafts, studyId) ? drafts[studyId] : undefined;
    const sameOwner = existing !== undefined && existing.ownerId === ownerId;
    const held = sameOwner ? existing.nodes.find((entry) => entry.nodeId === nodeId) : undefined;
    const others = sameOwner ? existing.nodes.filter((entry) => entry.nodeId !== nodeId) : [];
    if (change.type === "clear") {
        if (!sameOwner || held === undefined) return;
        if (change.savedText !== null && held.text !== change.savedText) return;
        if (others.length === 0) delete drafts[studyId];
        else drafts[studyId] = { ...existing, nodes: others };
        writeAll(drafts);
        return;
    }
    drafts[studyId] = {
        ownerId,
        nodes: [...others, { nodeId, text: change.text, base: change.base, at: now }].slice(
            -MAX_NODES_PER_STUDY,
        ),
        at: now,
    };
    writeAll(drafts);
}
