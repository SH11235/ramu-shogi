import type {
    EngineRegistration,
    EngineRegistryService,
    OptionValue,
    PreviewSessionService,
    PreviewSessionStatus,
} from "@shogi/engine-tauri";
import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
} from "@shogi/ui/components/alert-dialog";
import { Button } from "@shogi/ui/components/button";
import { Input } from "@shogi/ui/components/input";
import { open } from "@tauri-apps/plugin-dialog";
import type { ReactElement } from "react";
import { useEffect, useRef, useState } from "react";
import { UsiOptionForm } from "./UsiOptionForm";

type RegistrationState = "idle" | "probing" | "saving" | "error";

interface EngineManagerPanelProps {
    registryService: EngineRegistryService;
    previewSessionService: PreviewSessionService;
    onEnginesChange?: (engines: EngineRegistration[]) => void;
}

function deriveDisplayName(path: string, probedName: string): string {
    if (probedName) {
        return probedName;
    }
    const basename = path.split(/[/\\]/).pop();
    return basename && basename.length > 0 ? basename : "Unknown";
}

function PreviewStatusBadge({ status }: { status: PreviewSessionStatus }): ReactElement | null {
    switch (status.state) {
        case "idle":
            return null;
        case "starting":
            return (
                <span className="text-xs text-wafuu-kincha animate-pulse">エンジン起動中...</span>
            );
        case "ready":
            return <span className="text-xs text-green-600">接続済み</span>;
        case "error":
            return <span className="text-xs text-destructive">エラー: {status.error}</span>;
    }
}

