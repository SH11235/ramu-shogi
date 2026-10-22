import type { JsonValue, UserSettingsDocumentKey } from "@shogi/api-contract";
import {
    LOCAL_STORAGE_SYNC_EVENT,
    useLocalStorage,
} from "@shogi/ui/components/shogi-match/hooks/useLocalStorage";
import { useNormalizedSettings } from "@shogi/ui/components/shogi-match/hooks/useNormalizedSettings";
import {
    isSameTimeSettings,
    normalizeTimeSettings,
} from "@shogi/ui/components/shogi-match/utils/timeSettings";
import { act, cleanup, renderHook } from "@testing-library/react";
import { useLayoutEffect } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useUserSettingsSync } from "./useUserSettingsSync";

const mockUseAuthSession = vi.fn();
const mockRefreshAuth = vi.fn();
const mockFetch = vi.fn();

vi.mock("./useAuthSession", () => ({
    useAuthSession: () => mockUseAuthSession(),
    dispatchAuthSessionSyncEvent: () => mockRefreshAuth(),
}));

const DISPLAY_KEY = "shogi-display-settings";
const LAST_USER_KEY = "shogi-user-settings-last-user-id";
const TIME_KEY = "shogi-match-time-settings";
const defaultTimeSettings = {
    sente: { mainMs: 300_000, byoyomiMs: 30_000, incrementMs: 0, enabled: true },
    gote: { mainMs: 300_000, byoyomiMs: 30_000, incrementMs: 0, enabled: true },
};
const mappings = [
    ["match.time-settings", "shogi-match-time-settings"],
    ["match.display-settings", DISPLAY_KEY],
    ["match.analysis-settings", "shogi-analysis-settings"],
    ["match.pass-rights-settings", "shogi-pass-rights-settings"],
] as const;

interface PendingRequest {
    url: string;
    options: RequestInit;
    resolve: (response: Response) => void;
    reject: (error: Error) => void;
}

let requests: PendingRequest[];
let auth: {
    session: { authenticated: boolean; user: { id: string } | null };
    isLoadingSession: boolean;
    sessionError: string | null;
};

function remote(
    value: JsonValue,
    version = 1,
    documentKey: UserSettingsDocumentKey = "match.display-settings",
) {
    return { documentKey, value, version, updatedAt: "2026-10-22T00:00:00Z" };
}

function request(index: number): PendingRequest {
    const pending = requests[index];
    if (!pending) throw new Error(`Request ${index} was not sent`);
    return pending;
}

async function reply(index: number, payload: unknown, status = 200): Promise<void> {
    await act(async () => {
        request(index).resolve(Response.json(payload, { status }));
    });
}

function changeLocal(value: JsonValue, storageKey = DISPLAY_KEY): void {
    act(() => {
        localStorage.setItem(storageKey, JSON.stringify(value));
        window.dispatchEvent(
            new CustomEvent(LOCAL_STORAGE_SYNC_EVENT, { detail: { key: storageKey } }),
        );
    });
}

function readLocal(storageKey = DISPLAY_KEY): unknown {
    const value = localStorage.getItem(storageKey);
    return value === null ? null : JSON.parse(value);
}

function expectPut(
    index: number,
    value: JsonValue,
    expectedVersion: number | null,
    userId = "user-1",
): void {
    expect(request(index).options).toMatchObject({
        method: "PUT",
        credentials: "same-origin",
        headers: { "X-Expected-User-Id": userId, "Content-Type": "application/json" },
    });
    expect(JSON.parse(request(index).options.body as string)).toEqual({ value, expectedVersion });
}

