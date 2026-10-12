/**
 * 研究ノートの同期エンジン（アプリで 1 つ）。
 *
 * ブラウザ内の保存（IndexedDB）、サーバーへの送信（`/api/studies`）、複数タブの調停を受け持つ。
 * 最初に使うときに作る（IndexedDB を開くのは、最初の読み書きのとき）。
 */

import { type BrowserStudySync, createBrowserStudySync, type StudySync } from "@shogi/study-client";
import { adoptStudyCommentDrafts, listAnonymousStudyCommentDraftIds } from "./studyDrafts";

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

let adoption: { userId: string; done: Promise<void> } | null = null;

interface EnsureStudySessionOptions {
    /**
     * `userId` が、直近のログイン状態の確認で得た値か（既定は true）。
     *
     * 確認に失敗して前の値が残っているだけのとき（`useAuthSession` の `sessionError` が
     * null でないとき）は false を渡す。その値は、同期エンジンが既に知っていることより
     * 新しくないので、伝え直さない: 伝え直すと、サーバーの 401 で止めた送信（セッション切れ）を、
     * 期限切れかもしれない古いユーザーで解いてしまう。同期エンジンがまだログイン状態を
     * 知らないときだけ、残っている値を伝える。
     */
    confirmed?: boolean;
}

/**
 * 引き継ぎで持ち主が `userId` になったノートの、コメントの書きかけ（localStorage）の持ち主も
 * 同じアカウントへ移す。移さないと、引き継いだあとのノートを開いても書きかけが戻らない。
 *
 * 引き継いだノートの一覧ではなく、匿名のまま残っている書きかけの側から確かめる
 * （他のタブが先に引き継いでいた場合や、前回の引き継ぎの途中でページを離れた場合も移せる）。
 * 匿名の書きかけは、そのノートが匿名だったときにこのブラウザで書いたものなので、ノートの
 * 持ち主がいまのアカウントになっていれば、そのアカウントのもの。
 *
 * @returns すべての書きかけについて確かめられたら true。ノートを読めずに確かめられなかった
 *   書きかけが残っていたら false（「別のアカウントのノートなので移さない」とは区別する。
 *   呼び出し側は、次の機会に確かめ直す）。
 */
const adoptCommentDrafts = async (userId: string): Promise<boolean> => {
    const sync = getStudySync();
    const adopted: string[] = [];
    let complete = true;
    for (const studyId of listAnonymousStudyCommentDraftIds()) {
        try {
            // いまのアカウントから見えないノート（別のアカウントのノート）は null が返る。
            const stored = await sync.load(studyId);
            if (stored?.owner === userId) adopted.push(studyId);
        } catch (error) {
            console.error("[study] コメントの書きかけの持ち主を確かめられませんでした", error);
            complete = false;
        }
    }
    // 確かめられた分は移す。
    adoptStudyCommentDrafts(adopted, userId);
    return complete;
};

/**
 * セッションが確定したときに呼ぶ。ログイン状態を同期エンジンに伝え、ログイン中なら、
 * 未ログインのあいだにこのブラウザで作ったノートをそのアカウントに引き継ぐ（設計書 7.2）。
 *
 * 引き継ぎはアカウントごとに 1 回だけ走らせ、同じ処理を待てるよう同じ Promise を返す
 * （アプリの起動時と、研究ノートの各ページの両方から呼ばれるため）。失敗した分が残ったときは、
 * その処理が終わったあとの次の呼び出しでやり直す。
 */
export const ensureStudySession = (
    userId: string | null,
    { confirmed = true }: EnsureStudySessionOptions = {},
): Promise<void> => {
    if (!confirmed && getStudySync().getSessionStatus() !== "unknown") {
        return adoption?.done ?? Promise.resolve();
    }
    syncStudySession(userId);
    if (userId === null) {
        adoption = null;
        return Promise.resolve();
    }
    if (adoption?.userId === userId) return adoption.done;
    const done = getStudySync()
        .adoptAnonymousStudies()
        .then(
            () => undefined,
            (error: unknown) => {
                // 引き継げなくてもノートはブラウザ内に残る。次にセッションが確定したときにやり直す。
                console.error("[study] 未ログイン中のノートの引き継ぎに失敗しました", error);
                if (adoption?.done === done) adoption = null;
            },
        )
        // 一部だけ引き継げた場合も、引き継げた分の書きかけは移す。
        .then(() => adoptCommentDrafts(userId))
        .then((complete) => {
            // 確かめられなかった書きかけは、次にセッションが確定したときに確かめ直す。
            if (!complete && adoption?.done === done) adoption = null;
        });
    adoption = { userId, done };
    return done;
};

/** 同期エンジンを破棄する（テスト用）。 */
export const resetStudySyncForTest = (): void => {
    instance?.dispose();
    instance = null;
    adoption = null;
};
