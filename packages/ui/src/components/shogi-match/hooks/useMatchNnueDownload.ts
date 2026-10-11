import {
    createPresetManager,
    downloadPreset,
    type NnueDownloadProgress,
    NnueError,
    type NnueSelection,
    type PresetConfig,
    type ResolvedNnue,
} from "@shogi/app-core";
import { useEffect, useRef, useState } from "react";
import { useNnueContextOptional } from "../../../providers/NnueContext";
import type { Message } from "../types";

export function presetDownloadSize(preset: PresetConfig): number {
    return preset.size + (preset.progressCoefficients?.size ?? 0);
}

export function useMatchNnueDownload({
    manifestUrl,
    resolveNnue,
    setMessage,
    cancelReason = "対局を開始できません",
}: {
    manifestUrl: string;
    resolveNnue: (selection: NnueSelection) => Promise<ResolvedNnue | null>;
    setMessage: (message: Message | null) => void;
    /** ダウンロードを断ったときの案内の結び（「〜が未ダウンロードのため、<ここ>。」）。 */
    cancelReason?: string;
}) {
    const context = useNnueContextOptional();
    const [presets, setPresets] = useState<PresetConfig[]>([]);
    const [busy, setBusy] = useState(false);
    const [progress, setProgress] = useState<NnueDownloadProgress | null>(null);
    const [completedBytes, setCompletedBytes] = useState(0);
    const [error, setError] = useState<string | null>(null);
    const pending = useRef<((approved: boolean) => void) | null>(null);
    const busyRef = useRef(false);
    const checkingRef = useRef(false);
    const mounted = useRef(true);
    useEffect(() => {
        mounted.current = true;
        return () => {
            mounted.current = false;
            pending.current?.(false);
            pending.current = null;
        };
    }, []);

    const finish = (approved: boolean) => {
        const resolve = pending.current;
        pending.current = null;
        setPresets([]);
        resolve?.(approved);
    };
    const cancel = () => {
        if (busyRef.current) return;
        setMessage({
            text: `${presets.map((preset) => preset.displayName).join("・")}が未ダウンロードのため、${cancelReason}。`,
            type: "error",
        });
        finish(false);
    };
    const ensureMatchNnue = async (selections: NnueSelection[]): Promise<boolean> => {
        if (checkingRef.current) return false;
        checkingRef.current = true;
        try {
            const missing = new Set<string>();
            for (const selection of selections) {
                try {
                    await resolveNnue(selection);
                } catch (failure) {
                    if (
                        failure instanceof NnueError &&
                        failure.code === "NNUE_NOT_DOWNLOADED" &&
                        selection.presetKey
                    )
                        missing.add(selection.presetKey);
                    else throw failure;
                }
            }
            if (missing.size === 0) return true;
            if (!context || !manifestUrl)
                throw new Error("AIのダウンロード情報を取得できません。もう一度お試しください。");
            const manager = createPresetManager({ manifestUrl, storage: context.storage });
            const manifest = await manager.getManifest();
            const required = [...missing].map((key) => {
                const config = manifest.presets.find((preset) => preset.presetKey === key);
                if (!config) throw new Error("選択したAIのダウンロード情報が見つかりません。");
                return config;
            });
            if (!mounted.current) return false;
            setError(null);
            setProgress(null);
            setCompletedBytes(0);
            setMessage(null);
            return await new Promise<boolean>((resolve) => {
                pending.current = resolve;
                setPresets(required);
            });
        } catch (failure) {
            setMessage({
                text: failure instanceof Error ? failure.message : "AIの確認に失敗しました。",
                type: "error",
            });
            return false;
        } finally {
            checkingRef.current = false;
        }
    };
    const download = async () => {
        if (busyRef.current || !context || !pending.current) return;
        busyRef.current = true;
        setBusy(true);
        setError(null);
        setProgress(null);
        setCompletedBytes(0);
        try {
            let completed = 0;
            for (const preset of presets) {
                // 再試行時は、前の試行で保存まで完了したAIを再取得しない。
                try {
                    await resolveNnue({ presetKey: preset.presetKey, nnueId: null });
                } catch {
                    // 承認したサイズ・ハッシュのファイルを取得する。
                    await downloadPreset(preset, context.storage, (value) => {
                        if (mounted.current) setProgress(value);
                    });
                }
                if (!mounted.current) return;
                completed += presetDownloadSize(preset);
                setProgress(null);
                setCompletedBytes(completed);
            }
            await context.refreshList();
            for (const preset of presets)
                await resolveNnue({ presetKey: preset.presetKey, nnueId: null });
            if (mounted.current) finish(true);
        } catch (failure) {
            if (mounted.current)
                setError(
                    failure instanceof Error ? failure.message : "ダウンロードに失敗しました。",
                );
        } finally {
            busyRef.current = false;
            if (mounted.current) setBusy(false);
        }
    };
    return { presets, busy, progress, completedBytes, error, cancel, download, ensureMatchNnue };
}
