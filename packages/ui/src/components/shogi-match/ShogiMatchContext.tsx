import type { Player } from "@shogi/app-core";
import type { ReactNode } from "react";
import { createContext, useContext } from "react";

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
     * 評価値グラフを常に出すか（折りたたみの操作を出さない）。棋譜ビューアのように、
     * グラフを隠す理由の無い画面で true にする。
     */
    evalGraphPinned: boolean;
}

const defaultConfig: ShogiMatchConfig = {
    aiIconUrl: "/ramu.jpeg",
    presetIconUrls: {},
    aiPresetKeys: {},
    kifuImportExtra: null,
    viewerMode: false,
    boardTopContent: null,
    mobileHeaderContent: null,
    evalGraphPinned: false,
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
        evalGraphPinned: config.evalGraphPinned ?? defaultConfig.evalGraphPinned,
    };
    return <ShogiMatchContext.Provider value={mergedConfig}>{children}</ShogiMatchContext.Provider>;
}
