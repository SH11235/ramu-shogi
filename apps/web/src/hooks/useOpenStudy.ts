import { useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { ensureStudySession } from "../lib/studySync";
import { useAuthSession } from "./useAuthSession";

interface UseOpenStudyResult {
    /**
     * 研究ノートを用意して（同じ棋譜のノートがあればそれを、無ければ作って）、その画面へ移る。
     * `prepare` には `lib/studyEntry` の関数（と、必要なら棋譜の取得）を渡す。用意している間に
     * 呼ばれたら何もしない。
     */
    openStudy: (prepare: () => Promise<{ studyId: string }>) => Promise<void>;
    isBusy: boolean;
    error: string | null;
}

/** 棋譜から研究ノートを開く操作。「研究ノートで開く」と、研究ノートを作る棋譜を選ぶ画面で使う。 */
export function useOpenStudy(): UseOpenStudyResult {
    const navigate = useNavigate();
    const { session, isLoadingSession, sessionError } = useAuthSession();
    const [isBusy, setIsBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const openStudy = async (prepare: () => Promise<{ studyId: string }>): Promise<void> => {
        if (isBusy) return;
        setIsBusy(true);
        setError(null);
        try {
            // ログイン中なら、クラウドにある同じ棋譜のノートも探せるよう、先にログイン状態を伝える。
            if (!isLoadingSession && session !== null) {
                await ensureStudySession(session?.authenticated ? session.user.id : null, {
                    confirmed: sessionError === null,
                });
            }
            const { studyId } = await prepare();
            await navigate({ to: "/studies/$studyId", params: { studyId } });
        } catch (failure) {
            setError(
                `研究ノートを開けませんでした: ${
                    failure instanceof Error ? failure.message : String(failure)
                }`,
            );
        } finally {
            setIsBusy(false);
        }
    };

    return { openStudy, isBusy, error };
}
