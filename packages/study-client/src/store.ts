/**
 * 研究ノートのローカル保存層のインターフェースと、メモリ上の実装。
 *
 * 画面はまずここに書き、ここから読む（ローカル優先）。保存する単位は、ノートの文書、
 * 最後にサーバーが受理したリビジョン、送信待ちの操作の列、持ち主（未ログインなら匿名）。
 *
 * 「文書の更新」と「送信待ちへの追加」を必ず同じトランザクションで行うため、書き込みは
 * `transact` の 1 本だけにしている。呼び出し側は現在の状態を受け取り、同期的に「どう書くか」を
 * 返す（IndexedDB のトランザクションは、途中で他の非同期処理を待つと閉じてしまうため）。
 */

import type { StudyDocument, StudyMeta, StudyOp, StudyOrigin } from "@shogi/app-core";

/** 保存層のレコードの形式の版。形を変えたら上げ、読み込み時に移行する。 */
export const STUDY_RECORD_VERSION = 1;

/** サーバーが送信を受け付けなかった状態。ローカルの成果は残したまま、理由を覚えておく。 */
export type StudyRemoteState =
    | { state: "ok" }
    /** 上限超過（413 / 422）。`atSeq` より新しい操作が積まれるまで再送しない。 */
    | { state: "limit_exceeded"; limit: string; atSeq: number }
    /** 入力不正など（400 / 409 `ID_CONFLICT`）。`atSeq` より新しい操作が積まれるまで再送しない。 */
    | {
          state: "rejected";
          code: string;
          message: string;
          atSeq: number;
          /**
           * 拒否された時点で、ローカルの検証（`validateStudyDocument`）は通っていたか。
           * 作成が拒否されたノートを、編集のたびに送り直さないために使う。
           */
          locallyValid?: boolean;
      }
    /** サーバー側で削除済み（410）。以後は送らない。 */
    | { state: "deleted" };

/** 送信中の操作バッチ。応答が届くまで、同じ `batchId`・同じ操作で再送する。 */
export interface StudyInflightBatch {
    batchId: string;
    expectedRevision: number;
    /** このバッチに含めた送信待ちの操作の最後の連番。 */
    lastSeq: number;
}

/** ブラウザ内に保存する研究ノート 1 件。 */
export interface StoredStudy {
    recordVersion: number;
    id: string;
    /** 持ち主のユーザー ID。未ログイン中に作ったノートは null（匿名）。 */
    owner: string | null;
    doc: StudyDocument;
    /** 最後にサーバーが受理したリビジョン。サーバーにまだ無ければ null。 */
    serverRevision: number | null;
    inflight: StudyInflightBatch | null;
    remote: StudyRemoteState;
    /** 同じ元棋譜の既存ノートに統合した場合の統合先。以後このノートは使わない。 */
    mergedInto: string | null;
    /**
     * 統合先への成果の取り込みがまだ終わっていない（`mergedInto` を付けた直後）。
     * 取り込みは文書（`doc`）から何度でもやり直せるので、途中で閉じられても失われない。
     */
    mergePending?: boolean;
    /** 削除を指示済みで、サーバーへの削除がまだ終わっていない。 */
    deleting: boolean;
    /** 元棋譜のキー（`originKey`）。同じ棋譜のノートを探すのに使う。`paste` は null。 */
    originKey: string | null;
    /** ローカルで作った時刻（Unix ミリ秒）。 */
    createdAt: number;
    /** ローカルで最後に書いた時刻（Unix ミリ秒）。 */
    updatedAt: number;
    /** サーバーが最後に受理した時刻（Unix ミリ秒）。まだなら null。 */
    lastSyncedAt: number | null;
}

/** 送信待ちの操作。`seq` は保存層の中で単調に増える連番。 */
export interface PendingStudyOp {
    seq: number;
    op: StudyOp;
}

/** 一覧用の要約（文書の本体を読まずに得られる）。 */
export interface StoredStudySummary {
    id: string;
    owner: string | null;
    title: string;
    origin: StudyOrigin;
    meta: StudyMeta;
    originKey: string | null;
    nodeCount: number;
    layerCount: number;
    /** 最も結果の多いレイヤーの件数。 */
    resultCount: number;
    serverRevision: number | null;
    remote: StudyRemoteState;
    mergedInto: string | null;
    mergePending?: boolean;
    deleting: boolean;
    pendingCount: number;
    createdAt: number;
    updatedAt: number;
    lastSyncedAt: number | null;
}

/** トランザクションの中で見える現在の状態。 */
export interface StudyStoreSnapshot {
    study: StoredStudy | null;
    /** 送信待ちの操作（連番の昇順）。 */
    pending: PendingStudyOp[];
}

/** トランザクションで行う書き込み。指定しなかった項目は変えない。 */
export interface StudyStoreWrite<T> {
    /** レコードを置き換える。null なら削除する（送信待ちの操作も消える）。 */
    study?: StoredStudy | null;
    /** 送信待ちの末尾に足す操作。 */
    appendOps?: readonly StudyOp[];
    /** この連番以下の送信待ちの操作を消す。 */
    removeOpsUpTo?: number;
    /** 呼び出し元に返す値。 */
    result: T;
}

/**
 * ノートごとの表示の状態（同期しない、このブラウザだけのもの）。
 * リロードしても表示中のレイヤーと見ていた局面が戻るようにするために保存する。
 * 項目は自由に足せる。
 */
