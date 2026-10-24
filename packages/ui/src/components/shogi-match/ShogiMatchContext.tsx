import type { GameResult, Player } from "@shogi/app-core";
import type { ReactNode } from "react";
import { createContext, useContext } from "react";
import type { SoundVoice } from "../../hooks/useShogiSound";
import type { PlayHintSearchStatus } from "./hooks/usePlayHintSearch";

/**
 * 対局画面（`screen="play"`）の進み具合。
 * - setup: 対局の設定（相手・手番・時間を選んで始める）
 * - editing: 開始局面の編集（駒落ち・指定局面から指すとき）
 * - playing / paused: 対局中・一時停止中
 * - finished: 終局後（結果を出し、研究ノートでの振り返りへ誘導する）
 */
export type PlayPhase = "setup" | "editing" | "playing" | "paused" | "finished";

/** 対局画面（`screen="play"`）のレイアウトが使う状態と操作。 */
export interface PlayScreenConfig {
    phase: PlayPhase;
    /** 平手の開始局面以外（編集した局面・引き継いだ局面）から始めるか */
    isCustomStart: boolean;
    /** 前の対局を片付けている最中か（その間は、対局を始める操作を受け付けない） */
    busy: boolean;
    /** 対局を始める（設定・編集から）／再開する（一時停止から）。`notice` は始めに 1 度だけ出す知らせ */
    startMatch: (notice?: string) => void;
    /** この対局が何手目の局面から始まったか（平手・編集した局面は 0。引き継いだ棋譜はその手数） */
    startPly: number;
    /** 対局の始めに出す知らせ（振り駒の結果など）。無ければ null */
    startNotice: string | null;
    /** 開始局面の編集を開く・閉じる */
    openPositionEditor: () => void;
    closePositionEditor: () => void;
    /** 平手の開始局面に戻す */
    resetToStartpos: () => void;
    /** いまの開始局面（SFEN。平手は "startpos" のこともある） */
    startSfen: string;
    /** 開始局面を、指定の局面（駒落ちなど）に替える */
    loadStartPosition: (sfen: string) => void;
    /** 対局者の名前（人は「あなた」、AI はその名前） */
    playerNames: Record<Player, string>;
    /** 開始局面の編集中の手番（どちらから指し始めるか）と、その切り替え */
    editTurn: Player;
    setEditTurn: (turn: Player) => void;
    /** 手番側に王手がかかっているか（対局中だけ見る） */
    inCheck: boolean;
    /** 終局後・一時停止から、同じ開始局面で設定に戻る */
    newGame: () => void;
    /** 終局後に、同じ設定・同じ開始局面ですぐもう一局始める */
    rematch: () => void;
    /** いまの棋譜（指し手が無ければ局面）を研究ノートにする。できないときは null */
    openStudy: (() => void) | null;
    /** いまの局面のヒント（候補手）を求める。上限の時間まで読み、候補と読み筋を更新し続ける */
    requestHint: () => void;
    /** 止めた・上限まで読んだヒントを、その続きから読む（再開できるエンジンだけ） */
    resumeHint: () => void;
    /** ヒントの読みの状態（読んでいるか・続きを読めるか・時間・局面数） */
    hintStatus: PlayHintSearchStatus;
    /** 読みかけのヒントを止める（それまでの候補は残す） */
    stopHint: () => void;
    /** ヒントで並べる候補の数（MultiPV） */
    hintMultiPv: number;
    setHintMultiPv: (count: number) => void;
    /** この対局でヒントを求めた回数 */
    hintCount: number;
    /** 最後にヒントを求めた手数（その局面を見ている間だけ結果を出す）。求めていなければ null */
    hintPly: number | null;
    /** 設定の欄の下に出す、ほかのページへの案内（研究ノートなど）。無ければ null */
    setupFooter: ReactNode;
    /** 終局の結果（終局後だけ） */
    gameResult: GameResult | null;
    /** 終局のダイアログを出しているか（終局で開き、閉じたあとは結果の欄だけを出す） */
    resultDialogOpen: boolean;
    closeResultDialog: () => void;
}

