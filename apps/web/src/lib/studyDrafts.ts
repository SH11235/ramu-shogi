/**
 * 研究ノートの、まだ保存できていないコメントの入力（書きかけ）の置き場所。
 *
 * コメントを書いている途中でログインが切れると、ノートに保存できなくなる。また、長すぎる
 * コメントは短くするまで保存されない。どちらの入力も失わないよう、このブラウザの中
 * （localStorage）に、**ノートの持ち主と一緒に**、手ごとに残しておく。同じ持ち主として
 * ノートを開けたときだけ戻し、別のアカウントでは表示も保存もしない。
 *
 * 書きかけには、書いた時刻と、**書き始めたときの保存済みのコメント**（`base`）を一緒に残す。
 * 開き直したときに保存済みのコメントがそこから変わっていたら、画面は自動では保存せず、
 * 利用者に選んでもらう（古い書きかけが、新しいコメントを黙って上書きしないように）。
 *
 * localStorage は同じブラウザのタブで共有される。同じ手の書きかけを 2 つのタブが持つことが
 * あるので、書きかけは「どの画面（タブ）が書いたか」（`tab`）ごとに別に持つ。あるタブが自分の
 * 書きかけを置いても・消しても、別のタブの、内容の違う書きかけは消えない。
 *
 * 表示状態の保存口（`setViewState`）は、ノートが見えない間は書き込めないので使えない。
 */

const STORAGE_KEY = "ramu-study-comment-drafts";
/** 残しておくノートの数（新しい順）。 */
const MAX_STUDIES = 20;
/** 1 つのノートで残しておく書きかけの数（新しい順）。 */
const MAX_DRAFTS_PER_STUDY = 12;

/** この画面（タブ）の印。ページを読み込むたびに変わる。 */
const TAB_ID =
    typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
        ? crypto.randomUUID()
        : `tab-${Date.now()}-${Math.random()}`;

/** ある手の書きかけ。 */
interface StudyCommentDraftEntry {
    /** コメントを書いていた手（保存用の `nodeId`）。 */
    nodeId: string;
    text: string;
    /** 書き始めたときの保存済みのコメント。分からなければ null。 */
    base: string | null;
    /** 書いた時刻（Unix ミリ秒）。 */
    at: number;
    /** 書いた画面（タブ）。分からなければ null（以前の形で残っていたもの）。 */
    tab: string | null;
}

/** 書きかけの変化（画面のコメント欄が知らせる内容）。 */
type StudyCommentDraftChange =
    | { type: "set"; text: string; base: string | null }
    | {
          type: "clear";
          /** 保存できた内容。その内容の書きかけだけを消す。null なら、この画面の書きかけを消す。 */
          savedText: string | null;
      };

interface StoredDrafts {
    /** ノートの持ち主（匿名のノートは null）。 */
    ownerId: string | null;
    /** 書きかけ。書いた順（最後が最も新しい）。同じ手に、別の画面の書きかけがあることがある。 */
    nodes: StudyCommentDraftEntry[];
    /** 最後に書いた時刻（Unix ミリ秒）。 */
    at: number;
}

type DraftMap = Record<string, StoredDrafts>;

/** 保存してあった 1 つの書きかけを、いまの形に直す。 */
const toEntry = (value: unknown, fallbackAt: number): StudyCommentDraftEntry | null => {
    if (value === null || typeof value !== "object") return null;
    if (!("nodeId" in value) || typeof value.nodeId !== "string") return null;
    if (!("text" in value) || typeof value.text !== "string") return null;
    return {
        nodeId: value.nodeId,
        text: value.text,
        base: "base" in value && typeof value.base === "string" ? value.base : null,
        at: "at" in value && typeof value.at === "number" ? value.at : fallbackAt,
        tab: "tab" in value && typeof value.tab === "string" ? value.tab : null,
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
 * ノートの書きかけを読む（手ごとに、最も新しいものを 1 つ。書いた順で、最後が最も新しい）。
 * `ownerId` がそのノートの持ち主と一致するときだけ返す（別のアカウントが書いた書きかけは
 * 返さない）。
 */
export function readStudyCommentDrafts(
    studyId: string,
    ownerId: string | null,
): Array<{ nodeId: string; text: string; base: string | null }> {
    const drafts = readAll();
    if (!Object.hasOwn(drafts, studyId)) return [];
    const stored = drafts[studyId];
    if (stored.ownerId !== ownerId) return [];
    const latest = new Map<string, StudyCommentDraftEntry>();
    for (const entry of stored.nodes) {
        const known = latest.get(entry.nodeId);
        if (!known || entry.at >= known.at) latest.set(entry.nodeId, entry);
    }
    return [...latest.values()]
        .sort((a, b) => a.at - b.at)
        .map(({ nodeId, text, base }) => ({ nodeId, text, base }));
}

/**
 * ある手の書きかけの変化を反映する。
 *
 * - 置く: この画面の書きかけを置き換える。`restoredText` は、この画面がノートを開いたときに
 *   戻した書きかけの内容（あれば）。その書きかけは、この画面が引き継いだものとして置き換える。
 *   別の画面の、内容の違う書きかけは残す。
 * - 消す（保存できた）: 保存できた内容と同じ書きかけだけを消す（画面を作り直す前のコメント欄の
 *   保存があとから終わっても、そのあとに書いた新しい書きかけを消さない。別の画面の、内容の違う
 *   書きかけも消さない）。
 * - 消す（捨てた）: この画面の書きかけ（と、この画面が戻した書きかけ）を消す。
 *
 * 別の持ち主の書きかけが残っているときは、消さない（その人が戻ってきたときのために残す）。
 */
export function applyStudyCommentDraftChange(
    studyId: string,
    ownerId: string | null,
    nodeId: string,
    change: StudyCommentDraftChange,
    options: { restoredText?: string | null; now?: number } = {},
): void {
    const now = options.now ?? Date.now();
    const restoredText = options.restoredText ?? null;
    const drafts = readAll();
    const existing = Object.hasOwn(drafts, studyId) ? drafts[studyId] : undefined;
    const sameOwner = existing !== undefined && existing.ownerId === ownerId;
    const current = sameOwner ? existing.nodes : [];
    /** この画面のもの（この画面が書いた・この画面が開いたときに戻した）か。 */
    const isOurs = (entry: StudyCommentDraftEntry): boolean =>
        entry.nodeId === nodeId &&
        (entry.tab === TAB_ID || (restoredText !== null && entry.text === restoredText));

    if (change.type === "clear") {
        if (!sameOwner) return;
        const kept = current.filter((entry) =>
            change.savedText === null
                ? !isOurs(entry)
                : !(entry.nodeId === nodeId && entry.text === change.savedText),
        );
        if (kept.length === current.length) return;
        if (kept.length === 0) delete drafts[studyId];
        else drafts[studyId] = { ...existing, nodes: kept };
        writeAll(drafts);
        return;
    }
    const others = current.filter(
        (entry) => !isOurs(entry) && !(entry.nodeId === nodeId && entry.text === change.text),
    );
    drafts[studyId] = {
        ownerId,
        nodes: [
            ...others,
            { nodeId, text: change.text, base: change.base, at: now, tab: TAB_ID },
        ].slice(-MAX_DRAFTS_PER_STUDY),
        at: now,
    };
    writeAll(drafts);
}

/** ノートを削除したとき、そのノートの書きかけも消す（持ち主を問わない）。 */
export function removeStudyCommentDrafts(studyId: string): void {
    const drafts = readAll();
    if (!Object.hasOwn(drafts, studyId)) return;
    delete drafts[studyId];
    writeAll(drafts);
}