export interface StudyViewState {
    /** 表示中の解析レイヤー。 */
    selectedLayerId?: string | null;
    /** 見ていた局面（保存用の `nodeId`）。 */
    currentNodeId?: string | null;
    [key: string]: unknown;
}

export type StudyStorageErrorCode = "unavailable" | "quota_exceeded" | "failed";

/** 保存層の失敗。黙って失わないよう、呼び出し元まで伝える。 */
export class StudyStorageError extends Error {
    readonly code: StudyStorageErrorCode;

    constructor(code: StudyStorageErrorCode, message: string, options?: { cause?: unknown }) {
        super(message, options);
        this.name = "StudyStorageError";
        this.code = code;
    }
}

export interface StudyStore {
    /** ノート 1 件と送信待ちの操作を読む。 */
    read(studyId: string): Promise<StudyStoreSnapshot>;
    /**
     * 1 つのトランザクションで読み、`mutate` が返した内容を書く。
     * `mutate` は同期関数で、例外を投げると何も書かずに失敗する。
     */
    transact<T>(
        studyId: string,
        mutate: (snapshot: StudyStoreSnapshot) => StudyStoreWrite<T>,
    ): Promise<T>;
    /** 一覧（更新が新しい順）。 */
    list(): Promise<StoredStudySummary[]>;
    /** 元棋譜のキーが一致するノートの ID（更新が新しい順）。 */
    findByOriginKey(originKey: string): Promise<string[]>;
    /** ノートの表示の状態を読む。無ければ null。（ノートを消すと一緒に消える。） */
    readViewState?(studyId: string): Promise<StudyViewState | null>;
    /** ノートの表示の状態を置き換える。 */
    writeViewState?(studyId: string, state: StudyViewState): Promise<void>;
    /** 保存層を閉じる。 */
    close(): void;
}

/** 文書から一覧用の要約を作る。 */
export function summarizeStoredStudy(study: StoredStudy, pendingCount: number): StoredStudySummary {
    return {
        id: study.id,
        owner: study.owner,
        title: study.doc.title,
        origin: study.doc.origin,
        meta: study.doc.meta,
        originKey: study.originKey,
        nodeCount: Object.keys(study.doc.tree.nodes).length,
        layerCount: study.doc.layers.length,
        resultCount: study.doc.layers.reduce(
            (max, layer) => Math.max(max, Object.keys(layer.results).length),
            0,
        ),
        serverRevision: study.serverRevision,
        remote: study.remote,
        mergedInto: study.mergedInto,
        ...(study.mergePending ? { mergePending: true } : {}),
        deleting: study.deleting,
        pendingCount,
        createdAt: study.createdAt,
        updatedAt: study.updatedAt,
        lastSyncedAt: study.lastSyncedAt,
    };
}

/** 保存できる値（構造化複製できる値）か確かめつつ複製する。 */
const clone = <T>(value: T): T => structuredClone(value);

/**
 * メモリ上の保存層。
 *
 * テストと、IndexedDB が使えない環境での一時的な受け皿に使う（リロードで消えるので、
 * 画面には「保存できていない」ことを必ず表示すること）。
 */
export function createMemoryStudyStore(): StudyStore {
    const studies = new Map<string, StoredStudy>();
    const pending = new Map<string, PendingStudyOp[]>();
    const viewStates = new Map<string, StudyViewState>();
    let nextSeq = 1;

    const snapshotOf = (studyId: string): StudyStoreSnapshot => ({
        study: clone(studies.get(studyId) ?? null),
        pending: clone(pending.get(studyId) ?? []),
    });

    return {
        async read(studyId) {
            return snapshotOf(studyId);
        },
        async transact(studyId, mutate) {
            const write = mutate(snapshotOf(studyId));
            // 書き込む値を先に複製する（複製できない値なら、何も書かずに失敗させる）。
            const study = write.study === undefined ? undefined : clone(write.study);
            const appended = clone(write.appendOps ?? []);

            if (study === null) {
                studies.delete(studyId);
                pending.delete(studyId);
                viewStates.delete(studyId);
                return write.result;
            }
            if (study !== undefined) studies.set(studyId, study);
            let queue = pending.get(studyId) ?? [];
            if (write.removeOpsUpTo !== undefined) {
                const upTo = write.removeOpsUpTo;
                queue = queue.filter((item) => item.seq > upTo);
            }
            if (appended.length > 0) {
                queue = [...queue, ...appended.map((op) => ({ seq: nextSeq++, op }))];
            }
            if (queue.length > 0) pending.set(studyId, queue);
            else pending.delete(studyId);
            return write.result;
        },
        async list() {
            return [...studies.values()]
                .map((study) => summarizeStoredStudy(study, pending.get(study.id)?.length ?? 0))
                .sort((a, b) => b.updatedAt - a.updatedAt || (a.id < b.id ? 1 : -1));
        },
        async findByOriginKey(originKey) {
            return [...studies.values()]
                .filter((study) => study.originKey === originKey)
                .sort((a, b) => b.updatedAt - a.updatedAt)
                .map((study) => study.id);
        },
        async readViewState(studyId) {
            return clone(viewStates.get(studyId) ?? null);
        },
        async writeViewState(studyId, state) {
            viewStates.set(studyId, clone(state));
        },
        close() {
            // 何もしない。
        },
    };
}
