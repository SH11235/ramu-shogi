import { afterEach, describe, expect, it } from "vitest";
import { getStudySync, resetStudySyncForTest, syncStudySession } from "./studySync";

describe("studySync", () => {
    afterEach(() => {
        resetStudySyncForTest();
    });

    it("アプリで 1 つの同期エンジンを使い回す", () => {
        const sync = getStudySync();
        expect(getStudySync()).toBe(sync);
        resetStudySyncForTest();
        expect(getStudySync()).not.toBe(sync);
    });

    it("ログイン状態を同期エンジンに伝える", () => {
        expect(getStudySync().getSession()).toBeNull();
        syncStudySession("user-1");
        expect(getStudySync().getSession()).toEqual({ userId: "user-1" });
        syncStudySession("user-1");
        expect(getStudySync().getSession()).toEqual({ userId: "user-1" });
        syncStudySession(null);
        expect(getStudySync().getSession()).toBeNull();
    });

    it("読み込む前のノートの保存の状態は「ブラウザ内」", () => {
        expect(getStudySync().getStatus("unknown")).toMatchObject({
            state: "local",
            pendingCount: 0,
        });
    });
});
