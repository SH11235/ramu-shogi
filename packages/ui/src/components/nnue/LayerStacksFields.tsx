import {
    encodeProgressCoefficients,
    type LayerStacksConfig,
    PROGRESS_COEFFICIENTS_SIZE,
} from "@shogi/app-core";
import { useId, useState } from "react";
import { Input } from "../input";

export function LayerStacksFields({
    value,
    onChange,
    onLoadingChange,
}: {
    value?: LayerStacksConfig;
    onChange: (value: LayerStacksConfig | undefined) => void;
    onLoadingChange?: (loading: boolean) => void;
}) {
    const id = useId();
    const [error, setError] = useState<string | null>(null);
    const [loading, setLoading] = useState(false);
    return (
        <div className="flex flex-col gap-2">
            <label htmlFor={id} className="text-sm font-medium">
                LayerStacks の振り分け方式
            </label>
            <select
                id={id}
                className="rounded border border-border bg-background p-2 text-sm"
                disabled={loading}
                value={value?.bucketMode ?? ""}
                onChange={(e) => {
                    setError(null);
                    onChange(
                        e.target.value === "kingrank9"
                            ? { bucketMode: "kingrank9" }
                            : e.target.value === "progresskpabs"
                              ? { bucketMode: "progresskpabs" }
                              : e.target.value === "progresskpabsq16"
                                ? { bucketMode: "progresskpabsq16" }
                                : undefined,
                    );
                }}
            >
                <option value="">未設定（HalfKP 等では不要）</option>
                <option value="kingrank9">KingRank9 / k3k3（9 バケット）</option>
                <option value="progresskpabs">tatara / rshogi progresskpabs（進行度）</option>
                <option value="progresskpabsq16">
                    YaneuraOu / BulletOu progressN（Q16 進行度）
                </option>
            </select>
            <p className="text-xs text-muted-foreground">
                LayerStacks はモデル配布元が指定する方式を選択してください。
            </p>
            {(value?.bucketMode === "progresskpabs" ||
                value?.bucketMode === "progresskpabsq16") && (
                <>
                    <label htmlFor={`${id}-buckets`} className="text-sm">
                        {value.bucketMode === "progresskpabsq16"
                            ? "進行度バケット数（2・4・8・16）"
                            : "進行度バケット数（1〜16）"}
                    </label>
                    {value.bucketMode === "progresskpabsq16" ? (
                        <select
                            id={`${id}-buckets`}
                            className="rounded border border-border bg-background p-2 text-sm"
                            disabled={loading}
                            value={value.progressBuckets ?? ""}
                            onChange={(e) =>
                                onChange({
                                    ...value,
                                    progressBuckets:
                                        e.target.value === "" ? undefined : Number(e.target.value),
                                })
                            }
                        >
                            <option value="">選択してください</option>
                            {[2, 4, 8, 16].map((count) => (
                                <option key={count} value={count}>
                                    {count}
                                </option>
                            ))}
                        </select>
                    ) : (
                        <Input
                            id={`${id}-buckets`}
                            type="number"
                            min={1}
                            max={16}
                            disabled={loading}
                            value={value.progressBuckets ?? ""}
                            onChange={(e) =>
                                onChange({
                                    ...value,
                                    progressBuckets:
                                        e.target.value === "" ? undefined : Number(e.target.value),
                                })
                            }
                        />
                    )}
                    <label htmlFor={`${id}-coefficients`} className="text-sm">
                        進行度係数ファイル（f64 LE、2 バケット以上では必須）
                    </label>
                    <Input
                        id={`${id}-coefficients`}
                        type="file"
                        disabled={loading}
                        onChange={async (e) => {
                            const file = e.target.files?.[0];
                            if (!file) return;
                            setError(null);
                            setLoading(true);
                            onLoadingChange?.(true);
                            try {
                                if (file.size !== PROGRESS_COEFFICIENTS_SIZE)
                                    throw new Error(
                                        "進行度係数ファイルのサイズが不正です（" +
                                            PROGRESS_COEFFICIENTS_SIZE +
                                            " バイトが必要）",
                                    );
                                const progressCoeffBase64 = encodeProgressCoefficients(
                                    new Uint8Array(await file.arrayBuffer()),
                                    value.bucketMode,
                                );
                                onChange({ ...value, progressCoeffBase64 });
                            } catch (error) {
                                setError(error instanceof Error ? error.message : String(error));
                            } finally {
                                setLoading(false);
                                onLoadingChange?.(false);
                            }
                        }}
                    />
                    <span className="text-xs text-muted-foreground">
                        {loading
                            ? "読み込み中…"
                            : value.progressCoeffBase64
                              ? "係数ファイル設定済み"
                              : "係数ファイル未設定"}
                    </span>
                </>
            )}
            {error && (
                <p role="alert" className="text-xs text-destructive">
                    {error}
                </p>
            )}
        </div>
    );
}
