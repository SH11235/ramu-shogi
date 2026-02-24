import { PositionPresetSelector } from "@shogi/ui";
import { useNavigate } from "@tanstack/react-router";
import type { ReactElement } from "react";
import { useState } from "react";

// ─── ルーム作成ダイアログの内部状態 ──────────────────────────────────────────

interface RoomSettings {
    name: string;
    timeType: "byoyomi" | "fischer";
    initialMinutes: number;
    byoyomiSeconds: number;
    fischerIncrementSeconds: number;
    startSfen: string;
    passRightsCount: number | null;
    // AI サポート設定
    aiSupportEnabled: boolean;
    aiBMode: "unlimited" | "limited";
    aiWMode: "unlimited" | "limited";
    aiBLimitCount: number;
    aiWLimitCount: number;
    aiSearchDepth: number | null;
    aiSearchTimeMs: number | null;
}

const DEFAULT_SETTINGS: RoomSettings = {
    name: "",
    timeType: "byoyomi",
    initialMinutes: 10,
    byoyomiSeconds: 30,
    fischerIncrementSeconds: 10,
    startSfen: "startpos",
    passRightsCount: null,
    aiSupportEnabled: false,
    aiBMode: "unlimited",
    aiWMode: "unlimited",
    aiBLimitCount: 5,
    aiWLimitCount: 5,
    aiSearchDepth: null,
    aiSearchTimeMs: 5000,
};

// ─── メインコンポーネント ──────────────────────────────────────────────────────

