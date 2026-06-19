import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
    assetReturnsNotOk,
    installStaleDeployReloadHandlers,
    isStaleAssetError,
    reloadForStaleDeploy,
    reloadOnStaleAsset,
} from "./stale-deploy-reload";

describe("isStaleAssetError", () => {
    it("wasm streaming compile の 404 メッセージを stale と判定する", () => {
        expect(
            isStaleAssetError(
                new Error(
                    "Failed to execute 'compile' on 'WebAssembly': HTTP status code is not ok",
                ),
            ),
        ).toBe(true);
    });

    it("dynamic import chunk 消失のメッセージを stale と判定する", () => {
        expect(
            isStaleAssetError(
                new Error("Failed to fetch dynamically imported module: /assets/x-abcd.js"),
            ),
        ).toBe(true);
        expect(isStaleAssetError("error loading dynamically imported module")).toBe(true);
        expect(isStaleAssetError(new Error("Importing a module script failed."))).toBe(true);
    });

    it("一般的なネットワークエラーやその他は stale 扱いしない (誤 reload 防止)", () => {
        expect(isStaleAssetError(new Error("Failed to fetch"))).toBe(false);
        expect(
            isStaleAssetError(new Error("NetworkError when attempting to fetch resource.")),
        ).toBe(false);
        expect(isStaleAssetError(undefined)).toBe(false);
        expect(isStaleAssetError(null)).toBe(false);
    });
});

describe("reloadForStaleDeploy / reloadOnStaleAsset", () => {
    let reloadSpy: ReturnType<typeof vi.spyOn>;
    let nowSpy: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
        window.sessionStorage.clear();
        reloadSpy = vi.spyOn(window.location, "reload").mockImplementation(() => undefined);
        nowSpy = vi.spyOn(Date, "now").mockReturnValue(1_000_000);
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it("stale エラーで full reload を1回起動する", () => {
        expect(reloadOnStaleAsset(new Error("HTTP status code is not ok"))).toBe(true);
        expect(reloadSpy).toHaveBeenCalledTimes(1);
    });

    it("stale でないエラーでは reload しない", () => {
        expect(reloadOnStaleAsset(new Error("Failed to fetch"))).toBe(false);
        expect(reloadSpy).not.toHaveBeenCalled();
    });

    it("クールダウン内の再失敗は reload しない (ループ防止)", () => {
        expect(reloadForStaleDeploy()).toBe(true);
        expect(reloadForStaleDeploy()).toBe(false);
        expect(reloadSpy).toHaveBeenCalledTimes(1);
    });

    it("クールダウン経過後は再び reload する", () => {
        expect(reloadForStaleDeploy()).toBe(true);
        nowSpy.mockReturnValue(1_000_000 + 61_000);
        expect(reloadForStaleDeploy()).toBe(true);
        expect(reloadSpy).toHaveBeenCalledTimes(2);
    });

    it("クールダウン内は reloadOnStaleAsset でも reload しない", () => {
        expect(reloadOnStaleAsset(new Error("HTTP status code is not ok"))).toBe(true);
        expect(reloadOnStaleAsset(new Error("HTTP status code is not ok"))).toBe(false);
        expect(reloadSpy).toHaveBeenCalledTimes(1);
    });

    it("sessionStorage の読み取りが不可なら reload しない", () => {
        // happy-dom の sessionStorage は Proxy で restoreAllMocks が効かないため Once で自己復帰させる
        vi.spyOn(window.sessionStorage, "getItem").mockImplementationOnce(() => {
            throw new Error("storage denied");
        });
        expect(reloadForStaleDeploy()).toBe(false);
        expect(reloadSpy).not.toHaveBeenCalled();
    });

    it("ガード時刻を書き込めないなら reload しない (ループ防止)", () => {
        vi.spyOn(window.sessionStorage, "setItem").mockImplementationOnce(() => {
            throw new Error("quota exceeded");
        });
        expect(reloadForStaleDeploy()).toBe(false);
        expect(reloadSpy).not.toHaveBeenCalled();
    });
});

describe("installStaleDeployReloadHandlers", () => {
    let reloadSpy: ReturnType<typeof vi.spyOn>;

    beforeAll(() => {
        installStaleDeployReloadHandlers();
    });

    beforeEach(() => {
        window.sessionStorage.clear();
        reloadSpy = vi.spyOn(window.location, "reload").mockImplementation(() => undefined);
        vi.spyOn(Date, "now").mockReturnValue(2_000_000);
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it("vite:preloadError で reload し、preventDefault する", () => {
        const event = new Event("vite:preloadError", { cancelable: true });
        window.dispatchEvent(event);
        expect(reloadSpy).toHaveBeenCalledTimes(1);
        expect(event.defaultPrevented).toBe(true);
    });

    it("stale な unhandledrejection で reload し、preventDefault する", () => {
        const event = new Event("unhandledrejection", { cancelable: true });
        Object.assign(event, { reason: new Error("error loading dynamically imported module") });
        window.dispatchEvent(event);
        expect(reloadSpy).toHaveBeenCalledTimes(1);
        expect(event.defaultPrevented).toBe(true);
    });

    it("stale な error イベントで reload し、preventDefault する", () => {
        const event = new Event("error", { cancelable: true });
        Object.assign(event, { error: new Error("HTTP status code is not ok") });
        window.dispatchEvent(event);
        expect(reloadSpy).toHaveBeenCalledTimes(1);
        expect(event.defaultPrevented).toBe(true);
    });

    it("stale でない unhandledrejection では reload せず preventDefault もしない", () => {
        const event = new Event("unhandledrejection", { cancelable: true });
        Object.assign(event, { reason: new Error("Failed to fetch") });
        window.dispatchEvent(event);
        expect(reloadSpy).not.toHaveBeenCalled();
        expect(event.defaultPrevented).toBe(false);
    });

    it("stale でない error イベントでは reload せず preventDefault もしない", () => {
        const event = new Event("error", { cancelable: true });
        Object.assign(event, { error: new Error("ResizeObserver loop limit exceeded") });
        window.dispatchEvent(event);
        expect(reloadSpy).not.toHaveBeenCalled();
        expect(event.defaultPrevented).toBe(false);
    });
});

describe("assetReturnsNotOk", () => {
    afterEach(() => {
        // restoreAllMocks は stubGlobal を巻き戻さないため fetch stub をリークさせる
        vi.unstubAllGlobals();
    });

    it("non-ok (404) を返すアセットは true", async () => {
        vi.stubGlobal(
            "fetch",
            vi.fn(async () => ({ ok: false, status: 404 }) as Response),
        );
        await expect(assetReturnsNotOk("/assets/x.wasm")).resolves.toBe(true);
    });

    it("ok (200) のアセットは false", async () => {
        vi.stubGlobal(
            "fetch",
            vi.fn(async () => ({ ok: true, status: 200 }) as Response),
        );
        await expect(assetReturnsNotOk("/assets/x.wasm")).resolves.toBe(false);
    });

    it("fetch 自体が失敗 (オフライン等) したら stale 断定せず false", async () => {
        vi.stubGlobal(
            "fetch",
            vi.fn(async () => {
                throw new TypeError("Failed to fetch");
            }),
        );
        await expect(assetReturnsNotOk("/assets/x.wasm")).resolves.toBe(false);
    });
});
