import type { ApiErrorResponse, CreateRoomRequest, CreateRoomResponse } from "@shogi/api-contract";
import { PositionPresetSelector } from "@shogi/ui";
import { useNavigate } from "@tanstack/react-router";
import type { ReactElement } from "react";
import { useEffect, useRef, useState } from "react";
import { HeaderNav } from "../../components/HeaderNav";
import { PageContainer } from "../../components/PageContainer";
import { PageHeader } from "../../components/PageHeader";
import { PageHeading } from "../../components/PageHeading";
import { syncProfileDisplayNameIfNeeded, useAuthSession } from "../../hooks/useAuthSession";
import { getLocalPlayerName, saveLocalPlayerName } from "../../hooks/useLocalPlayerName";

// ─── ルーム設定の型 ───────────────────────────────────────────────────────────

interface RoomFormState {
    name: string;
    timeType: "byoyomi" | "fischer";
    initialMinutes: number;
    byoyomiSeconds: number;
    fischerIncrementSeconds: number;
    startSfen: string;
    passRightsCount: number | null;
    takeback: boolean;
    aiSupportEnabled: boolean;
    aiBMode: "unlimited" | "limited";
    aiWMode: "unlimited" | "limited";
    aiBLimitCount: number;
    aiWLimitCount: number;
    aiSearchDepth: number | null;
    aiSearchTimeMs: number | null;
}

const DEFAULT_SETTINGS: RoomFormState = {
    name: "",
    timeType: "byoyomi",
    initialMinutes: 10,
    byoyomiSeconds: 30,
    fischerIncrementSeconds: 10,
    startSfen: "startpos",
    passRightsCount: null,
    takeback: false,
    aiSupportEnabled: false,
    aiBMode: "unlimited",
    aiWMode: "unlimited",
    aiBLimitCount: 5,
    aiWLimitCount: 5,
    aiSearchDepth: null,
    aiSearchTimeMs: 5000,
};

function buildCreateRoomRequest(settings: RoomFormState): CreateRoomRequest {
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

    return {
        settings: {
            startSfen: settings.startSfen || "startpos",
            timeControl,
            passRights:
                settings.passRightsCount !== null
                    ? { initialCount: settings.passRightsCount }
                    : null,
            takeback: settings.takeback,
            aiSupport: settings.aiSupportEnabled
                ? {
                      b: {
                          mode: settings.aiBMode,
                          limitCount:
                              settings.aiBMode === "limited" ? settings.aiBLimitCount : null,
                      },
                      w: {
                          mode: settings.aiWMode,
                          limitCount:
                              settings.aiWMode === "limited" ? settings.aiWLimitCount : null,
                      },
                      searchDepth: settings.aiSearchDepth,
                      searchTimeMs: settings.aiSearchTimeMs,
                  }
                : null,
        },
    };
}

// ─── ページコンポーネント ─────────────────────────────────────────────────────

