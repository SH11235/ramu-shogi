import { type NnueSelection, NONE_NNUE_SELECTION, type PositionState } from "@shogi/app-core";
import type { AiSupportSettings, RoomClient, Seat } from "@shogi/match-client";
import type { RefObject } from "react";
import { useEffect, useEffectEvent, useState } from "react";
import { useLazyNnueLoader } from "../../hooks/useLazyNnueLoader";
import type { AiHintMove } from "../shogi-match/components/AiHintPanel";
import type { OnlineAnalysis } from "./onlineAnalysis";

/** 解析を始めた局面。候補手の表記と読み筋の再生は、この局面から行う */
interface AnalyzedPosition {
    position: PositionState;
    turn: "b" | "w";
    ply: number;
}

interface UseOnlineAiAnalysisOptions {
    analysis?: OnlineAnalysis;
    client: RoomClient;
    seat: Seat;
    myAiSettings: AiSupportSettings["b"] | null;
    canSend: boolean;
    position: PositionState | null;
    turn: "b" | "w";
    startSfenRef: RefObject<string>;
    movesRef: RefObject<string[]>;
    appliedEventIdRef: RefObject<number>;
}

/** 対局中の AI 解析。回数制限のある席では、解析の前にサーバーへ使用を届け出る */
export function useOnlineAiAnalysis({
    analysis,
    client,
    seat,
    myAiSettings,
    canSend,
    position,
    turn,
    startSfenRef,
    movesRef,
    appliedEventIdRef,
}: UseOnlineAiAnalysisOptions) {
    const [analyzedPosition, setAnalyzedPosition] = useState<AnalyzedPosition | null>(null);
    const [pvPreviewMove, setPvPreviewMove] = useState<AiHintMove | null>(null);

    // 制限モードは use_analysis を先送信してからエンジン解析（観戦者はスキップ）
    const analysisNeedsServer = myAiSettings?.mode === "limited" && seat !== "s";

    const requestAnalysis = (): void => {
        if (!position || (analysisNeedsServer && !canSend)) return;
        if (analysisNeedsServer) {
            const ply = movesRef.current.length;
            client.consumeAnalysis({ eventId: appliedEventIdRef.current, ply });
            // analysis_used 受信後に自動で残り回数が更新される
        }
        if (analysis) {
            setAnalyzedPosition({ position, turn, ply: movesRef.current.length });
            void analysis.startAnalysis(startSfenRef.current, movesRef.current);
        }
    };

    const [nnueSelection, setNnueSelection] = useState<NnueSelection>(NONE_NNUE_SELECTION);
    const { resolveNnue } = useLazyNnueLoader();

    const loadNnueEvent = useEffectEvent((sel: NnueSelection) => {
        if (!analysis?.loadNnue) return;
        resolveNnue(sel)
            .then((resolved) =>
                analysis.loadNnue?.(resolved?.nnueId ?? null, resolved?.layerStacks),
            )
            .catch(console.error);
    });
    useEffect(() => {
        loadNnueEvent(nnueSelection);
    }, [nnueSelection]);

    return {
        analysisNeedsServer,
        requestAnalysis,
        analyzedPosition,
        pvPreviewMove,
        setPvPreviewMove,
        nnueSelection,
        setNnueSelection,
    };
}
