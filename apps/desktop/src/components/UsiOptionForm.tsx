import type { OptionValue, UsiOptionDef } from "@shogi/engine-tauri";
import { Button } from "@shogi/ui/components/button";
import { Input } from "@shogi/ui/components/input";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@shogi/ui/components/select";
import { Switch } from "@shogi/ui/components/switch";
import { open } from "@tauri-apps/plugin-dialog";
import type { ReactElement } from "react";

interface UsiOptionFormProps {
    options: UsiOptionDef[];
    values: OptionValue[];
    onOptionChange: (name: string, value: string | number | boolean) => void;
    onButtonClick?: (name: string) => void;
}

function getOptionValue(
    values: OptionValue[],
    name: string,
): string | number | boolean | undefined {
    return values.find((v) => v.name === name)?.value;
}

function isModified(opt: UsiOptionDef, values: OptionValue[]): boolean {
    const current = getOptionValue(values, opt.name);
    if (current === undefined) return false;
    switch (opt.type) {
        case "check":
            return current !== opt.default;
        case "spin":
            return Number(current) !== opt.default;
        case "combo":
        case "string":
        case "filename":
            return String(current) !== opt.default;
        case "button":
            return false;
    }
}

export function UsiOptionForm({
    options,
    values,
    onOptionChange,
    onButtonClick,
}: UsiOptionFormProps): ReactElement {
    const handleReset = () => {
        for (const opt of options) {
            if (opt.type === "button") continue;
            onOptionChange(opt.name, opt.default);
        }
    };

    return (
        <div className="flex flex-col gap-2">
            {options.map((opt) => (
                <OptionRow
                    key={opt.name}
                    option={opt}
                    values={values}
                    onOptionChange={onOptionChange}
                    onButtonClick={onButtonClick}
                />
            ))}
            {options.length > 0 && (
                <Button
                    variant="outline"
                    size="sm"
                    onClick={handleReset}
                    className="mt-2 self-start"
                >
                    デフォルトに戻す
                </Button>
            )}
        </div>
    );
}

function OptionRow({
    option: opt,
    values,
    onOptionChange,
    onButtonClick,
}: {
    option: UsiOptionDef;
    values: OptionValue[];
    onOptionChange: (name: string, value: string | number | boolean) => void;
    onButtonClick?: (name: string) => void;
}): ReactElement {
    const modified = isModified(opt, values);
    const labelClass = `text-xs ${modified ? "text-wafuu-shu font-semibold" : "text-muted-foreground"}`;

    switch (opt.type) {
        case "check": {
            const val = getOptionValue(values, opt.name);
            const checked = val !== undefined ? Boolean(val) : opt.default;
            return (
                <div className="flex items-center justify-between gap-2">
                    <span className={labelClass}>{opt.name}</span>
                    <Switch
                        checked={checked}
                        onCheckedChange={(v) => onOptionChange(opt.name, v)}
                    />
                </div>
            );
        }
        case "spin": {
            const val = getOptionValue(values, opt.name);
            const num = val !== undefined ? Number(val) : opt.default;
            return (
                <div className="flex items-center justify-between gap-2">
                    <span className={labelClass}>{opt.name}</span>
                    <Input
                        type="number"
                        min={opt.min}
                        max={opt.max}
                        value={num}
                        onChange={(e) => {
                            const n = Number(e.target.value);
                            if (!Number.isNaN(n)) {
                                onOptionChange(opt.name, Math.max(opt.min, Math.min(opt.max, n)));
                            }
                        }}
                        className="w-24 text-xs border border-wafuu-border bg-wafuu-washi"
                    />
                </div>
            );
        }
        case "combo": {
            const val = getOptionValue(values, opt.name);
            const current = val !== undefined ? String(val) : opt.default;
            return (
                <div className="flex items-center justify-between gap-2">
                    <span className={labelClass}>{opt.name}</span>
                    <Select value={current} onValueChange={(v) => onOptionChange(opt.name, v)}>
                        <SelectTrigger className="w-32 text-xs">
                            <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                            {opt.vars.map((v) => (
                                <SelectItem key={v} value={v}>
                                    {v}
                                </SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                </div>
            );
        }
        case "string": {
            const val = getOptionValue(values, opt.name);
            const current = val !== undefined ? String(val) : opt.default;
            return (
                <div className="flex items-center justify-between gap-2">
                    <span className={labelClass}>{opt.name}</span>
                    <Input
                        type="text"
                        value={current}
                        onChange={(e) => onOptionChange(opt.name, e.target.value)}
                        className="w-40 text-xs border border-wafuu-border bg-wafuu-washi"
                    />
                </div>
            );
        }
        case "filename": {
            const val = getOptionValue(values, opt.name);
            const current = val !== undefined ? String(val) : opt.default;
            return (
                <div className="flex items-center justify-between gap-2">
                    <span className={labelClass}>{opt.name}</span>
                    <div className="flex items-center gap-2">
                        <Input
                            type="text"
                            value={current}
                            onChange={(e) => onOptionChange(opt.name, e.target.value)}
                            className="w-40 text-xs border border-wafuu-border bg-wafuu-washi"
                        />
                        <Button
                            variant="outline"
                            size="sm"
                            onClick={() => {
                                void open({ multiple: false, directory: false }).then((result) => {
                                    if (typeof result === "string") {
                                        onOptionChange(opt.name, result);
                                    }
                                });
                            }}
                        >
                            選択
                        </Button>
                    </div>
                </div>
            );
        }
        case "button": {
            return (
                <div className="flex items-center justify-between gap-2">
                    <span className={labelClass}>{opt.name}</span>
                    <Button
                        variant="outline"
                        size="sm"
                        disabled={!onButtonClick}
                        onClick={() => onButtonClick?.(opt.name)}
                        title={onButtonClick ? undefined : "エンジン起動中に使用可能"}
                    >
                        実行
                    </Button>
                </div>
            );
        }
    }
}
