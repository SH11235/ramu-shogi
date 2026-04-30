/**
 * CSA接続設定パネル
 *
 * サーバー接続情報、エンジン設定、時間設定、対局設定、棋譜保存設定のフォーム。
 * 設定の保存/読み込みは Tauri コマンド経由で行う。
 */

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
import { invoke } from "@tauri-apps/api/core";
import type { ReactElement } from "react";
import { useEffect, useState } from "react";

import type { CsaConfig } from "./useCsaGame";

// ─── Types ───

interface ExternalEngine {
    id: string;
    displayName: string;
}

interface CsaSettingsPanelProps {
    onStart: (config: CsaConfig) => void;
}

// ─── Default Config ───

function createDefaultConfig(): CsaConfig {
    return {
        server: {
            host: "",
            port: 4081,
            user_id: "",
            password: "",
            floodgate: false,
            tcp_keepalive: true,
        },
        engine: {
            // PR-A 段階では Builtin 経路は backend で early error。default は External。
            type: "external",
            registration_id: null,
            options: {},
            ponder: false,
            startup_timeout_sec: 30,
        },
        time: {
            margin_ms: 2500,
        },
        game: {
            max_games: 1,
            restart_engine_every_game: false,
        },
        record: {
            save_dir: "",
        },
        reconnect: null,
    };
}

// ─── Component ───

