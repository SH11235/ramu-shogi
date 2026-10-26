import type { NnueSelection } from "@shogi/app-core";
import { NONE_NNUE_SELECTION } from "@shogi/app-core";
import { useEffect, useEffectEvent, useState } from "react";
import type { EngineOption, SideSetting } from "../types";

/**
 * 解析に使う評価関数。対局画面（`isPlayScreen`）のヒントでは利用者に選ばせず、準備の済んでいるものを使う:
 * 相手の AI（内蔵エンジン）の評価関数、無ければ解析用に選んであるもの。どちらも未ダウンロードなら
 * 簡易 AI（駒得）で出す（ヒントのためだけにダウンロードを求めない）。ほかの画面は解析用に選んであるもの。
 */
export function usePlayHintNnueSelection({
    isPlayScreen,
    sides,
    engineOptions,
    senteNnueSelection,
    goteNnueSelection,
    analysisNnueSelection,
    resolveNnue,
    nnueCount,
}: {
    isPlayScreen: boolean;
    sides: { sente: SideSetting; gote: SideSetting };
    engineOptions: EngineOption[];
    senteNnueSelection: NnueSelection;
    goteNnueSelection: NnueSelection;
    analysisNnueSelection: NnueSelection;
    resolveNnue: (selection: NnueSelection) => Promise<unknown>;
    /** 評価関数の一覧の数（ダウンロードが済んだら確かめ直す）。 */
    nnueCount: number;
}): NnueSelection {
    const [playHintSelection, setPlayHintSelection] = useState<NnueSelection>(NONE_NNUE_SELECTION);
    const hintCandidate: NnueSelection = (() => {
        for (const side of ["gote", "sente"] as const) {
            const setting = sides[side];
            if (setting.role !== "engine") continue;
            const engine =
                engineOptions.find((option) => option.id === setting.engineId) ?? engineOptions[0];
            if (engine && engine.kind !== "external") {
                return side === "sente" ? senteNnueSelection : goteNnueSelection;
            }
        }
        return analysisNnueSelection;
    })();
    const hintCandidateKey = `${hintCandidate.presetKey ?? ""}|${hintCandidate.nnueId ?? ""}`;
    const resolveHintCandidate = useEffectEvent(async () => {
        try {
            await resolveNnue(hintCandidate);
            return hintCandidate;
        } catch {
            return NONE_NNUE_SELECTION;
        }
    });
    // biome-ignore lint/correctness/useExhaustiveDependencies: 候補が変わったとき・評価関数の一覧が変わったとき（ダウンロード完了）に確かめ直す
    useEffect(() => {
        if (!isPlayScreen) return;
        let cancelled = false;
        void resolveHintCandidate().then((selection) => {
            if (!cancelled) setPlayHintSelection(selection);
        });
        return () => {
            cancelled = true;
        };
    }, [isPlayScreen, hintCandidateKey, nnueCount]);
    return isPlayScreen ? playHintSelection : analysisNnueSelection;
}
