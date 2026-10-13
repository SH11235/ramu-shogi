import type { ReactElement } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "../../dialog";
import { Switch } from "../../switch";
import type { PassRightsSettings } from "../types";

interface PassRightsSettingsDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    passRightsSettings: PassRightsSettings;
    onChange: (settings: PassRightsSettings) => void;
    /** 対局中など、変更を受け付けないとき */
    settingsLocked: boolean;
}

/** 変則ルール（パス権）の設定ダイアログ。 */
export function PassRightsSettingsDialog({
    open,
    onOpenChange,
    passRightsSettings,
    onChange,
    settingsLocked,
}: PassRightsSettingsDialogProps): ReactElement {
    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="w-[min(400px,calc(100%-24px))]">
                <DialogHeader>
                    <DialogTitle>変則ルール</DialogTitle>
                </DialogHeader>
                <div className="flex flex-col gap-4 pt-2">
                    {/* パス権セクション */}
                    <div className="flex flex-col gap-3 p-3 rounded-lg border border-wafuu-border bg-wafuu-washi/50">
                        <div className="flex items-center justify-between">
                            <span className="text-sm font-medium">パス権</span>
                            <Switch
                                id="pass-rights-toggle"
                                checked={passRightsSettings.enabled}
                                onCheckedChange={(checked) =>
                                    onChange({
                                        ...passRightsSettings,
                                        enabled: checked,
                                    })
                                }
                                disabled={settingsLocked}
                            />
                        </div>
                        <p className="text-xs text-muted-foreground">
                            王手されていない時に手番をパスできます
                        </p>

                        {/* 初期パス権数（先手・後手別） */}
                        <div
                            className={`flex flex-col gap-2 ${!passRightsSettings.enabled ? "opacity-50" : ""}`}
                        >
                            <span className="text-sm">初期パス権数</span>
                            {/* 先手/後手ラベル */}
                            <div className="grid grid-cols-2 gap-3">
                                <div className="text-xs font-semibold text-wafuu-shu text-center">
                                    ☗先手
                                </div>
                                <div className="text-xs font-semibold text-wafuu-ai text-center">
                                    ☖後手
                                </div>
                            </div>
                            {/* 先手/後手パス権数設定 */}
                            <div className="grid grid-cols-2 gap-3">
                                {/* 先手 */}
                                <div className="flex items-center justify-center gap-1">
                                    <button
                                        type="button"
                                        onClick={() =>
                                            onChange({
                                                ...passRightsSettings,
                                                senteInitialCount: Math.max(
                                                    0,
                                                    passRightsSettings.senteInitialCount - 1,
                                                ),
                                            })
                                        }
                                        disabled={
                                            settingsLocked ||
                                            !passRightsSettings.enabled ||
                                            passRightsSettings.senteInitialCount <= 0
                                        }
                                        className="flex h-8 w-8 items-center justify-center rounded border border-border bg-card text-sm disabled:opacity-50"
                                    >
                                        -
                                    </button>
                                    <span className="w-8 text-center text-sm font-semibold">
                                        {passRightsSettings.senteInitialCount}
                                    </span>
                                    <button
                                        type="button"
                                        onClick={() =>
                                            onChange({
                                                ...passRightsSettings,
                                                senteInitialCount: Math.min(
                                                    10,
                                                    passRightsSettings.senteInitialCount + 1,
                                                ),
                                            })
                                        }
                                        disabled={
                                            settingsLocked ||
                                            !passRightsSettings.enabled ||
                                            passRightsSettings.senteInitialCount >= 10
                                        }
                                        className="flex h-8 w-8 items-center justify-center rounded border border-border bg-card text-sm disabled:opacity-50"
                                    >
                                        +
                                    </button>
                                </div>
                                {/* 後手 */}
                                <div className="flex items-center justify-center gap-1">
                                    <button
                                        type="button"
                                        onClick={() =>
                                            onChange({
                                                ...passRightsSettings,
                                                goteInitialCount: Math.max(
                                                    0,
                                                    passRightsSettings.goteInitialCount - 1,
                                                ),
                                            })
                                        }
                                        disabled={
                                            settingsLocked ||
                                            !passRightsSettings.enabled ||
                                            passRightsSettings.goteInitialCount <= 0
                                        }
                                        className="flex h-8 w-8 items-center justify-center rounded border border-border bg-card text-sm disabled:opacity-50"
                                    >
                                        -
                                    </button>
                                    <span className="w-8 text-center text-sm font-semibold">
                                        {passRightsSettings.goteInitialCount}
                                    </span>
                                    <button
                                        type="button"
                                        onClick={() =>
                                            onChange({
                                                ...passRightsSettings,
                                                goteInitialCount: Math.min(
                                                    10,
                                                    passRightsSettings.goteInitialCount + 1,
                                                ),
                                            })
                                        }
                                        disabled={
                                            settingsLocked ||
                                            !passRightsSettings.enabled ||
                                            passRightsSettings.goteInitialCount >= 10
                                        }
                                        className="flex h-8 w-8 items-center justify-center rounded border border-border bg-card text-sm disabled:opacity-50"
                                    >
                                        +
                                    </button>
                                </div>
                            </div>
                        </div>

                        {/* パス確認ダイアログしきい値 */}
                        <div
                            className={`flex flex-col gap-2 ${!passRightsSettings.enabled ? "opacity-50" : ""}`}
                        >
                            <span className="text-sm">パス確認ダイアログしきい値（ms）</span>
                            <div className="flex items-center gap-2">
                                <input
                                    type="number"
                                    min={0}
                                    step={500}
                                    value={passRightsSettings.confirmDialogThresholdMs}
                                    onChange={(e) =>
                                        onChange({
                                            ...passRightsSettings,
                                            confirmDialogThresholdMs: Math.max(
                                                0,
                                                Number(e.target.value) || 0,
                                            ),
                                        })
                                    }
                                    disabled={settingsLocked || !passRightsSettings.enabled}
                                    className="w-28 rounded border border-border bg-card px-2 py-1 text-sm disabled:opacity-50"
                                />
                                <span className="text-xs text-muted-foreground">
                                    0で即時、時間が多ければ確認
                                </span>
                            </div>
                        </div>
                    </div>
                </div>
            </DialogContent>
        </Dialog>
    );
}
