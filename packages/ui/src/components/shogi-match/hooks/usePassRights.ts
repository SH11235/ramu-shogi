import type { PositionState } from "@shogi/app-core";
import { useEffect, useState } from "react";
import type { PassDisabledReason } from "../components/PassButton";
import type { PassRightsSettings } from "../types";
import type { LegalMoveCache } from "../utils/legalMoveCache";
import { buildPassRightsOptionForLegalMoves } from "../utils/passRightsSettings";

/**
 * usePassRights の戻り値の型
 */
export interface UsePassRightsResult {
    // 状態
    canPassLegal: boolean;
    hasPassRights: boolean;
    passLegalKnown: boolean;
    canMakePassMove: boolean;
    shouldRenderPassButton: boolean;
    passButtonDisabledReason: PassDisabledReason | undefined;
    shouldShowPassConfirm: boolean;

    // アクション
    setCanPassLegal: (canPass: boolean) => void;
    ensurePassRightsInitialized: () => { sente: number; gote: number } | null;
    getPassRightsOption: () => { passRights?: { sente: number; gote: number } };
}

/**
 * パス権関連の状態管理と初期化を行うフック
 *
 * @param deps - 依存するプロパティとコールバック
 * @returns パス権の状態とアクション
 */
export function usePassRights(deps: {
    /** パス権設定 */
    passRightsSettings: PassRightsSettings | null;
    /** 現在の局面状態（ref経由で取得） */
    positionRef: React.RefObject<PositionState>;
    /** 局面状態を更新する関数 */
    setPosition: (pos: PositionState) => void;
    /** 対局中かどうか */
    isMatchRunning: boolean;
    /** 指し手履歴（合法手取得用） */
    moves: string[];
    /** 合法手キャッシュ */
    legalCache: LegalMoveCache;
    /** 現在の手番のプレイヤー設定 */
    currentTurnRole: "human" | "engine";
    /** 残り時間を取得する関数 */
    getRemainingTimeMs: (player: "sente" | "gote") => number;
}): UsePassRightsResult {
    const {
        passRightsSettings,
        positionRef,
        setPosition,
        isMatchRunning,
        moves,
        legalCache,
        currentTurnRole,
        getRemainingTimeMs,
    } = deps;

    // パスが合法かどうかのキャッシュ状態
    const [canPassLegal, setCanPassLegal] = useState(false);

    /**
     * パス権を初期化（未設定時のみ）
     * @returns 初期化後のパス権、または既存のパス権
     */
    const ensurePassRightsInitialized = () => {
        if (!passRightsSettings?.enabled) return null;
        if (positionRef.current?.passRights) return positionRef.current.passRights;

        const rights = {
            sente: passRightsSettings.senteInitialCount,
            gote: passRightsSettings.goteInitialCount,
        };
        const updated = { ...positionRef.current, passRights: rights };
        setPosition(updated);
        positionRef.current = updated;
        return rights;
    };

    /**
     * 合法手取得用のパス権オプションを返す
     * build_position（Rust側）はパス権を設定してからmovesを適用するため、
     * 現在のパス権ではなく初期パス権を渡す必要がある（二重消費を防ぐため）
     */
    const getPassRightsOption = (): {
        passRights?: { sente: number; gote: number };
    } => {
        if (!passRightsSettings) return {};
        return buildPassRightsOptionForLegalMoves(passRightsSettings, moves);
    };

    // パス権が有効なら、不足時に初期化しておく
    // biome-ignore lint/correctness/useExhaustiveDependencies: React Compiler が ensurePassRightsInitialized をメモ化するため deps に追加不要
    useEffect(() => {
        if (!passRightsSettings?.enabled) return;
        ensurePassRightsInitialized();
    }, [passRightsSettings?.enabled]);

    // パス権の有無
    const position = positionRef.current;
    const hasPassRights = !!(position?.passRights && position.passRights[position.turn] > 0);

    // パス合法可否が計算済みか
    const passLegalKnown = legalCache.isCached(moves.length);

    // パス可能かどうかの判定（合法手キャッシュに"pass"が含まれるかでのみ判定）
    // 判定前は楽観的に true とし、実際の適用時に再チェックする
    const canMakePassMove =
        isMatchRunning &&
        currentTurnRole === "human" &&
        !!hasPassRights &&
        (passLegalKnown ? canPassLegal : true);

    // ボタン表示可否（対局中でパス機能が有効な場合に表示）
    // パス権が0でも表示（レイアウトシフト防止）。非活性理由はdisabledReasonで管理。
    const shouldRenderPassButton = !!(
        isMatchRunning &&
        passRightsSettings?.enabled &&
        (passRightsSettings.senteInitialCount > 0 || passRightsSettings.goteInitialCount > 0) &&
        position?.passRights
    );

    // パスボタンの非活性理由
    const passButtonDisabledReason: PassDisabledReason | undefined = (() => {
        if (!isMatchRunning) return "match-not-running";
        if (currentTurnRole !== "human") return "not-your-turn";
        if (!hasPassRights) return "no-rights";
        if (passLegalKnown && !canPassLegal) return "in-check";
        return undefined;
    })();

    // パス確認ダイアログを表示するかどうか
    const shouldShowPassConfirm =
        passButtonDisabledReason === undefined &&
        position &&
        getRemainingTimeMs(position.turn) <
            (passRightsSettings?.confirmDialogThresholdMs ?? Infinity);

    return {
        // 状態
        canPassLegal,
        hasPassRights,
        passLegalKnown,
        canMakePassMove,
        shouldRenderPassButton,
        passButtonDisabledReason,
        shouldShowPassConfirm,

        // アクション
        setCanPassLegal,
        ensurePassRightsInitialized,
        getPassRightsOption,
    };
}