export function CsaSettingsPanel({ onStart }: CsaSettingsPanelProps): ReactElement {
    const [config, setConfig] = useState<CsaConfig>(createDefaultConfig);
    const [externalEngines, setExternalEngines] = useState<ExternalEngine[]>([]);
    const [saveMessage, setSaveMessage] = useState<string | null>(null);

    // 設定読み込み + エンジンリスト取得（マウント時）
    useEffect(() => {
        invoke<unknown>("csa_load_config")
            .then((loaded) => {
                if (loaded && typeof loaded === "object") {
                    setConfig(mergeConfig(createDefaultConfig(), loaded as Partial<CsaConfig>));
                }
            })
            .catch((e) => {
                console.error("CSA設定の読み込みに失敗:", e);
            });

        invoke<ExternalEngine[]>("usi_engine_list")
            .then(setExternalEngines)
            .catch((e) => {
                console.error("エンジンリスト取得に失敗:", e);
            });
    }, []);

    const updateServer = (patch: Partial<CsaConfig["server"]>) => {
        setConfig((prev) => ({ ...prev, server: { ...prev.server, ...patch } }));
    };

    const updateEngine = (patch: Partial<CsaConfig["engine"]>) => {
        setConfig((prev) => ({ ...prev, engine: { ...prev.engine, ...patch } }));
    };

    const updateTime = (patch: Partial<CsaConfig["time"]>) => {
        setConfig((prev) => ({ ...prev, time: { ...prev.time, ...patch } }));
    };

    const updateGame = (patch: Partial<CsaConfig["game"]>) => {
        setConfig((prev) => ({ ...prev, game: { ...prev.game, ...patch } }));
    };

    const updateRecord = (patch: Partial<CsaConfig["record"]>) => {
        setConfig((prev) => ({ ...prev, record: { ...prev.record, ...patch } }));
    };

    const applyFloodgatePreset = () => {
        updateServer({
            host: "wdoor.c.u-tokyo.ac.jp",
            port: 4081,
            floodgate: true,
        });
    };

    const handleSave = async () => {
        try {
            await invoke("csa_save_config", { config });
            setSaveMessage("保存しました");
            setTimeout(() => setSaveMessage(null), 2000);
        } catch (e) {
            setSaveMessage(`保存失敗: ${e instanceof Error ? e.message : String(e)}`);
        }
    };

    const handleStart = () => {
        onStart(config);
    };

    const isValid =
        config.server.host.trim().length > 0 &&
        config.server.port >= 1 &&
        config.server.port <= 65535 &&
        config.server.user_id.length > 0 &&
        config.server.password.length > 0 &&
        (config.engine.type !== "external" || (config.engine.registration_id ?? "").length > 0);

    return (
        <div className="space-y-5">
            {/* サーバー設定 */}
            <section className="space-y-2">
                <h3 className="text-sm font-semibold text-wafuu-sumi">サーバー設定</h3>
                <div className="grid grid-cols-2 gap-2">
                    <FieldRow label="ホスト">
                        <Input
                            value={config.server.host}
                            onChange={(e) => updateServer({ host: e.target.value })}
                            placeholder="例: wdoor.c.u-tokyo.ac.jp"
                            className="h-8 text-xs"
                        />
                    </FieldRow>
                    <FieldRow label="ポート">
                        <Input
                            type="number"
                            value={config.server.port}
                            onChange={(e) => updateServer({ port: Number(e.target.value) })}
                            className="h-8 text-xs"
                        />
                    </FieldRow>
                    <FieldRow label="ユーザーID">
                        <Input
                            value={config.server.user_id}
                            onChange={(e) => updateServer({ user_id: e.target.value })}
                            className="h-8 text-xs"
                        />
                    </FieldRow>
                    <FieldRow label="パスワード">
                        <Input
                            type="password"
                            value={config.server.password}
                            onChange={(e) => updateServer({ password: e.target.value })}
                            className="h-8 text-xs"
                        />
                    </FieldRow>
                </div>
                <div className="flex items-center gap-3">
                    <Button variant="outline" size="sm" onClick={applyFloodgatePreset}>
                        Floodgate プリセット
                    </Button>
                    <span className="flex items-center gap-2 text-xs text-muted-foreground">
                        <Switch
                            checked={config.server.floodgate}
                            onCheckedChange={(checked: boolean) =>
                                updateServer({ floodgate: checked })
                            }
                        />
                        Floodgate モード
                    </span>
                </div>
            </section>

            {/* エンジン設定 */}
            <section className="space-y-2">
                <h3 className="text-sm font-semibold text-wafuu-sumi">エンジン設定</h3>
                <div className="grid grid-cols-2 gap-2">
                    <FieldRow label="エンジン種別">
                        <Select
                            value={config.engine.type}
                            onValueChange={(value: string) =>
                                updateEngine({
                                    type: value as "builtin" | "external",
                                    registration_id:
                                        value === "builtin" ? null : config.engine.registration_id,
                                })
                            }
                        >
                            <SelectTrigger className="h-8 text-xs">
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem
                                    value="builtin"
                                    disabled
                                    title="移行作業中、近日中に利用可能"
                                >
                                    内蔵エンジン（移行作業中）
                                </SelectItem>
                                <SelectItem value="external">外部エンジン</SelectItem>
                            </SelectContent>
                        </Select>
                    </FieldRow>
                    {config.engine.type === "external" && (
                        <FieldRow label="外部エンジン">
                            <Select
                                value={config.engine.registration_id ?? ""}
                                onValueChange={(value: string) =>
                                    updateEngine({ registration_id: value || null })
                                }
                            >
                                <SelectTrigger className="h-8 text-xs">
                                    <SelectValue placeholder="エンジンを選択" />
                                </SelectTrigger>
                                <SelectContent>
                                    {externalEngines.map((eng) => (
                                        <SelectItem key={eng.id} value={eng.id}>
                                            {eng.displayName}
                                        </SelectItem>
                                    ))}
                                    {externalEngines.length === 0 && (
                                        <SelectItem value="" disabled>
                                            登録エンジンなし
                                        </SelectItem>
                                    )}
                                </SelectContent>
                            </Select>
                        </FieldRow>
                    )}
                </div>
                <span className="flex items-center gap-2 text-xs text-muted-foreground">
                    <Switch
                        checked={config.engine.ponder}
                        onCheckedChange={(checked: boolean) => updateEngine({ ponder: checked })}
                    />
                    Ponder（先読み）
                </span>
            </section>

            {/* 時間設定 */}
            <section className="space-y-2">
                <h3 className="text-sm font-semibold text-wafuu-sumi">時間設定</h3>
                <FieldRow label="マージン (ms)">
                    <Input
                        type="number"
                        value={config.time.margin_ms}
                        onChange={(e) => updateTime({ margin_ms: Number(e.target.value) })}
                        className="h-8 text-xs w-32"
                    />
                </FieldRow>
            </section>

            {/* 対局設定 */}
            <section className="space-y-2">
                <h3 className="text-sm font-semibold text-wafuu-sumi">対局設定</h3>
                <FieldRow label="連続対局数">
                    <Input
                        type="number"
                        value={config.game.max_games}
                        onChange={(e) => updateGame({ max_games: Number(e.target.value) })}
                        min={1}
                        className="h-8 text-xs w-32"
                    />
                </FieldRow>
            </section>

            {/* 棋譜保存設定 */}
            <section className="space-y-2">
                <h3 className="text-sm font-semibold text-wafuu-sumi">棋譜保存</h3>
                <FieldRow label="保存先ディレクトリ">
                    <Input
                        value={config.record.save_dir}
                        onChange={(e) => updateRecord({ save_dir: e.target.value })}
                        placeholder="空欄の場合は保存しません"
                        className="h-8 text-xs"
                    />
                </FieldRow>
            </section>

            {/* アクションボタン */}
            <div className="flex items-center gap-3 pt-2">
                <Button onClick={handleStart} disabled={!isValid}>
                    接続
                </Button>
                <Button variant="outline" onClick={handleSave}>
                    設定を保存
                </Button>
                {saveMessage && (
                    <span className="text-xs text-muted-foreground">{saveMessage}</span>
                )}
            </div>
        </div>
    );
}

// ─── FieldRow ───

function FieldRow({ label, children }: { label: string; children: ReactElement }): ReactElement {
    return (
        <div className="space-y-1">
            <span className="text-xs font-medium text-muted-foreground block">{label}</span>
            {children}
        </div>
    );
}

// ─── Helpers ───

/** 保存済み設定をデフォルトにマージする（部分的な保存に対応） */
function mergeConfig(base: CsaConfig, loaded: Partial<CsaConfig>): CsaConfig {
    return {
        server: { ...base.server, ...(loaded.server ?? {}) },
        engine: { ...base.engine, ...(loaded.engine ?? {}) },
        time: { ...base.time, ...(loaded.time ?? {}) },
        game: { ...base.game, ...(loaded.game ?? {}) },
        record: { ...base.record, ...(loaded.record ?? {}) },
    };
}
