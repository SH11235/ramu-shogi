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
}

const defaultConfig: ShogiMatchConfig = {
    aiIconUrl: "/ramu.jpeg",
    presetIconUrls: {},
    aiPresetKeys: {},
    kifuImportExtra: null,
    viewerMode: false,
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
    };
    return <ShogiMatchContext.Provider value={mergedConfig}>{children}</ShogiMatchContext.Provider>;
}
