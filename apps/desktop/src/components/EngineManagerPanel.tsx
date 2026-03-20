import type { EngineRegistration, EngineRegistryService, OptionValue } from "@shogi/engine-tauri";
import { Button } from "@shogi/ui/components/button";
import { Input } from "@shogi/ui/components/input";
import { open } from "@tauri-apps/plugin-dialog";
import type { ReactElement } from "react";
import { useEffect, useState } from "react";
import { UsiOptionForm } from "./UsiOptionForm";

type RegistrationState = "idle" | "probing" | "saving" | "error";

interface EngineManagerPanelProps {
    registryService: EngineRegistryService;
    onEnginesChange?: (engines: EngineRegistration[]) => void;
}

function deriveDisplayName(path: string, probedName: string): string {
    if (probedName) {
        return probedName;
    }
    const basename = path.split(/[/\\]/).pop();
    return basename && basename.length > 0 ? basename : "Unknown";
}

export function EngineManagerPanel({
    registryService,
    onEnginesChange,
}: EngineManagerPanelProps): ReactElement {
    const [engines, setEngines] = useState<EngineRegistration[]>([]);
    const [state, setState] = useState<RegistrationState>("idle");
    const [errorMessage, setErrorMessage] = useState<string | null>(null);
    const [selectedEngine, setSelectedEngine] = useState<EngineRegistration | null>(null);
    const [optionValues, setOptionValues] = useState<OptionValue[]>([]);

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
            filters: [
                {
                    name: "実行ファイル",
                    extensions: ["exe", ""],
                },
            ],
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

    const handleDelete = async (id: string) => {
        await registryService.delete(id);
        if (selectedEngine?.id === id) {
            setSelectedEngine(null);
            setOptionValues([]);
        }
        await refreshEngines();
    };

    const handleSelectEngine = async (engine: EngineRegistration) => {
        setSelectedEngine(engine);
        const opts = await registryService.loadOptions(engine.id);
        setOptionValues(opts);
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
        await registryService.saveOptions(selectedEngine.id, newValues);
    };

    const handleRename = async (engine: EngineRegistration, newName: string) => {
        const updated = { ...engine, displayName: newName };
        await registryService.save(updated);
        await refreshEngines();
        if (selectedEngine?.id === engine.id) {
            setSelectedEngine(updated);
        }
    };

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
                                onClick={() => handleDelete(engine.id)}
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
                            value={selectedEngine.displayName}
                            onChange={(e) => handleRename(selectedEngine, e.target.value)}
                            className="text-sm font-semibold border border-wafuu-border bg-wafuu-washi"
                        />
                    </div>
                    <div className="text-xs text-muted-foreground">
                        オプション（次回起動時に適用）
                    </div>
                    <UsiOptionForm
                        options={selectedEngine.options}
                        values={optionValues}
                        onOptionChange={handleOptionChange}
                    />
                </div>
            )}
        </div>
    );
}