interface ShogiMatchConfig {
    /** AIアイコンのURL */
    aiIconUrl: string;
    /** プリセットごとの AI アイコン */
    presetIconUrls: Record<string, string>;
    /** 各側で選択されている内蔵 AI のプリセット */
    aiPresetKeys: Partial<Record<Player, string | null>>;
    /** 棋譜読込の欄の下に足す操作（読み込んだ棋譜を研究ノートにする、など）。無ければ null */
    kifuImportExtra: ReactNode;
    /**
     * 棋譜を見るだけの画面（棋譜ビューア・観戦）か。true のとき、対局開始・対局再開・棋譜読込・
     * 局面編集・平手に戻すを出さない。
     */
    viewerMode: boolean;
    /**
     * PC の盤のすぐ上（対局時計の位置）に出す内容。指定すると対局時計の代わりに出る
     * （棋譜ビューアの対局者名など）。無ければ null
     */
    boardTopContent: ReactNode;
    /**
     * スマホの盤の上の 1 行（手数・反転・サウンドの行）の左側に出す内容
     * （棋譜ビューアの対局者名など）。無ければ null
     */
    mobileHeaderContent: ReactNode;
    /**
     * スマホの検討の画面で、評価値の行（「グラフ・読み筋」の隣）に足す操作
     * （棋譜ビューアの「研究ノートで開く」など）。無ければ null
     */
    mobileReviewActions: ReactNode;
    /**
     * 評価値グラフを常に出すか（折りたたみの操作を出さない）。棋譜ビューアのように、
     * グラフを隠す理由の無い画面で true にする。
     */
    evalGraphPinned: boolean;
    /** 対局画面（`screen="play"`）のときだけ入る。それ以外の画面では null */
    play: PlayScreenConfig | null;
    /** 着手音の鳴らし方（犬・通常）を選べるか。CPU 戦で犬の音源があるときだけ true */
    soundVoiceSelectable: boolean;
    /** 選んだ着手音を試しに鳴らす。無ければ null */
    previewSound: ((voice: SoundVoice) => void) | null;
}

const defaultConfig: ShogiMatchConfig = {
    aiIconUrl: "/ramu.jpeg",
    presetIconUrls: {},
    aiPresetKeys: {},
    kifuImportExtra: null,
    viewerMode: false,
    boardTopContent: null,
    mobileHeaderContent: null,
    mobileReviewActions: null,
    evalGraphPinned: false,
    play: null,
    soundVoiceSelectable: false,
    previewSound: null,
};

const ShogiMatchContext = createContext<ShogiMatchConfig>(defaultConfig);

export function useShogiMatchConfig(): ShogiMatchConfig {
    return useContext(ShogiMatchContext);
}

interface ShogiMatchProviderProps {
    config: Partial<ShogiMatchConfig>;
    children: ReactNode;
}

export function ShogiMatchProvider({ config, children }: ShogiMatchProviderProps) {
    const mergedConfig = {
        aiIconUrl: config.aiIconUrl ?? defaultConfig.aiIconUrl,
        presetIconUrls: config.presetIconUrls ?? defaultConfig.presetIconUrls,
        aiPresetKeys: config.aiPresetKeys ?? defaultConfig.aiPresetKeys,
        kifuImportExtra: config.kifuImportExtra ?? defaultConfig.kifuImportExtra,
        viewerMode: config.viewerMode ?? defaultConfig.viewerMode,
        boardTopContent: config.boardTopContent ?? defaultConfig.boardTopContent,
        mobileHeaderContent: config.mobileHeaderContent ?? defaultConfig.mobileHeaderContent,
        mobileReviewActions: config.mobileReviewActions ?? defaultConfig.mobileReviewActions,
        evalGraphPinned: config.evalGraphPinned ?? defaultConfig.evalGraphPinned,
        play: config.play ?? defaultConfig.play,
        soundVoiceSelectable: config.soundVoiceSelectable ?? defaultConfig.soundVoiceSelectable,
        previewSound: config.previewSound ?? defaultConfig.previewSound,
    };
    return <ShogiMatchContext.Provider value={mergedConfig}>{children}</ShogiMatchContext.Provider>;
}