export default function OnlinePage(): ReactElement {
    const navigate = useNavigate();
    const [showCreateDialog, setShowCreateDialog] = useState(false);
    const [settings, setSettings] = useState<RoomSettings>(DEFAULT_SETTINGS);
    const [joinRoomId, setJoinRoomId] = useState("");
    const [isCreating, setIsCreating] = useState(false);
    const [createError, setCreateError] = useState<string | null>(null);

    async function handleCreateRoom(): Promise<void> {
        if (!settings.name.trim()) return;
        setIsCreating(true);
        setCreateError(null);
        try {
            const timeControl =
                settings.timeType === "byoyomi"
                    ? {
                          type: "byoyomi" as const,
                          initialMs: settings.initialMinutes * 60_000,
                          byoyomiMs: settings.byoyomiSeconds * 1000,
                      }
                    : {
                          type: "fischer" as const,
                          initialMs: settings.initialMinutes * 60_000,
                          fischerIncrementMs: settings.fischerIncrementSeconds * 1000,
                      };

            const res = await fetch("/api/rooms", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    settings: {
                        startSfen: settings.startSfen || "startpos",
                        timeControl,
                        passRights:
                            settings.passRightsCount !== null
                                ? { initialCount: settings.passRightsCount }
                                : null,
                        aiSupport: settings.aiSupportEnabled
                            ? {
                                  b: {
                                      mode: settings.aiBMode,
                                      limitCount:
                                          settings.aiBMode === "limited"
                                              ? settings.aiBLimitCount
                                              : null,
                                  },
                                  w: {
                                      mode: settings.aiWMode,
                                      limitCount:
                                          settings.aiWMode === "limited"
                                              ? settings.aiWLimitCount
                                              : null,
                                  },
                                  searchDepth: settings.aiSearchDepth,
                                  searchTimeMs: settings.aiSearchTimeMs,
                              }
                            : null,
                    },
                }),
            });

            if (!res.ok) {
                const err = (await res.json()) as { message?: string };
                setCreateError(err.message ?? "ルームの作成に失敗しました");
                return;
            }

            const data = (await res.json()) as { roomId: string };
            // ルーム作成後、作成者の名前をクエリパラメータで待機画面に渡す
            await navigate({
                to: "/online/$roomId",
                params: { roomId: data.roomId },
                search: { name: settings.name.trim(), seat: "b", mode: undefined },
            });
        } catch {
            setCreateError("ネットワークエラーが発生しました");
        } finally {
            setIsCreating(false);
        }
    }

    function handleJoin(): void {
        const id = joinRoomId.trim();
        if (!id) return;
        void navigate({
            to: "/online/$roomId",
            params: { roomId: id },
            search: { name: undefined, seat: undefined, mode: undefined },
        });
    }

    if (showCreateDialog) {
        return (
            <CreateRoomDialog
                settings={settings}
                onChange={setSettings}
                onCancel={() => {
                    setShowCreateDialog(false);
                    setCreateError(null);
                }}
                onSubmit={() => void handleCreateRoom()}
                isCreating={isCreating}
                error={createError}
            />
        );
    }

    return (
        <div className="mx-auto flex max-w-[480px] flex-col gap-6 px-4 py-10">
            <h1 className="text-2xl font-bold text-foreground">オンライン対局</h1>

            <button
                type="button"
                onClick={() => setShowCreateDialog(true)}
                className="w-full rounded-lg bg-primary py-3 text-base font-semibold text-primary-foreground shadow hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
            >
                部屋を作成する
            </button>

            <div className="flex items-center gap-3">
                <div className="h-px flex-1 bg-border" />
                <span className="text-sm text-muted-foreground">または</span>
                <div className="h-px flex-1 bg-border" />
            </div>

            <div className="flex flex-col gap-2">
                <label htmlFor="join-room-id" className="text-sm font-medium text-foreground">
                    ルームID を入力して参加
                </label>
                <div className="flex gap-2">
                    <input
                        id="join-room-id"
                        type="text"
                        value={joinRoomId}
                        onChange={(e) => setJoinRoomId(e.target.value)}
                        onKeyDown={(e) => {
                            if (e.key === "Enter") handleJoin();
                        }}
                        placeholder="例: abc123"
                        className="flex h-10 flex-1 rounded-md border border-input bg-transparent px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                    />
                    <button
                        type="button"
                        onClick={handleJoin}
                        disabled={!joinRoomId.trim()}
                        className="rounded-md bg-secondary px-4 py-2 text-sm font-medium text-secondary-foreground shadow-sm hover:bg-secondary/80 disabled:pointer-events-none disabled:opacity-50"
                    >
                        参加する
                    </button>
                </div>
            </div>

            <button
                type="button"
                onClick={() => void navigate({ to: "/" })}
                className="text-sm text-muted-foreground hover:text-foreground"
            >
                ← ローカル対局に戻る
            </button>
        </div>
    );
}

// ─── ルーム作成ダイアログ ─────────────────────────────────────────────────────

interface CreateRoomDialogProps {
    settings: RoomSettings;
    onChange: (s: RoomSettings) => void;
    onCancel: () => void;
    onSubmit: () => void;
    isCreating: boolean;
    error: string | null;
}