describe("useUserSettingsSync", () => {
    beforeEach(() => {
        requests = [];
        auth = {
            session: { authenticated: true, user: { id: "user-1" } },
            isLoadingSession: false,
            sessionError: null,
        };
        mockUseAuthSession.mockImplementation(() => auth);
        mockRefreshAuth.mockReset();
        mockFetch.mockReset();
        mockFetch.mockImplementation(
            (url: string, options: RequestInit) =>
                new Promise<Response>((resolve, reject) => {
                    requests.push({ url, options, resolve, reject });
                }),
        );
        vi.stubGlobal("fetch", mockFetch);
        localStorage.clear();
    });

    afterEach(() => {
        cleanup();
        vi.unstubAllGlobals();
    });

    it("サーバー設定の適用と同じ値の通知で PUT しない", async () => {
        const value = { theme: "dark" };
        localStorage.setItem(DISPLAY_KEY, JSON.stringify({ theme: "light" }));
        renderHook(() => useUserSettingsSync());
        expect(request(0).options.headers).toEqual({ "X-Expected-User-Id": "user-1" });
        await reply(0, { documents: [remote(value, 4)] });
        expect(readLocal()).toEqual(value);
        expect(localStorage.getItem(LAST_USER_KEY)).toBe("user-1");
        changeLocal(value);
        expect(requests).toHaveLength(1);
    });

    it("保存済みの版を PUT に含め、応答後は同じ値を再送しない", async () => {
        renderHook(() => useUserSettingsSync());
        await reply(0, { documents: [remote({ theme: "system" }, 4)] });
        changeLocal({ theme: "light" });
        expectPut(1, { theme: "light" }, 4);
        await reply(1, { document: remote({ theme: "light" }, 5) });
        changeLocal({ theme: "light" });
        expect(requests).toHaveLength(2);
        changeLocal({ theme: "dark" });
        expectPut(2, { theme: "dark" }, 5);
    });

    it.each(
        mappings,
    )("%s の初回作成には expectedVersion: null を使う", async (documentKey, storageKey) => {
        const value = { enabled: true };
        localStorage.setItem(storageKey, JSON.stringify(value));
        renderHook(() => useUserSettingsSync());
        await reply(0, { documents: [] });
        expect(request(1).url).toBe(`/api/user/settings/${documentKey}`);
        expectPut(1, value, null);
        expect(localStorage.getItem(LAST_USER_KEY)).toBeNull();
        await reply(1, { document: remote(value, 1, documentKey) });
        expect(localStorage.getItem(LAST_USER_KEY)).toBe("user-1");
    });

    it("同じ利用者のローカル設定を作成でき、別利用者の引き継ぎ値は自動送信しない", async () => {
        localStorage.setItem(LAST_USER_KEY, "user-1");
        localStorage.setItem(DISPLAY_KEY, JSON.stringify({ theme: "dark" }));
        const { rerender } = renderHook(() => useUserSettingsSync());
        await reply(0, { documents: [] });
        expectPut(1, { theme: "dark" }, null);
        await reply(1, { document: remote({ theme: "dark" }) });
        auth = { ...auth, session: { authenticated: true, user: { id: "user-2" } } };
        rerender();
        await reply(2, { documents: [] });
        expect(requests).toHaveLength(3);
        expect(readLocal()).toEqual({ theme: "dark" });
        expect(localStorage.getItem(LAST_USER_KEY)).toBe("user-2");
        changeLocal({ theme: "light" });
        expectPut(3, { theme: "light" }, null, "user-2");
    });

    it("初期 GET 中の変更を残し、取得した版で最新版を送る", async () => {
        localStorage.setItem(DISPLAY_KEY, JSON.stringify({ theme: "system" }));
        renderHook(() => useUserSettingsSync());
        changeLocal({ theme: "dark" });
        expect(requests).toHaveLength(1);
        await reply(0, { documents: [remote({ theme: "light" }, 7)] });
        expect(readLocal()).toEqual({ theme: "dark" });
        expectPut(1, { theme: "dark" }, 7);
    });

    it("初期 GET 中の編集通知がない保存よりサーバー設定を優先する", async () => {
        renderHook(() => useUserSettingsSync());
        localStorage.setItem(DISPLAY_KEY, JSON.stringify({ theme: "dark" }));
        await reply(0, { documents: [remote({ theme: "light" }, 7)] });
        expect(readLocal()).toEqual({ theme: "light" });
        expect(requests).toHaveLength(1);
    });

    it.each([
        false,
        true,
    ])("画面の初期値保存でサーバー設定を上書きしない（StrictMode: %s）", async (reactStrictMode) => {
        renderHook(() => useUserSettingsSync(), { reactStrictMode });
        const { result } = renderHook(() => useLocalStorage(DISPLAY_KEY, { sound: true }), {
            reactStrictMode,
        });
        const activeRequest = requests.length - 1;
        await reply(activeRequest, { documents: [remote({ sound: false }, 4)] });
        expect(result.current[0]).toEqual({ sound: false });
        expect(readLocal()).toEqual({ sound: false });
        expect(requests).toHaveLength(activeRequest + 1);
    });

    it.each([
        false,
        true,
    ])("画面での明示的な初期 GET 中の編集を保存する（StrictMode: %s）", async (reactStrictMode) => {
        renderHook(() => useUserSettingsSync(), { reactStrictMode });
        const { result } = renderHook(() => useLocalStorage(DISPLAY_KEY, { sound: true }), {
            reactStrictMode,
        });
        act(() => result.current[1]({ sound: false }));
        const activeRequest = requests.length - 1;
        await reply(activeRequest, { documents: [remote({ sound: true }, 4)] });
        expectPut(activeRequest + 1, { sound: false }, 4);
        expect(result.current[0]).toEqual({ sound: false });
    });

    it.each([
        false,
        true,
    ])("旧形式の正規化より初期 GET の時間設定を優先する（StrictMode: %s）", async (reactStrictMode) => {
        localStorage.setItem(
            TIME_KEY,
            JSON.stringify({
                sente: { mainMs: 300, byoyomiMs: 30, enabled: true },
                gote: { mainMs: 300, byoyomiMs: 30, enabled: true },
            }),
        );
        renderHook(() => useUserSettingsSync(), { reactStrictMode });
        const { result } = renderHook(
            () =>
                useNormalizedSettings(
                    TIME_KEY,
                    defaultTimeSettings,
                    normalizeTimeSettings,
                    isSameTimeSettings,
                ),
            { reactStrictMode },
        );
        const remoteTime = {
            sente: { mainMs: 600_000, byoyomiMs: 60_000, incrementMs: 0, enabled: true },
            gote: { mainMs: 600_000, byoyomiMs: 60_000, incrementMs: 0, enabled: true },
        };
        expect(readLocal(TIME_KEY)).toEqual(defaultTimeSettings);
        const activeRequest = requests.length - 1;
        await reply(activeRequest, {
            documents: [remote(remoteTime, 7, "match.time-settings")],
        });
        expect(readLocal(TIME_KEY)).toEqual(remoteTime);
        expect(result.current[0]).toEqual(remoteTime);
        expect(requests).toHaveLength(activeRequest + 1);
    });

    it.each([
        false,
        true,
    ])("旧形式の正規化後も初期 GET 中の利用者編集を保存する（StrictMode: %s）", async (reactStrictMode) => {
        localStorage.setItem(
            TIME_KEY,
            JSON.stringify({
                sente: { mainMs: 300, byoyomiMs: 30, enabled: true },
                gote: { mainMs: 300, byoyomiMs: 30, enabled: true },
            }),
        );
        renderHook(() => useUserSettingsSync(), { reactStrictMode });
        const { result } = renderHook(
            () =>
                useNormalizedSettings(
                    TIME_KEY,
                    defaultTimeSettings,
                    normalizeTimeSettings,
                    isSameTimeSettings,
                ),
            { reactStrictMode },
        );
        const editedTime = {
            ...defaultTimeSettings,
            sente: { mainMs: 900_000, byoyomiMs: 30_000, incrementMs: 0, enabled: true },
        };
        act(() => result.current[1](editedTime));
        const activeRequest = requests.length - 1;
        await reply(activeRequest, {
            documents: [remote(defaultTimeSettings, 7, "match.time-settings")],
        });
        expectPut(activeRequest + 1, editedTime, 7);
        expect(readLocal(TIME_KEY)).toEqual(editedTime);
        expect(result.current[0]).toEqual(editedTime);
    });

    it.each([
        false,
        true,
    ])("正規化effectと同時の利用者編集を古い値で戻さない（StrictMode: %s）", async (reactStrictMode) => {
        localStorage.setItem(
            TIME_KEY,
            JSON.stringify({
                sente: { mainMs: 300, byoyomiMs: 30, enabled: true },
                gote: { mainMs: 300, byoyomiMs: 30, enabled: true },
            }),
        );
        const editedTime = {
            ...defaultTimeSettings,
            sente: { mainMs: 900_000, byoyomiMs: 30_000, incrementMs: 0, enabled: true },
        };
        renderHook(() => useUserSettingsSync(), { reactStrictMode });
        const { result } = renderHook(
            () => {
                const [settings, setSettings] = useNormalizedSettings(
                    TIME_KEY,
                    defaultTimeSettings,
                    normalizeTimeSettings,
                    isSameTimeSettings,
                );
                useLayoutEffect(() => setSettings(editedTime), [setSettings]);
                return settings;
            },
            { reactStrictMode },
        );
        const activeRequest = requests.length - 1;
        await reply(activeRequest, {
            documents: [remote(defaultTimeSettings, 7, "match.time-settings")],
        });
        expectPut(activeRequest + 1, editedTime, 7);
        expect(readLocal(TIME_KEY)).toEqual(editedTime);
        expect(result.current).toEqual(editedTime);
    });

    it.each([
        false,
        true,
    ])("初期 GET 中に自動補正前の値へ戻す利用者編集を保存する（StrictMode: %s）", async (reactStrictMode) => {
        const savedTime = {
            sente: { mainMs: 600_000, byoyomiMs: 60_000, incrementMs: 0, enabled: true },
            gote: { mainMs: 600_000, byoyomiMs: 60_000, incrementMs: 0, enabled: true },
        };
        localStorage.setItem(TIME_KEY, JSON.stringify(savedTime));
        const sync = renderHook(() => useUserSettingsSync(), { reactStrictMode });
        const { result } = renderHook(
            () =>
                useNormalizedSettings(
                    TIME_KEY,
                    defaultTimeSettings,
                    normalizeTimeSettings,
                    isSameTimeSettings,
                ),
            { reactStrictMode },
        );
        const activeRequest = requests.length - 1;
        const alignedTime = {
            ...defaultTimeSettings,
            sente: { ...defaultTimeSettings.sente, enabled: false },
        };
        act(() => result.current[1](alignedTime, "automatic"));
        expect(readLocal(TIME_KEY)).toEqual(alignedTime);
        expect(requests).toHaveLength(activeRequest + 1);
        act(() => result.current[1](savedTime));
        expect(readLocal(TIME_KEY)).toEqual(savedTime);
        await reply(activeRequest, {
            documents: [remote(defaultTimeSettings, 7, "match.time-settings")],
        });
        expect(readLocal(TIME_KEY)).toEqual(savedTime);
        expect(result.current[0]).toEqual(savedTime);
        expectPut(activeRequest + 1, savedTime, 7);
        await reply(activeRequest + 1, {
            document: remote(savedTime, 8, "match.time-settings"),
        });
        expect(sync.result.current.syncError).toBeNull();
        expect(requests).toHaveLength(activeRequest + 2);
    });

    it.each([
        { reactStrictMode: false, order: "user-first" },
        { reactStrictMode: true, order: "user-first" },
        { reactStrictMode: false, order: "automatic-first" },
        { reactStrictMode: true, order: "automatic-first" },
    ])("初期 GET 中の同じbatchの編集と自動補正を保存する（$order、StrictMode: $reactStrictMode）", async ({
        reactStrictMode,
        order,
    }) => {
        const defaults = { sound: true, volume: 1 };
        const edited = { sound: false, volume: 0.5 };
        renderHook(() => useUserSettingsSync(), { reactStrictMode });
        const { result } = renderHook(() => useLocalStorage(DISPLAY_KEY, defaults), {
            reactStrictMode,
        });
        const setter = result.current[1];
        const edit = () => setter((previous) => ({ ...previous, sound: false }));
        const normalize = () => setter((previous) => ({ ...previous, volume: 0.5 }), "automatic");
        act(() => {
            if (order === "user-first") {
                edit();
                normalize();
            } else {
                normalize();
                edit();
            }
        });
        const activeRequest = requests.length - 1;
        await reply(activeRequest, { documents: [remote(defaults, 7)] });
        expect(readLocal()).toEqual(edited);
        expect(result.current[0]).toEqual(edited);
        expectPut(activeRequest + 1, edited, 7);
        await reply(activeRequest + 1, { document: remote(edited, 8) });
        expect(requests).toHaveLength(activeRequest + 2);
    });

    it.each([
        false,
        true,
    ])("PUT 中の自動補正を未保存の編集として再送しない（StrictMode: %s）", async (reactStrictMode) => {
        const defaults = { sound: true, volume: 1 };
        const edited = { sound: false, volume: 1 };
        const normalized = { sound: false, volume: 0.5 };
        renderHook(() => useUserSettingsSync(), { reactStrictMode });
        const first = renderHook(() => useLocalStorage(DISPLAY_KEY, defaults), {
            reactStrictMode,
        });
        const second = renderHook(() => useLocalStorage(DISPLAY_KEY, defaults), {
            reactStrictMode,
        });
        const activeRequest = requests.length - 1;
        await reply(activeRequest, { documents: [remote(defaults, 7)] });
        act(() => first.result.current[1](edited));
        expectPut(activeRequest + 1, edited, 7);
        act(() => first.result.current[1](normalized, "automatic"));
        expect(second.result.current[0]).toEqual(normalized);
        await reply(activeRequest + 1, { document: remote(edited, 8) });
        expect(requests).toHaveLength(activeRequest + 2);
        expect(readLocal()).toEqual(normalized);
        const nextEdit = { sound: true, volume: 0.5 };
        act(() => first.result.current[1](nextEdit));
        expectPut(activeRequest + 2, nextEdit, 8);
    });

    it("取得後の自動補正は画面へ反映し、次の利用者編集で同期する", async () => {
        renderHook(() => useUserSettingsSync());
        const first = renderHook(() => useLocalStorage(TIME_KEY, defaultTimeSettings));
        const second = renderHook(() => useLocalStorage(TIME_KEY, defaultTimeSettings));
        await reply(0, {
            documents: [remote(defaultTimeSettings, 7, "match.time-settings")],
        });
        const alignedTime = {
            ...defaultTimeSettings,
            sente: { ...defaultTimeSettings.sente, enabled: false },
        };
        act(() => first.result.current[1](alignedTime, "automatic"));
        expect(second.result.current[0]).toEqual(alignedTime);
        expect(requests).toHaveLength(1);
        const editedTime = {
            ...alignedTime,
            gote: { ...defaultTimeSettings.gote, mainMs: 900_000 },
        };
        act(() => first.result.current[1](editedTime));
        expectPut(1, editedTime, 7);
    });

    it.each([
        "failed-refetch",
        "stale-response",
    ])("拒否された PUT と同じ他端末の更新を自分の保存とみなさない（%s）", async (scenario) => {
        const { result, rerender } = renderHook(() => useUserSettingsSync());
        await reply(0, { documents: [remote({ sound: true }, 4)] });
        changeLocal({ sound: false });
        changeLocal({ sound: true });
        if (scenario === "failed-refetch") {
            await reply(1, { error: "SETTINGS_VERSION_CONFLICT" }, 409);
            await reply(2, { error: "INTERNAL_ERROR" }, 500);
        }
        auth = { ...auth, session: { authenticated: true, user: { id: "user-1" } } };
        rerender();
        if (scenario === "stale-response") {
            await reply(1, { error: "SETTINGS_VERSION_CONFLICT" }, 409);
        }
        const activeRequest = requests.length - 1;
        await reply(activeRequest, { documents: [remote({ sound: false }, 5)] });
        expect(requests).toHaveLength(activeRequest + 1);
        expect(readLocal()).toEqual({ sound: true });
        expect(result.current.syncError).toContain("更新が競合");
    });

    it("別利用者へ切り替えた後の古い GET は設定も保存先も変えない", async () => {
        const { rerender } = renderHook(() => useUserSettingsSync());
        auth = { ...auth, session: { authenticated: true, user: { id: "user-2" } } };
        rerender();
        expect(request(0).options.signal?.aborted).toBe(true);
        await reply(1, { documents: [remote({ theme: "dark" }, 20)] });
        await reply(0, { documents: [remote({ theme: "light" }, 3)] });
        expect(readLocal()).toEqual({ theme: "dark" });
        expect(localStorage.getItem(LAST_USER_KEY)).toBe("user-2");
        changeLocal({ theme: "system" });
        expectPut(2, { theme: "system" }, 20, "user-2");
    });

    it("GET の本文解析が利用者切替より遅れても破棄する", async () => {
        let resolveBody: (payload: unknown) => void = () => {};
        const body = new Promise((resolve) => {
            resolveBody = resolve;
        });
        const { rerender } = renderHook(() => useUserSettingsSync());
        await act(async () => {
            const response = Response.json({});
            vi.spyOn(response, "json").mockReturnValue(body);
            request(0).resolve(response);
        });
        auth = { ...auth, session: { authenticated: true, user: { id: "user-2" } } };
        rerender();
        await reply(1, { documents: [remote({ theme: "dark" })] });
        await act(async () => {
            resolveBody({ documents: [remote({ theme: "light" })] });
        });
        expect(readLocal()).toEqual({ theme: "dark" });
        expect(requests).toHaveLength(2);
    });

    it("切替前の PUT 応答は新しい利用者の版を巻き戻さず、待機中の編集も送らない", async () => {
        const { rerender } = renderHook(() => useUserSettingsSync());
        await reply(0, { documents: [remote({ theme: "light" }, 3)] });
        changeLocal({ theme: "dark" });
        changeLocal({ theme: "system" });
        auth = { ...auth, session: { authenticated: true, user: { id: "user-2" } } };
        rerender();
        await reply(2, { documents: [remote({ theme: "light" }, 20)] });
        await reply(1, { document: remote({ theme: "dark" }, 4) });
        expect(readLocal()).toEqual({ theme: "light" });
        expect(requests).toHaveLength(3);
        changeLocal({ theme: "dark" });
        expectPut(3, { theme: "dark" }, 20, "user-2");
    });

    it("ログアウトは4つの設定と利用者マーカーを保持し、遅延応答を破棄する", async () => {
        for (const [, storageKey] of mappings)
            localStorage.setItem(storageKey, JSON.stringify({ local: storageKey }));
        localStorage.setItem(LAST_USER_KEY, "user-1");
        const { rerender } = renderHook(() => useUserSettingsSync());
        auth = { ...auth, session: { authenticated: false, user: null } };
        rerender();
        await reply(0, { documents: [remote({ theme: "remote" })] });
        for (const [, storageKey] of mappings)
            expect(readLocal(storageKey)).toEqual({ local: storageKey });
        expect(localStorage.getItem(LAST_USER_KEY)).toBe("user-1");
        changeLocal({ theme: "dark" });
        expect(requests).toHaveLength(1);
    });

    it("同一利用者のセッション再確認で初期 GET を再開し、停止中の編集も保存する", async () => {
        const { rerender } = renderHook(() => useUserSettingsSync());
        auth = { ...auth, isLoadingSession: true };
        rerender();
        changeLocal({ theme: "dark" });
        expect(request(0).options.signal?.aborted).toBe(true);
        auth = {
            ...auth,
            isLoadingSession: false,
            session: { authenticated: true, user: { id: "user-1" } },
        };
        rerender();
        await reply(1, { documents: [remote({ theme: "light" }, 5)] });
        expectPut(2, { theme: "dark" }, 5);
        await reply(0, { documents: [remote({ theme: "stale" }, 2)] });
        await reply(2, { document: remote({ theme: "dark" }, 6) });
        changeLocal({ theme: "system" });
        expectPut(3, { theme: "system" }, 6);
    });

    it("セッション取得失敗中は同期を再開しない", async () => {
        const { rerender } = renderHook(() => useUserSettingsSync());
        auth = { ...auth, sessionError: "offline" };
        rerender();
        await reply(0, { documents: [remote({ theme: "light" })] });
        changeLocal({ theme: "dark" });
        expect(requests).toHaveLength(1);
        auth = { ...auth, sessionError: null };
        rerender();
        await reply(1, { documents: [remote({ theme: "light" }, 4)] });
        expectPut(2, { theme: "dark" }, 4);
    });

    it("同じキーの PUT を直列化し、送信中の複数編集を最新値へまとめる", async () => {
        renderHook(() => useUserSettingsSync());
        await reply(0, { documents: [remote({ theme: "system" }, 4)] });
        changeLocal({ theme: "light" });
        changeLocal({ theme: "dark" });
        changeLocal({ theme: "custom" });
        expect(requests).toHaveLength(2);
        await reply(1, { document: remote({ theme: "light" }, 5) });
        expect(requests).toHaveLength(3);
        expectPut(2, { theme: "custom" }, 5);
        await reply(2, { document: remote({ theme: "custom" }, 6) });
        expect(readLocal()).toEqual({ theme: "custom" });
        expect(requests).toHaveLength(3);
    });

    it("PUT 中に元の値へ戻した変更も保存する", async () => {
        renderHook(() => useUserSettingsSync());
        await reply(0, { documents: [remote({ theme: "system" }, 4)] });
        changeLocal({ theme: "light" });
        changeLocal({ theme: "system" });
        await reply(1, { document: remote({ theme: "light" }, 5) });
        expectPut(2, { theme: "system" }, 5);
    });

    it("異なるキーの PUT は互いの完了を待たない", async () => {
        renderHook(() => useUserSettingsSync());
        await reply(0, {
            documents: [
                remote({ theme: "system" }, 4),
                remote({ depth: 10 }, 8, "match.analysis-settings"),
            ],
        });
        changeLocal({ theme: "light" });
        changeLocal({ depth: 12 }, "shogi-analysis-settings");
        expectPut(1, { theme: "light" }, 4);
        expectPut(2, { depth: 12 }, 8);
        expect(request(2).url).toBe("/api/user/settings/match.analysis-settings");
    });

    it("セッション再確認中に完了した自分の PUT を再取得で確認し、待機中の編集を保存する", async () => {
        const { rerender } = renderHook(() => useUserSettingsSync());
        await reply(0, { documents: [remote({ theme: "system" }, 4)] });
        changeLocal({ theme: "light" });
        changeLocal({ theme: "dark" });
        auth = { ...auth, session: { authenticated: true, user: { id: "user-1" } } };
        rerender();
        await reply(2, { documents: [remote({ theme: "light" }, 5)] });
        expectPut(3, { theme: "dark" }, 5);
        await reply(1, { document: remote({ theme: "light" }, 5) });
        expect(requests).toHaveLength(4);
        await reply(3, { document: remote({ theme: "dark" }, 6) });
        changeLocal({ theme: "custom" });
        expectPut(4, { theme: "custom" }, 6);
    });

    it("競合後にサーバーが同じ値なら保存済みとし、次の編集で取得した版を使う", async () => {
        const { result } = renderHook(() => useUserSettingsSync());
        await reply(0, { documents: [remote({ theme: "system" }, 4)] });
        changeLocal({ theme: "dark" });
        await reply(1, { error: "SETTINGS_VERSION_CONFLICT" }, 409);
        expect(request(2).options).toMatchObject({
            method: "GET",
            headers: { "X-Expected-User-Id": "user-1" },
        });
        await reply(2, { document: remote({ theme: "dark" }, 8) });
        expect(result.current.syncError).toBeNull();
        changeLocal({ theme: "dark" });
        expect(requests).toHaveLength(3);
        changeLocal({ theme: "light" });
        expectPut(3, { theme: "light" }, 8);
    });

    it("中断した PUT が未確定なら、GET と一致する取り消し編集も条件付きで保存する", async () => {
        const { result, rerender } = renderHook(() => useUserSettingsSync());
        await reply(0, { documents: [remote({ theme: "system" }, 4)] });
        changeLocal({ theme: "light" });
        changeLocal({ theme: "system" });
        auth = { ...auth, session: { authenticated: true, user: { id: "user-1" } } };
        rerender();
        await reply(2, { documents: [remote({ theme: "system" }, 4)] });
        expectPut(3, { theme: "system" }, 4);
        await reply(1, { document: remote({ theme: "light" }, 5) });
        await reply(3, { error: "SETTINGS_VERSION_CONFLICT" }, 409);
        await reply(4, { document: remote({ theme: "light" }, 5) });
        expect(readLocal()).toEqual({ theme: "system" });
        expect(result.current.syncError).toContain("更新が競合");
        expect(requests).toHaveLength(5);
    });

    it("PUT 失敗後に同じサーバー版を再確認できたら最新の編集を再送する", async () => {
        const { result, rerender } = renderHook(() => useUserSettingsSync());
        await reply(0, { documents: [remote({ theme: "system" }, 4)] });
        changeLocal({ theme: "light" });
        changeLocal({ theme: "dark" });
        await reply(1, { error: "INTERNAL_ERROR" }, 500);
        expect(requests).toHaveLength(2);
        expect(result.current.syncError).toContain("同期できません");
        auth = { ...auth, session: { authenticated: true, user: { id: "user-1" } } };
        rerender();
        await reply(2, { documents: [remote({ theme: "system" }, 4)] });
        expectPut(3, { theme: "dark" }, 4);
        await reply(3, { document: remote({ theme: "dark" }, 5) });
        expect(result.current.syncError).toBeNull();
    });

    it("競合の再取得に失敗してもローカル編集を保ち、確認できるまで送信しない", async () => {
        const { result, rerender } = renderHook(() => useUserSettingsSync());
        await reply(0, { documents: [remote({ theme: "system" }, 4)] });
        changeLocal({ theme: "dark" });
        await reply(1, { error: "SETTINGS_VERSION_CONFLICT" }, 409);
        await reply(2, { error: "INTERNAL_ERROR" }, 500);
        expect(readLocal()).toEqual({ theme: "dark" });
        expect(result.current.syncError).toContain("同期できません");
        auth = { ...auth, session: { authenticated: true, user: { id: "user-1" } } };
        rerender();
        await reply(3, { documents: [remote({ theme: "light" }, 5)] });
        expect(requests).toHaveLength(4);
        expect(result.current.syncError).toContain("更新が競合");
    });

    it("異なる値との競合はローカル値と通知を保持し、再確認だけでは上書きしない", async () => {
        const { result, rerender } = renderHook(() => useUserSettingsSync());
        await reply(0, { documents: [remote({ theme: "system" }, 4)] });
        changeLocal({ theme: "dark" });
        await reply(1, { error: "SETTINGS_VERSION_CONFLICT" }, 409);
        await reply(2, { document: remote({ theme: "light" }, 8) });
        expect(readLocal()).toEqual({ theme: "dark" });
        expect(result.current.syncError).toContain("表示設定の更新が競合");
        act(() => result.current.retrySync());
        expect(mockRefreshAuth).toHaveBeenCalledOnce();
        auth = { ...auth, session: { authenticated: true, user: { id: "user-1" } } };
        rerender();
        await reply(3, { documents: [remote({ theme: "light" }, 8)] });
        expect(readLocal()).toEqual({ theme: "dark" });
        expect(result.current.syncError).toContain("更新が競合");
        expect(requests).toHaveLength(4);
        changeLocal({ theme: "custom" });
        expectPut(4, { theme: "custom" }, 8);
        await reply(4, { document: remote({ theme: "custom" }, 9) });
        expect(result.current.syncError).toBeNull();
    });

    it("初回作成の競合でも既存値を上書きしない", async () => {
        localStorage.setItem(DISPLAY_KEY, JSON.stringify({ theme: "dark" }));
        const { result } = renderHook(() => useUserSettingsSync());
        await reply(0, { documents: [] });
        await reply(1, { error: "SETTINGS_VERSION_CONFLICT" }, 409);
        await reply(2, { document: remote({ theme: "light" }) });
        expectPut(1, { theme: "dark" }, null);
        expect(result.current.syncError).toContain("更新が競合");
        expect(readLocal()).toEqual({ theme: "dark" });
        expect(requests).toHaveLength(3);
    });

    it("競合の再取得が利用者切替後に届いても設定と通知を変更しない", async () => {
        const { result, rerender } = renderHook(() => useUserSettingsSync());
        await reply(0, { documents: [remote({ theme: "system" }, 4)] });
        changeLocal({ theme: "dark" });
        await reply(1, { error: "SETTINGS_VERSION_CONFLICT" }, 409);
        auth = { ...auth, session: { authenticated: true, user: { id: "user-2" } } };
        rerender();
        await reply(3, { documents: [remote({ theme: "light" }, 20)] });
        await reply(2, { document: remote({ theme: "remote" }, 8) });
        expect(result.current.syncError).toBeNull();
        expect(readLocal()).toEqual({ theme: "light" });
        changeLocal({ theme: "dark" });
        expectPut(4, { theme: "dark" }, 20, "user-2");
    });

    it("初期取得に失敗したら版を知らないまま送信せず、再確認後に編集を保存する", async () => {
        const { result, rerender } = renderHook(() => useUserSettingsSync());
        await reply(0, { error: "INTERNAL_ERROR" }, 500);
        expect(result.current.syncError).toContain("同期できません");
        changeLocal({ theme: "dark" });
        expect(requests).toHaveLength(1);
        auth = { ...auth, session: { authenticated: true, user: { id: "user-1" } } };
        rerender();
        await reply(1, { documents: [remote({ theme: "light" }, 8)] });
        expectPut(2, { theme: "dark" }, 8);
    });

    it("PUT の通信失敗後に他端末の更新が見つかったら自動再送しない", async () => {
        const { result, rerender } = renderHook(() => useUserSettingsSync());
        await reply(0, { documents: [remote({ theme: "system" }, 4)] });
        changeLocal({ theme: "dark" });
        await act(async () => {
            request(1).reject(new TypeError("Failed to fetch"));
        });
        expect(result.current.syncError).toContain("同期できません");
        auth = { ...auth, session: { authenticated: true, user: { id: "user-1" } } };
        rerender();
        await reply(2, { documents: [remote({ theme: "light" }, 5)] });
        expect(result.current.syncError).toContain("更新が競合");
        expect(readLocal()).toEqual({ theme: "dark" });
        expect(requests).toHaveLength(3);
    });

    it.each([
        [401, "UNAUTHORIZED"],
        [409, "SETTINGS_USER_MISMATCH"],
    ] as const)("%s %s で停止し、認証再確認が同じ利用者でも一度だけ自動で再試行する", async (status, error) => {
        const { result, rerender } = renderHook(() => useUserSettingsSync());
        await reply(0, { error }, status);
        expect(mockRefreshAuth).toHaveBeenCalledOnce();
        expect(request(0).options.signal?.aborted).toBe(true);
        expect(result.current.syncError).toContain("ログイン状態");
        changeLocal({ theme: "dark" });
        expect(requests).toHaveLength(1);
        auth = { ...auth, session: { authenticated: true, user: { id: "user-1" } } };
        rerender();
        await reply(1, { error }, status);
        expect(mockRefreshAuth).toHaveBeenCalledOnce();
        expect(result.current.syncError).toContain("ログイン状態");
        expect(requests).toHaveLength(2);
    });

    it("PUT の利用者不一致では待機中の編集を送信せず、同一利用者の再確認で再開する", async () => {
        const { result, rerender } = renderHook(() => useUserSettingsSync());
        await reply(0, { documents: [remote({ theme: "system" }, 4)] });
        changeLocal({ theme: "dark" });
        changeLocal({ theme: "light" });
        await reply(1, { error: "SETTINGS_USER_MISMATCH" }, 409);
        expect(requests).toHaveLength(2);
        expect(mockRefreshAuth).toHaveBeenCalledOnce();
        expect(readLocal()).toEqual({ theme: "light" });
        auth = { ...auth, session: { authenticated: true, user: { id: "user-1" } } };
        rerender();
        await reply(2, { documents: [remote({ theme: "system" }, 4)] });
        expectPut(3, { theme: "light" }, 4);
        await reply(3, { document: remote({ theme: "light" }, 5) });
        expect(result.current.syncError).toBeNull();
    });

    it("StrictMode の破棄された GET とアンマウント後の応答を無視する", async () => {
        const { unmount } = renderHook(() => useUserSettingsSync(), { reactStrictMode: true });
        expect(requests).toHaveLength(2);
        expect(request(0).options.signal?.aborted).toBe(true);
        await reply(1, { documents: [remote({ theme: "dark" }, 4)] });
        await reply(0, { documents: [remote({ theme: "light" }, 1)] });
        expect(readLocal()).toEqual({ theme: "dark" });
        changeLocal({ theme: "system" });
        unmount();
        expect(request(2).options.signal?.aborted).toBe(true);
        await reply(2, { document: remote({ theme: "system" }, 5) });
        expect(requests).toHaveLength(3);
        expect(readLocal()).toEqual({ theme: "system" });
    });
});