export default function CreateRoomPage(): ReactElement {
    const navigate = useNavigate();
    const { session } = useAuthSession();
    const [settings, setSettings] = useState<RoomFormState>(DEFAULT_SETTINGS);
    const [isCreating, setIsCreating] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const didAutofillNameRef = useRef(false);

    function set<K extends keyof RoomFormState>(key: K, value: RoomFormState[K]): void {
        setSettings((prev) => ({ ...prev, [key]: value }));
    }

    useEffect(() => {
        if (didAutofillNameRef.current) return;

        const autofillName = session?.authenticated
            ? session.user.displayName
            : getLocalPlayerName();

        if (!autofillName.trim()) return;

        setSettings((prev) => {
            if (prev.name.trim()) return prev;
            didAutofillNameRef.current = true;
            return { ...prev, name: autofillName };
        });
    }, [session]);

    async function handleSubmit(): Promise<void> {
        const trimmedName = settings.name.trim();
        if (!trimmedName) return;
        setIsCreating(true);
        setError(null);
        if (!session?.authenticated) saveLocalPlayerName(trimmedName);
        const requestBody = buildCreateRoomRequest(settings);

        await syncProfileDisplayNameIfNeeded(session, trimmedName)
            .then(() =>
                fetch("/api/rooms", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify(requestBody),
                }),
            )
            .then(async (res) => {
                if (!res.ok) {
                    const err = (await res.json()) as ApiErrorResponse;
                    setError(err.message ?? "ルームの作成に失敗しました");
                    setIsCreating(false);
                    return;
                }

                const data = (await res.json()) as CreateRoomResponse;
                await navigate({
                    to: "/online/$roomId",
                    params: { roomId: data.roomId },
                    search: { name: undefined, seat: undefined, mode: undefined },
                });
            })
            .catch((nextError: unknown) => {
                setError(
                    nextError instanceof Error
                        ? nextError.message
                        : "ネットワークエラーが発生しました",
                );
                setIsCreating(false);
            });
    }

    const labelClass = "text-sm font-medium text-foreground";
    const inputClass =
        "flex h-10 w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2";

    return (
        <>
            <PageHeader
                items={[
                    { label: "ラム将棋", to: "/" },
                    { label: "オンライン対局", to: "/online" },
                    { label: "対局設定" },
                ]}
                right={<HeaderNav />}
            />
            <PageContainer width="form">
                <PageHeading title="対局設定" />

                {/* 名前入力 */}
                <div className="flex flex-col gap-2">
                    <label htmlFor="player-name" className={labelClass}>
                        あなたの名前
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
                            onChange={(e) =>
                                set("initialMinutes", Math.max(0, Number(e.target.value)))
                            }
                            className="w-20 rounded-md border border-input bg-transparent px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                        />
                        <span className="text-sm text-muted-foreground">分</span>
                    </div>
                    {settings.timeType === "byoyomi" && (
                        <div className="flex items-center gap-2">
                            <label
                                htmlFor="byoyomi-seconds"
                                className="w-24 text-sm text-foreground"
                            >
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
                    {settings.timeType === "fischer" && (
                        <div className="flex items-center gap-2">
                            <label
                                htmlFor="fischer-increment"
                                className="w-24 text-sm text-foreground"
                            >
                                1 手加算
                            </label>
                            <input
                                id="fischer-increment"
                                type="number"
                                min={0}
                                max={300}
                                value={settings.fischerIncrementSeconds}
                                onChange={(e) =>
                                    set(
                                        "fischerIncrementSeconds",
                                        Math.max(0, Number(e.target.value)),
                                    )
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

                {/* 待った設定 */}
                <div className="flex flex-col gap-2">
                    <span className={labelClass}>待った</span>
                    <label className="flex cursor-pointer items-center gap-2">
                        <input
                            type="checkbox"
                            checked={settings.takeback}
                            onChange={(e) => set("takeback", e.target.checked)}
                            className="accent-primary"
                        />
                        <span className="text-sm text-foreground">
                            有効にする（直前の手を取り消せます）
                        </span>
                    </label>
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
                                                    min={0}
                                                    max={20}
                                                    value={settings[countKey]}
                                                    onChange={(e) =>
                                                        set(
                                                            countKey,
                                                            Math.max(0, Number(e.target.value)),
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
                                    max={10}
                                    value={Math.round((settings.aiSearchTimeMs ?? 5000) / 1000)}
                                    onChange={(e) =>
                                        set(
                                            "aiSearchTimeMs",
                                            Math.min(10, Math.max(1, Number(e.target.value))) *
                                                1000,
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
                    onClick={() => void handleSubmit()}
                    disabled={isCreating || !settings.name.trim()}
                    className="w-full rounded-lg bg-primary py-3 text-base font-semibold text-primary-foreground shadow hover:bg-primary/90 disabled:pointer-events-none disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                >
                    {isCreating ? "作成中..." : "部屋を作成する"}
                </button>
            </PageContainer>
        </>
    );
}
