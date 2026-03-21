import type { EngineRegistration, EngineRegistryService, OptionValue } from "@shogi/engine-tauri";
import { Button } from "@shogi/ui/components/button";
import {
    Dialog,
    DialogClose,
    DialogContent,
    DialogHeader,
    DialogTitle,
} from "@shogi/ui/components/dialog";
import { invoke as tauriInvoke } from "@tauri-apps/api/core";
import type { ReactElement } from "react";
import { useEffect, useState } from "react";
import { UsiOptionForm } from "./UsiOptionForm";

interface ActiveEngineSettingsDrawerProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    engine: {
        registration: EngineRegistration;
        sessionId: string;
        label: string;
    } | null;
    registryService: EngineRegistryService;
}

export function ActiveEngineSettingsDrawer({
    open,
    onOpenChange,
    engine,
    registryService,
}: ActiveEngineSettingsDrawerProps): ReactElement | null {
    const [savedValues, setSavedValues] = useState<OptionValue[]>([]);
    const [currentValues, setCurrentValues] = useState<OptionValue[]>([]);
    const [applyError, setApplyError] = useState<string | null>(null);

    // Load saved options when engine changes
    useEffect(() => {
        if (!engine) return;
        let stale = false;
        registryService.loadOptions(engine.registration.id).then((opts) => {
            if (stale) return;
            setSavedValues(opts);
            setCurrentValues(opts);
        });
        return () => {
            stale = true;
        };
    }, [engine, registryService]);

    if (!engine) return null;

    const { registration, sessionId, label } = engine;

    const handleOptionChange = async (name: string, value: string | number | boolean) => {
        setApplyError(null);
        // Update local state
        const newValues = [...currentValues];
        const idx = newValues.findIndex((v) => v.name === name);
        if (idx >= 0) {
            newValues[idx] = { name, value };
        } else {
            newValues.push({ name, value });
        }
        setCurrentValues(newValues);

        // Live apply to active session
        try {
            await tauriInvoke("usi_engine_setoption", {
                session_id: sessionId,
                name,
                value: String(value),
            });
        } catch (e) {
            setApplyError(`反映失敗: ${e instanceof Error ? e.message : String(e)}`);
        }
    };

    const handleButtonClick = async (name: string) => {
        setApplyError(null);
        try {
            await tauriInvoke("usi_engine_send_button", {
                session_id: sessionId,
                name,
            });
        } catch (e) {
            setApplyError(`実行失敗: ${e instanceof Error ? e.message : String(e)}`);
        }
    };

    const handleSaveAsDefault = async () => {
        await registryService.saveOptions(registration.id, currentValues);
        setSavedValues([...currentValues]);
    };

    // Check if current values differ from saved values
    const hasDiff = currentValues.some((cv) => {
        const sv = savedValues.find((s) => s.name === cv.name);
        if (!sv) return true;
        return String(cv.value) !== String(sv.value);
    });

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent
                className="fixed right-0 top-0 bottom-0 left-auto h-full w-96 max-w-full rounded-none border-l border-wafuu-border bg-wafuu-washi-warm p-0 translate-x-0 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:slide-out-to-right data-[state=open]:slide-in-from-right duration-300"
                overlayClassName="bg-black/30"
            >
                <DialogHeader className="p-4 border-b border-wafuu-border">
                    <DialogTitle className="text-sm font-semibold text-wafuu-sumi">
                        {label}
                    </DialogTitle>
                    <DialogClose className="absolute right-4 top-4 text-xs text-muted-foreground hover:text-foreground">
                        閉じる
                    </DialogClose>
                </DialogHeader>

                <div className="p-4 overflow-y-auto flex-1 flex flex-col gap-3">
                    {applyError && (
                        <div className="text-xs text-destructive bg-destructive/10 p-2 rounded">
                            {applyError}
                        </div>
                    )}

                    <div className="text-xs text-muted-foreground">
                        オプション変更はセッションに即時反映されます
                    </div>

                    <UsiOptionForm
                        options={registration.options}
                        values={currentValues}
                        onOptionChange={handleOptionChange}
                        onButtonClick={handleButtonClick}
                    />

                    <div className="border-t border-wafuu-border pt-3 flex items-center gap-2">
                        <Button
                            variant="outline"
                            size="sm"
                            onClick={handleSaveAsDefault}
                            disabled={!hasDiff}
                        >
                            デフォルトとして保存
                        </Button>
                        {hasDiff && (
                            <span className="text-xs text-wafuu-shu">未保存の変更があります</span>
                        )}
                    </div>
                </div>
            </DialogContent>
        </Dialog>
    );
}
