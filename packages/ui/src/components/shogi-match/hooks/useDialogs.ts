import { useCallback, useState } from "react";

/**
 * ダイアログの状態を管理する型
 */
export interface DialogStates {
    /** 設定モーダル */
    isSettingsModalOpen: boolean;
    /** NNUE 管理ダイアログ */
    isNnueManagerOpen: boolean;
    /** NNUE 管理ダイアログを開いた理由 */
    nnueManagerOpenReason: string | null;
    /** 表示設定ダイアログ */
    isDisplaySettingsOpen: boolean;
    /** About（ライセンス）ダイアログ */
    isAboutOpen: boolean;
    /** パス権設定ダイアログ */
    isPassRightsSettingsOpen: boolean;
}

/**
 * ダイアログの状態を操作するアクション
 */
export interface DialogActions {
    /** 設定モーダルを開く */
    openSettings: () => void;
    /** 設定モーダルを閉じる */
    closeSettings: () => void;
    /** 設定モーダルの開閉状態を変更 */
    setIsSettingsModalOpen: (open: boolean) => void;

    /** NNUE 管理ダイアログを開く */
    openNnueManager: (reason?: string) => void;
    /** NNUE 管理ダイアログを閉じる */
    closeNnueManager: () => void;
    /** NNUE 管理ダイアログの開閉状態を変更 */
    setIsNnueManagerOpen: (open: boolean) => void;
    /** NNUE 管理ダイアログを開いた理由をクリア */
    clearNnueManagerOpenReason: () => void;

    /** 表示設定ダイアログを開く */
    openDisplaySettings: () => void;
    /** 表示設定ダイアログを閉じる */
    closeDisplaySettings: () => void;
    /** 表示設定ダイアログの開閉状態を変更 */
    setIsDisplaySettingsOpen: (open: boolean) => void;

    /** About ダイアログを開く */
    openAbout: () => void;
    /** About ダイアログを閉じる */
    closeAbout: () => void;
    /** About ダイアログの開閉状態を変更 */
    setIsAboutOpen: (open: boolean) => void;

    /** パス権設定ダイアログを開く */
    openPassRightsSettings: () => void;
    /** パス権設定ダイアログを閉じる */
    closePassRightsSettings: () => void;
    /** パス権設定ダイアログの開閉状態を変更 */
    setIsPassRightsSettingsOpen: (open: boolean) => void;
}

/**
 * 複数のダイアログ状態を統一的に管理するフック
 *
 * @returns ダイアログの状態とアクション
 */
export function useDialogs(): DialogStates & DialogActions {
    const [isSettingsModalOpen, setIsSettingsModalOpen] = useState(false);
    const [isNnueManagerOpen, setIsNnueManagerOpen] = useState(false);
    const [nnueManagerOpenReason, setNnueManagerOpenReason] = useState<string | null>(null);
    const [isDisplaySettingsOpen, setIsDisplaySettingsOpen] = useState(false);
    const [isAboutOpen, setIsAboutOpen] = useState(false);
    const [isPassRightsSettingsOpen, setIsPassRightsSettingsOpen] = useState(false);

    const openSettings = useCallback(() => setIsSettingsModalOpen(true), []);
    const closeSettings = useCallback(() => setIsSettingsModalOpen(false), []);

    const openNnueManager = useCallback((reason?: string) => {
        setIsNnueManagerOpen(true);
        if (reason) {
            setNnueManagerOpenReason(reason);
        }
    }, []);
    const closeNnueManager = useCallback(() => {
        setIsNnueManagerOpen(false);
        setNnueManagerOpenReason(null);
    }, []);
    const clearNnueManagerOpenReason = useCallback(() => setNnueManagerOpenReason(null), []);

    const openDisplaySettings = useCallback(() => setIsDisplaySettingsOpen(true), []);
    const closeDisplaySettings = useCallback(() => setIsDisplaySettingsOpen(false), []);

    const openAbout = useCallback(() => setIsAboutOpen(true), []);
    const closeAbout = useCallback(() => setIsAboutOpen(false), []);

    const openPassRightsSettings = useCallback(() => setIsPassRightsSettingsOpen(true), []);
    const closePassRightsSettings = useCallback(() => setIsPassRightsSettingsOpen(false), []);

    return {
        // States
        isSettingsModalOpen,
        isNnueManagerOpen,
        nnueManagerOpenReason,
        isDisplaySettingsOpen,
        isAboutOpen,
        isPassRightsSettingsOpen,

        // Actions
        openSettings,
        closeSettings,
        setIsSettingsModalOpen,

        openNnueManager,
        closeNnueManager,
        setIsNnueManagerOpen,
        clearNnueManagerOpenReason,

        openDisplaySettings,
        closeDisplaySettings,
        setIsDisplaySettingsOpen,

        openAbout,
        closeAbout,
        setIsAboutOpen,

        openPassRightsSettings,
        closePassRightsSettings,
        setIsPassRightsSettingsOpen,
    };
}
