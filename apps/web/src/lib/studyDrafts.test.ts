import { beforeEach, describe, expect, it } from "vitest";
import {
    adoptStudyCommentDrafts,
    applyStudyCommentDraftChange,
    listAnonymousStudyCommentDraftIds,
    readStudyCommentDrafts,
    removeStudyCommentDrafts,
} from "./studyDrafts";

const KEY = "ramu-study-comment-drafts";
const STUDY = "study-1";
const NODE = "node-1";

const stored = (): Array<{ nodeId: string; text: string; tab: string | null }> =>
    JSON.parse(localStorage.getItem(KEY) ?? "{}")[STUDY]?.nodes ?? [];

/** 別のタブが書いた書きかけを、直接置く。 */
const putFromOtherTab = (text: string, nodeId = NODE): void => {
    const all = JSON.parse(localStorage.getItem(KEY) ?? "{}");
    const nodes = all[STUDY]?.nodes ?? [];
    all[STUDY] = {
        ownerId: null,
        at: 1,
        nodes: [...nodes, { nodeId, text, base: "", at: 1, tab: "other-tab" }],
    };
    localStorage.setItem(KEY, JSON.stringify(all));
};

describe("研究ノートのコメントの書きかけの置き場所", () => {
    beforeEach(() => {
        localStorage.clear();
    });

    it("置いた書きかけは、書き始めたときのコメントと一緒に読める。保存できた内容と同じときだけ消える", () => {
        applyStudyCommentDraftChange(STUDY, null, NODE, { type: "set", text: "A", base: "元" });
        expect(readStudyCommentDrafts(STUDY, null)).toEqual([
            { nodeId: NODE, text: "A", base: "元" },
        ]);

        // 別の内容の保存の完了（古いコメント欄からの通知）では消えない。
        applyStudyCommentDraftChange(STUDY, null, NODE, { type: "clear", savedText: "B" });
        expect(readStudyCommentDrafts(STUDY, null)).toHaveLength(1);
        applyStudyCommentDraftChange(STUDY, null, NODE, { type: "clear", savedText: "A" });
        expect(readStudyCommentDrafts(STUDY, null)).toEqual([]);
    });

    it("別のタブの、内容の違う書きかけは、この画面が同じ手に書いても・保存しても・捨てても消えない", () => {
        putFromOtherTab("別のタブの書きかけ");

        // この画面が同じ手を入力して、保存する。
        applyStudyCommentDraftChange(STUDY, null, NODE, {
            type: "set",
            text: "この画面",
            base: "",
        });
        expect(stored().map((entry) => entry.text)).toEqual(["別のタブの書きかけ", "この画面"]);
        applyStudyCommentDraftChange(STUDY, null, NODE, {
            type: "clear",
            savedText: "この画面",
        });
        expect(stored().map((entry) => entry.text)).toEqual(["別のタブの書きかけ"]);

        // この画面が書きかけを捨てても、別のタブのものは残る。
        applyStudyCommentDraftChange(STUDY, null, NODE, { type: "set", text: "捨てる", base: "" });
        applyStudyCommentDraftChange(STUDY, null, NODE, { type: "clear", savedText: null });
        expect(stored().map((entry) => entry.text)).toEqual(["別のタブの書きかけ"]);
    });

    it("開いたときに戻した書きかけは、この画面が引き継いだものとして、置き換え・破棄できる", () => {
        putFromOtherTab("前回の書きかけ");
        putFromOtherTab("別のタブがいま書いている");
        const restoredText = "前回の書きかけ";

        applyStudyCommentDraftChange(
            STUDY,
            null,
            NODE,
            { type: "set", text: "前回の書きかけの続き", base: "" },
            { restoredText },
        );
        expect(stored().map((entry) => entry.text)).toEqual([
            "別のタブがいま書いている",
            "前回の書きかけの続き",
        ]);

        applyStudyCommentDraftChange(
            STUDY,
            null,
            NODE,
            { type: "clear", savedText: null },
            { restoredText },
        );
        expect(stored().map((entry) => entry.text)).toEqual(["別のタブがいま書いている"]);
    });

    it("同じ手に複数の書きかけがあるときは、最も新しいものを戻す", () => {
        putFromOtherTab("古い");
        applyStudyCommentDraftChange(
            STUDY,
            null,
            NODE,
            { type: "set", text: "新しい", base: "" },
            { now: 100 },
        );

        expect(readStudyCommentDrafts(STUDY, null)).toEqual([
            { nodeId: NODE, text: "新しい", base: "" },
        ]);
    });

    it("別の持ち主の書きかけは読めず、消しもしない。ノートを削除したら、持ち主を問わず消える", () => {
        applyStudyCommentDraftChange(STUDY, "user-1", NODE, { type: "set", text: "A", base: "" });
        expect(readStudyCommentDrafts(STUDY, null)).toEqual([]);
        applyStudyCommentDraftChange(STUDY, null, NODE, { type: "clear", savedText: null });
        expect(readStudyCommentDrafts(STUDY, "user-1")).toHaveLength(1);

        removeStudyCommentDrafts(STUDY);
        expect(readStudyCommentDrafts(STUDY, "user-1")).toEqual([]);
        expect(localStorage.getItem(KEY)).toBe("{}");
    });

    it("引き継ぎでは、匿名の書きかけだけを（書いたタブを問わず）そのアカウントへ移す。別のアカウントの書きかけは移さない", () => {
        const OTHER = "study-2";
        const UNTOUCHED = "study-3";
        // 匿名のノートの書きかけ（別のタブと、この画面）。
        putFromOtherTab("別のタブ", "node-2");
        applyStudyCommentDraftChange(STUDY, null, NODE, {
            type: "set",
            text: "この画面",
            base: "",
        });
        // 別のアカウントの書きかけと、引き継ぎの対象でない匿名のノートの書きかけ。
        applyStudyCommentDraftChange(OTHER, "user-2", NODE, {
            type: "set",
            text: "他人",
            base: "",
        });
        applyStudyCommentDraftChange(UNTOUCHED, null, NODE, {
            type: "set",
            text: "匿名",
            base: "",
        });
        expect(listAnonymousStudyCommentDraftIds().sort()).toEqual([STUDY, UNTOUCHED]);

        adoptStudyCommentDrafts([STUDY, OTHER, "無いノート"], "user-1");

        expect(readStudyCommentDrafts(STUDY, null)).toEqual([]);
        expect(readStudyCommentDrafts(STUDY, "user-1")).toEqual([
            { nodeId: "node-2", text: "別のタブ", base: "" },
            { nodeId: NODE, text: "この画面", base: "" },
        ]);
        expect(readStudyCommentDrafts(OTHER, "user-1")).toEqual([]);
        expect(readStudyCommentDrafts(OTHER, "user-2")).toHaveLength(1);
        expect(readStudyCommentDrafts(UNTOUCHED, null)).toHaveLength(1);
        expect(listAnonymousStudyCommentDraftIds()).toEqual([UNTOUCHED]);
    });
});
