/**
 * 研究ノートの同期エンジン（アプリで 1 つ）。
 *
 * ブラウザ内の保存（IndexedDB）、サーバーへの送信（`/api/studies`）、複数タブの調停を受け持つ。
 * 最初に使うときに作る（IndexedDB を開くのは、最初の読み書きのとき）。
 */

import { type BrowserStudySync, createBrowserStudySync, type StudySync } from "@shogi/study-client";

let instance: BrowserStudySync | null = null;

/** 研究ノートの同期エンジンを返す。 */
export const getStudySync = (): StudySync => {
    instance ??= createBrowserStudySync();
    return instance.sync;
};

/**
 * ログイン状態を同期エンジンに伝える。セッションが分かったとき・変わったときに呼ぶ。
 * ログイン中かつノートの持ち主がそのユーザーのときだけ、サーバーへ送る。
 */
export const syncStudySession = (userId: string | null): void => {
    // 同じユーザーでも毎回伝える（セッション切れ（401）のあとの再ログインで送信を再開するため）。
    getStudySync().setSession(userId === null ? null : { userId });
};

/** 同期エンジンを破棄する（テスト用）。 */
export const resetStudySyncForTest = (): void => {
    instance?.dispose();
    instance = null;
};
