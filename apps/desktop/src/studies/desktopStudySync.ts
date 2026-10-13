/**
 * 研究ノートの同期エンジン（Desktop。アプリで 1 つ）。
 *
 * Desktop にはログインの仕組みがまだ無いので、保存はこの端末の中（WebView の IndexedDB）だけ。
 * 同期エンジンには常に「未ログイン」と伝え、サーバーへは何も送らない（API は、呼ばれても
 * 「届かない」と返すだけのもの）。ノートはすべて、持ち主のいないノートとして保存される。
 * ログインとクラウド同期を足すときは、API とセッションの確認をここで差し替える。
 */

import {
    createIndexedDbStudyStore,
    createStudySync,
    type StudyApi,
    type StudySync,
} from "@shogi/study-client";

const unreachable = async () =>
    ({ ok: false, status: 0, error: { error: "NETWORK_ERROR" } }) as const;

const localOnlyApi: StudyApi = {
    list: unreachable,
    create: unreachable,
    get: unreachable,
    postOps: unreachable,
    delete: unreachable,
    limits: unreachable,
};

let instance: StudySync | null = null;

/** 研究ノートの同期エンジンを返す（最初に使うときに作る）。 */
export const getDesktopStudySync = (): StudySync => {
    if (!instance) {
        instance = createStudySync({ store: createIndexedDbStudyStore(), api: localOnlyApi });
        instance.setSession(null);
    }
    return instance;
};
