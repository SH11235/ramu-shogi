/**
 * 研究ノートへの入口（Web）。
 *
 * 中身は Web / Desktop 共通の `@shogi/ui` の `studyEntry` で、ここでは Web の同期エンジン
 * （ブラウザ内の保存 + クラウド）と API、セッション切れの通知を既定として渡す。
 */

import type { KifuTree } from "@shogi/app-core";
import type { RshogiGame } from "@shogi/match-client";
import { createStudyApiClient } from "@shogi/study-client";
import {
    canOpenGameRecordAsStudy,
    createStudyFromKifuSource as createFromKifuSource,
    createStudyFromKifuTree as createFromKifuTree,
    type GameRecordForStudy,
    type OpenOrCreateStudyResult,
    openStudyFromGameRecord as openFromGameRecord,
    openStudyFromRshogiGame as openFromRshogiGame,
    openOrCreateStudy as openOrCreate,
    type StudyEntryDeps,
    type StudyImportDeps,
} from "@shogi/ui/components/study-workspace/studyEntry";
import type { StudyKifuSource } from "@shogi/ui/components/study-workspace/studyImport";
import { dispatchAuthSessionSyncEvent } from "../hooks/useAuthSession";
import { getStudySync } from "./studySync";

export { canOpenGameRecordAsStudy };

/** 渡されなかったものを、Web の既定（同期エンジン・API・セッション切れの通知）で補う。 */
const withDefaults = <T extends Partial<StudyEntryDeps>>(deps: T): T & StudyEntryDeps => ({
    ...deps,
    sync: deps.sync ?? getStudySync(),
    api: deps.api ?? createStudyApiClient(),
    onUnauthorized: deps.onUnauthorized ?? dispatchAuthSessionSyncEvent,
});

export function openOrCreateStudy(
    options: Omit<Parameters<typeof openOrCreate>[0], keyof StudyEntryDeps> &
        Partial<StudyEntryDeps>,
): Promise<OpenOrCreateStudyResult> {
    return openOrCreate(withDefaults(options));
}

export function openStudyFromRshogiGame(
    game: RshogiGame,
    deps: Partial<StudyEntryDeps> = {},
): Promise<OpenOrCreateStudyResult> {
    return openFromRshogiGame(game, withDefaults(deps));
}

export function openStudyFromGameRecord(
    game: GameRecordForStudy,
    deps: Partial<StudyEntryDeps> = {},
): Promise<OpenOrCreateStudyResult> {
    return openFromGameRecord(game, withDefaults(deps));
}

export function createStudyFromKifuSource(
    source: StudyKifuSource,
    deps: Partial<StudyImportDeps> = {},
): Promise<OpenOrCreateStudyResult> {
    return createFromKifuSource(source, withDefaults(deps));
}

export function createStudyFromKifuTree(
    tree: KifuTree,
    info: { players?: { sente?: string; gote?: string } } = {},
    deps: Partial<StudyImportDeps> = {},
): Promise<OpenOrCreateStudyResult> {
    return createFromKifuTree(tree, info, withDefaults(deps));
}

/**
 * ノートを開いたときに、本譜の最後の手の局面から見始めるようにする（このブラウザだけの表示の状態）。
 * 指した対局を研究ノートにしたとき（振り返りは終局の局面から）に使う。失敗しても、開くこと自体は妨げない。
 */
export async function openStudyAtLastMove(studyId: string): Promise<void> {
    try {
        const sync = getStudySync();
        const stored = await sync.load(studyId);
        if (!stored) return;
        const { tree } = stored.doc;
        let nodeId = tree.rootId;
        for (;;) {
            const next = tree.nodes[nodeId]?.children[0];
            if (next === undefined) break;
            nodeId = next;
        }
        if (nodeId !== tree.rootId) await sync.setViewState(studyId, { currentNodeId: nodeId });
    } catch {
        // 表示の状態を置けなくても、ノートは開始局面から開ける。
    }
}