export function EngineManagerPanel({
    registryService,
    previewSessionService,
    onEnginesChange,
}: EngineManagerPanelProps): ReactElement {
    const [engines, setEngines] = useState<EngineRegistration[]>([]);
    const [state, setState] = useState<RegistrationState>("idle");
    const [errorMessage, setErrorMessage] = useState<string | null>(null);
    const [selectedEngine, setSelectedEngine] = useState<EngineRegistration | null>(null);
    const [optionValues, setOptionValues] = useState<OptionValue[]>([]);
    const [previewStatus, setPreviewStatus] = useState<PreviewSessionStatus>({ state: "idle" });
    const serviceRef = useRef(previewSessionService);
    // 非同期結果のstaleness guard: 選択中のengine.idを追跡
    const selectedEngineIdRef = useRef<string | null>(null);
    const [editName, setEditName] = useState("");
    const [deleteTarget, setDeleteTarget] = useState<string | null>(null);

    // Cleanup preview session on unmount
    useEffect(() => {
        const svc = serviceRef.current;
        return () => {
            void svc.dispose();
        };
    }, []);

    // Load engines on mount
    useEffect(() => {
        registryService.list().then((list) => {
            setEngines(list);
            onEnginesChange?.(list);
        });
    }, [registryService, onEnginesChange]);

    const refreshEngines = async () => {
        const list = await registryService.list();
        setEngines(list);
        onEnginesChange?.(list);
    };

    const handleRegister = async () => {
        setErrorMessage(null);
        const result = await open({
            multiple: false,
            directory: false,
        });

        if (!result) return;
        const path = typeof result === "string" ? result : result[0];
        if (!path) return;

        setState("probing");
        try {
            const probeResult = await registryService.probe(path);
            const displayName = deriveDisplayName(path, probeResult.name);

            setState("saving");
            const registration: EngineRegistration = {
                id: crypto.randomUUID(),
                path,
                displayName,
                author: probeResult.author,
                options: probeResult.options,
            };
            await registryService.save(registration);
            await refreshEngines();
            setState("idle");
        } catch (e) {
            setState("error");
            setErrorMessage(e instanceof Error ? e.message : String(e));
        }
    };

    const handleDeleteConfirmed = async (id: string) => {
        await registryService.delete(id);
        if (selectedEngine?.id === id) {
            await previewSessionService.dispose();
            setPreviewStatus({ state: "idle" });
            setSelectedEngine(null);
            setOptionValues([]);
        }
        setDeleteTarget(null);
        await refreshEngines();
    };

    const handleSelectEngine = async (engine: EngineRegistration) => {
        const engineId = engine.id;
        selectedEngineIdRef.current = engineId;
        setSelectedEngine(engine);
        setEditName(engine.displayName);

        const opts = await registryService.loadOptions(engineId);
        // Staleness check: 別エンジンが選択されていたら無視
        if (selectedEngineIdRef.current !== engineId) return;
        setOptionValues(opts);

        // Start preview session
        setPreviewStatus({ state: "starting", registrationId: engineId });
        try {
            await previewSessionService.start(engineId);
            if (selectedEngineIdRef.current !== engineId) return;
            setPreviewStatus(previewSessionService.getStatus());
        } catch {
            if (selectedEngineIdRef.current !== engineId) return;
            setPreviewStatus(previewSessionService.getStatus());
        }
    };

    const handleRetryPreview = async () => {
        if (!selectedEngine) return;
        setPreviewStatus({ state: "starting", registrationId: selectedEngine.id });
        try {
            await previewSessionService.start(selectedEngine.id);
            setPreviewStatus(previewSessionService.getStatus());
        } catch {
            setPreviewStatus(previewSessionService.getStatus());
        }
    };

    const handleOptionChange = async (name: string, value: string | number | boolean) => {
        if (!selectedEngine) return;
        const newValues = [...optionValues];
        const idx = newValues.findIndex((v) => v.name === name);
        if (idx >= 0) {
            newValues[idx] = { name, value };
        } else {
            newValues.push({ name, value });
        }
        setOptionValues(newValues);

        // Live apply to preview session (best-effort)
        if (previewStatus.state === "ready") {
            previewSessionService.setOption(name, value).catch(() => {
                // Live apply failed - update status
                setPreviewStatus(previewSessionService.getStatus());
            });
        }

        // Always save to persistent store
        await registryService.saveOptions(selectedEngine.id, newValues);
    };

    const handleButtonClick = async (name: string) => {
        if (previewStatus.state !== "ready") return;
        try {
            await previewSessionService.sendButton(name);
        } catch {
            setPreviewStatus(previewSessionService.getStatus());
        }
    };

    const handleRename = async (engine: EngineRegistration, newName: string) => {
        const updated = { ...engine, displayName: newName };
        await registryService.save(updated);
        await refreshEngines();
        if (selectedEngine?.id === engine.id) {
            setSelectedEngine(updated);
        }
    };

    const isPreviewReady = previewStatus.state === "ready";

    return (
        <div className="flex flex-col gap-3">
            <div className="flex items-center justify-between">
                <span className="text-sm font-semibold text-wafuu-sumi">外部エンジン管理</span>
                <Button
                    variant="outline"
                    size="sm"
                    onClick={handleRegister}
                    disabled={state === "probing" || state === "saving"}
                >
                    {state === "probing"
                        ? "検証中..."
                        : state === "saving"
                          ? "保存中..."
                          : "エンジンを追加"}
                </Button>
            </div>

            {errorMessage && (
                <div className="text-xs text-destructive bg-destructive/10 p-2 rounded">
                    {errorMessage}
                </div>
            )}

            {/* Engine list */}
            <div className="flex flex-col gap-1">
                {engines.length === 0 ? (
                    <div className="text-xs text-muted-foreground py-2">
                        登録済みの外部エンジンはありません
                    </div>
                ) : (
                    engines.map((engine) => (
                        <div
                            key={engine.id}
                            className={`flex items-center justify-between gap-2 p-2 rounded text-sm transition-colors ${
                                selectedEngine?.id === engine.id
                                    ? "bg-wafuu-kincha/10 border border-wafuu-kincha"
                                    : "hover:bg-wafuu-washi border border-transparent"
                            }`}
                        >
                            <button
                                type="button"
                                onClick={() => handleSelectEngine(engine)}
                                className="flex flex-col min-w-0 text-left cursor-pointer flex-1"
                            >
                                <span className="truncate font-medium">{engine.displayName}</span>
                                <span className="text-xs text-muted-foreground truncate">
                                    {engine.author}
                                </span>
                            </button>
                            <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => setDeleteTarget(engine.id)}
                                className="text-destructive hover:text-destructive shrink-0"
                            >
                                削除
                            </Button>
                        </div>
                    ))
                )}
            </div>

            {/* Options for selected engine */}
            {selectedEngine && (
                <div className="border-t border-wafuu-border pt-3 flex flex-col gap-2">
                    <div className="flex items-center gap-2">
                        <Input
                            type="text"
                            value={editName}
                            onChange={(e) => setEditName(e.target.value)}
                            onBlur={() => {
                                if (editName !== selectedEngine.displayName) {
                                    handleRename(selectedEngine, editName);
                                }
                            }}
                            onKeyDown={(e) => {
                                if (e.key === "Enter" && editName !== selectedEngine.displayName) {
                                    handleRename(selectedEngine, editName);
                                }
                            }}
                            className="text-sm font-semibold border border-wafuu-border bg-wafuu-washi"
                        />
                    </div>
                    <div className="flex items-center gap-2">
                        <span className="text-xs text-muted-foreground">
                            {isPreviewReady
                                ? "オプション（即時反映 + 保存）"
                                : "オプション（次回起動時に適用）"}
                        </span>
                        <PreviewStatusBadge status={previewStatus} />
                        {previewStatus.state === "error" && (
                            <Button variant="outline" size="sm" onClick={handleRetryPreview}>
                                再起動
                            </Button>
                        )}
                    </div>
                    <UsiOptionForm
                        options={selectedEngine.options}
                        values={optionValues}
                        onOptionChange={handleOptionChange}
                        onButtonClick={isPreviewReady ? handleButtonClick : undefined}
                        onResetAll={async () => {
                            const defaults: OptionValue[] = selectedEngine.options
                                .filter((o) => o.type !== "button")
                                .map((o) => ({ name: o.name, value: o.default }));
                            setOptionValues(defaults);
                            await registryService.saveOptions(selectedEngine.id, defaults);
                        }}
                    />
                </div>
            )}

            {/* 削除確認ダイアログ */}
            <AlertDialog
                open={deleteTarget !== null}
                onOpenChange={(open) => {
                    if (!open) setDeleteTarget(null);
                }}
            >
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>エンジンを削除しますか？</AlertDialogTitle>
                        <AlertDialogDescription>
                            このエンジンの登録情報とオプション設定が完全に削除されます。この操作は取り消せません。
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel>キャンセル</AlertDialogCancel>
                        <AlertDialogAction
                            onClick={() => {
                                if (deleteTarget) handleDeleteConfirmed(deleteTarget);
                            }}
                        >
                            削除
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
        </div>
    );
}
