import type {
    EngineRegistration,
    EngineRegistryService,
    EngineSessionService,
    OptionValue,
} from "@shogi/engine-tauri";
import { Button } from "@shogi/ui/components/button";
import {
    Dialog,
    DialogClose,
    DialogContent,
    DialogHeader,
    DialogTitle,
} from "@shogi/ui/components/dialog";
import type { ReactElement } from "react";
import { useEffect, useRef, useState } from "react";
import { UsiOptionForm } from "./UsiOptionForm";

interface ActiveEngineSettingsPanelProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    engine: {
        registration: EngineRegistration;
        sessionId: string;
        label: string;
    } | null;
    registryService: EngineRegistryService;
    sessionService: EngineSessionService;
}

export function ActiveEngineSettingsPanel({
    open,
    onOpenChange,
    engine,
    registryService,
    sessionService,
}: ActiveEngineSettingsPanelProps): ReactElement | null {
    const [savedValues, setSavedValues] = useState<OptionValue[]>([]);
    const [currentValues, setCurrentValues] = useState<OptionValue[]>([]);
    const [applyError, setApplyError] = useState<string | null>(null);
    const [isLoading, setIsLoading] = useState(false);

    // debounce用: option名ごとにタイマーを管理
    const debounceTimers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

    // Load saved options when engine changes
    useEffect(() => {
        // engine変更時に即座にstateをリセット＋stale timerをクリア
        setSavedValues([]);
        setCurrentValues([]);
        setApplyError(null);
        for (const timer of debounceTimers.current.values()) {
            clearTimeout(timer);
        }
        debounceTimers.current.clear();

        if (!engine) {
            setIsLoading(false);
            return;
        }

        let stale = false;
        setIsLoading(true);

        registryService
            .loadOptions(engine.registration.id)
            .then((opts) => {
                if (stale) return;
                setSavedValues(opts);
                setCurrentValues(opts);
            })
            .catch((e) => {
                if (stale) return;
                console.error("Failed to load engine options:", e);
            })
            .finally(() => {
                if (stale) return;
                setIsLoading(false);
            });

        return () => {
            stale = true;
        };
    }, [engine, registryService]);

    // Cleanup debounce timers on unmount
    useEffect(() => {
        const timers = debounceTimers.current;
        return () => {
            for (const timer of timers.values()) {
                clearTimeout(timer);
            }
            timers.clear();
        };
    }, []);

    if (!engine) return null;

    const { registration, sessionId, label } = engine;

    const sendSetOption = async (name: string, value: string | number | boolean) => {
        try {
            await sessionService.setOption(sessionId, name, value);
        } catch (e) {
            setApplyError(`反映失敗: ${e instanceof Error ? e.message : String(e)}`);
        }
    };

    const handleOptionChange = (name: string, value: string | number | boolean) => {
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

        // Debounced live apply（string/spin型はキーストロークごとにIPCが飛ぶのを防止）
        const existing = debounceTimers.current.get(name);
        if (existing) clearTimeout(existing);
        const timer = setTimeout(() => {
            debounceTimers.current.delete(name);
            void sendSetOption(name, value);
        }, 300);
        debounceTimers.current.set(name, timer);
    };

    const handleButtonClick = async (name: string) => {
        setApplyError(null);
        try {
            await sessionService.sendButton(sessionId, name);
        } catch (e) {
            setApplyError(`実行失敗: ${e instanceof Error ? e.message : String(e)}`);
        }
    };

    const handleSaveAsDefault = async () => {
        await registryService.saveOptions(registration.id, currentValues);
        setSavedValues([...currentValues]);
    };

    // 対称な差分チェック
    const hasDiff =
        currentValues.some((cv) => {
            const sv = savedValues.find((s) => s.name === cv.name);
            return !sv || String(cv.value) !== String(sv.value);
        }) || savedValues.some((sv) => !currentValues.find((cv) => cv.name === sv.name));

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
                        {isLoading
                            ? "オプションを読み込み中..."
                            : "オプション変更はセッションに即時反映されます"}
                    </div>

                    {!isLoading && (
                        <>
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
                                    <span className="text-xs text-wafuu-shu">
                                        未保存の変更があります
                                    </span>
                                )}
                            </div>
                        </>
                    )}
                </div>
            </DialogContent>
        </Dialog>
    );
}