function CreateRoomDialog({
    settings,
    onChange,
    onCancel,
    onSubmit,
    isCreating,
    error,
}: CreateRoomDialogProps): ReactElement {
    function set<K extends keyof RoomSettings>(key: K, value: RoomSettings[K]): void {
        onChange({ ...settings, [key]: value });
    }

    const labelClass = "text-sm font-medium text-foreground";
    const inputClass =
        "flex h-10 w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2";

    return (
        <div className="mx-auto flex max-w-[480px] flex-col gap-6 px-4 py-10">
            <div className="flex items-center gap-3">
                <button
                    type="button"
                    onClick={onCancel}
                    className="text-muted-foreground hover:text-foreground"
                    aria-label="戻る"
                >
                    ←
                </button>
                <h1 className="text-xl font-bold text-foreground">対局設定</h1>
            </div>

            {/* 名前入力 */}
            <div className="flex flex-col gap-2">
                <label htmlFor="player-name" className={labelClass}>
                    あなたの名前（先手）
                </label>
                <input
                    id="player-name"
                    type="text"
                    value={settings.name}
                    onChange={(e) => set("name", e.target.value)}
                    placeholder="プレイヤー名"
                    maxLength={20}
                    className={inputClass}
                />
            </div>

            {/* 開始局面 */}
            <div className="flex flex-col gap-2">
                <span className={labelClass}>開始局面</span>
                <PositionPresetSelector
                    value={settings.startSfen}
                    onChange={(v) => set("startSfen", v)}
                />
            </div>

            {/* 時間設定 */}
            <div className="flex flex-col gap-3">
                <span className={labelClass}>時間設定</span>

                {/* 持ち時間タイプ選択 */}
                <div className="flex gap-3">
                    {(["byoyomi", "fischer"] as const).map((type) => (
                        <label key={type} className="flex cursor-pointer items-center gap-2">
                            <input
                                type="radio"
                                name="time-type"
                                value={type}
                                checked={settings.timeType === type}
                                onChange={() => set("timeType", type)}
                                className="accent-primary"
                            />
                            <span className="text-sm text-foreground">
                                {type === "byoyomi" ? "持ち時間 + 秒読み" : "フィッシャー"}
                            </span>
                        </label>
                    ))}
                </div>

                {/* 持ち時間（共通） */}
                <div className="flex items-center gap-2">
                    <label htmlFor="initial-minutes" className="w-24 text-sm text-foreground">
                        持ち時間
                    </label>
                    <input
                        id="initial-minutes"
                        type="number"
                        min={0}
                        max={180}
                        value={settings.initialMinutes}
                        onChange={(e) => set("initialMinutes", Math.max(0, Number(e.target.value)))}
                        className="w-20 rounded-md border border-input bg-transparent px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                    />
                    <span className="text-sm text-muted-foreground">分</span>
                </div>

                {/* 秒読み設定（byoyomi のみ） */}
                {settings.timeType === "byoyomi" && (
                    <div className="flex items-center gap-2">
                        <label htmlFor="byoyomi-seconds" className="w-24 text-sm text-foreground">
                            秒読み
                        </label>
                        <input
                            id="byoyomi-seconds"
                            type="number"
                            min={0}
                            max={300}
                            value={settings.byoyomiSeconds}
                            onChange={(e) =>
                                set("byoyomiSeconds", Math.max(0, Number(e.target.value)))
                            }
                            className="w-20 rounded-md border border-input bg-transparent px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                        />
                        <span className="text-sm text-muted-foreground">秒</span>
                    </div>
                )}

                {/* フィッシャー加算設定 */}
                {settings.timeType === "fischer" && (
                    <div className="flex items-center gap-2">
                        <label htmlFor="fischer-increment" className="w-24 text-sm text-foreground">
                            1 手加算
                        </label>
                        <input
                            id="fischer-increment"
                            type="number"
                            min={0}
                            max={300}
                            value={settings.fischerIncrementSeconds}
                            onChange={(e) =>
                                set("fischerIncrementSeconds", Math.max(0, Number(e.target.value)))
                            }
                            className="w-20 rounded-md border border-input bg-transparent px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                        />
                        <span className="text-sm text-muted-foreground">秒</span>
                    </div>
                )}
            </div>

            {/* パス権設定 */}
            <div className="flex flex-col gap-2">
                <span className={labelClass}>パス権</span>
                <div className="flex gap-3">
                    <label className="flex cursor-pointer items-center gap-2">
                        <input
                            type="radio"
                            name="pass-rights"
                            checked={settings.passRightsCount === null}
                            onChange={() => set("passRightsCount", null)}
                            className="accent-primary"
                        />
                        <span className="text-sm text-foreground">なし</span>
                    </label>
                    <label className="flex cursor-pointer items-center gap-2">
                        <input
                            type="radio"
                            name="pass-rights"
                            checked={settings.passRightsCount !== null}
                            onChange={() => set("passRightsCount", 1)}
                            className="accent-primary"
                        />
                        <span className="text-sm text-foreground">あり</span>
                    </label>
                    {settings.passRightsCount !== null && (
                        <div className="flex items-center gap-2">
                            <input
                                type="number"
                                min={1}
                                max={10}
                                value={settings.passRightsCount}
                                onChange={(e) =>
                                    set("passRightsCount", Math.max(1, Number(e.target.value)))
                                }
                                className="w-16 rounded-md border border-input bg-transparent px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                            />
                            <span className="text-sm text-muted-foreground">回</span>
                        </div>
                    )}
                </div>
            </div>

            {/* AI サポート設定 */}
            <div className="flex flex-col gap-2">
                <span className={labelClass}>AI サポート</span>
                <label className="flex cursor-pointer items-center gap-2">
                    <input
                        type="checkbox"
                        checked={settings.aiSupportEnabled}
                        onChange={(e) => set("aiSupportEnabled", e.target.checked)}
                        className="accent-primary"
                    />
                    <span className="text-sm text-foreground">有効にする</span>
                </label>
                {settings.aiSupportEnabled && (
                    <div className="flex flex-col gap-3 rounded-md border border-border bg-muted/30 p-3">
                        {(
                            [
                                ["b", "先手（▲）", "aiBMode", "aiBLimitCount"],
                                ["w", "後手（△）", "aiWMode", "aiWLimitCount"],
                            ] as const
                        ).map(([, label, modeKey, countKey]) => (
                            <div key={modeKey} className="flex flex-col gap-1">
                                <span className="text-xs font-medium text-muted-foreground">
                                    {label}
                                </span>
                                <div className="flex items-center gap-3">
                                    {(["unlimited", "limited"] as const).map((mode) => (
                                        <label
                                            key={mode}
                                            className="flex cursor-pointer items-center gap-1"
                                        >
                                            <input
                                                type="radio"
                                                name={modeKey}
                                                checked={settings[modeKey] === mode}
                                                onChange={() => set(modeKey, mode)}
                                                className="accent-primary"
                                            />
                                            <span className="text-sm text-foreground">
                                                {mode === "unlimited" ? "無制限" : "回数制限"}
                                            </span>
                                        </label>
                                    ))}
                                    {settings[modeKey] === "limited" && (
                                        <div className="flex items-center gap-1">
                                            <input
                                                type="number"
                                                min={1}
                                                max={20}
                                                value={settings[countKey]}
                                                onChange={(e) =>
                                                    set(
                                                        countKey,
                                                        Math.max(1, Number(e.target.value)),
                                                    )
                                                }
                                                className="w-14 rounded-md border border-input bg-transparent px-2 py-1 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                                            />
                                            <span className="text-sm text-muted-foreground">
                                                回
                                            </span>
                                        </div>
                                    )}
                                </div>
                            </div>
                        ))}
                        <div className="flex items-center gap-2">
                            <label
                                htmlFor="ai-search-time"
                                className="w-24 text-xs text-muted-foreground"
                            >
                                解析時間
                            </label>
                            <input
                                id="ai-search-time"
                                type="number"
                                min={1}
                                max={60}
                                value={Math.round((settings.aiSearchTimeMs ?? 5000) / 1000)}
                                onChange={(e) =>
                                    set(
                                        "aiSearchTimeMs",
                                        Math.max(1, Number(e.target.value)) * 1000,
                                    )
                                }
                                className="w-16 rounded-md border border-input bg-transparent px-2 py-1 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                            />
                            <span className="text-sm text-muted-foreground">秒</span>
                        </div>
                    </div>
                )}
            </div>

            {error && <p className="text-sm text-destructive">{error}</p>}

            <button
                type="button"
                onClick={onSubmit}
                disabled={isCreating || !settings.name.trim()}
                className="w-full rounded-lg bg-primary py-3 text-base font-semibold text-primary-foreground shadow hover:bg-primary/90 disabled:pointer-events-none disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
            >
                {isCreating ? "作成中..." : "部屋を作成する"}
            </button>
        </div>
    );
}
