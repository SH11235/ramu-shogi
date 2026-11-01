import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { createUsageClient } from "../../platform/usage";
import { UsageSettings } from "./UsageSettings";

const DEVICE_ID = "3f2b8c1e-4d5a-4b6c-9d7e-0123456789ab";

function client({ hostname = "ramu-shogi.sh11235.com", globalPrivacyControl = false } = {}) {
    const storage = new Map<string, string>();
    return createUsageClient({
        hostname,
        search: "",
        referrer: "",
        globalPrivacyControl,
        storage: {
            getItem: (key) => storage.get(key) ?? null,
            setItem: (key, value) => void storage.set(key, value),
            removeItem: (key) => void storage.delete(key),
        },
        randomUUID: () => DEVICE_ID,
        send: () => {},
    });
}

describe("UsageSettings", () => {
    it("協力中は端末の番号を出し、オフにすると隠す", () => {
        render(<UsageSettings client={client()} />);
        expect(screen.getByText(DEVICE_ID)).toBeTruthy();
        fireEvent.click(screen.getByRole("switch"));
        expect(screen.queryByText(DEVICE_ID)).toBeNull();
        expect(screen.getByRole("switch").getAttribute("aria-checked")).toBe("false");
    });

    it("Global Privacy Control が有効なら、送っていないことだけを出す", () => {
        render(<UsageSettings client={client({ globalPrivacyControl: true })} />);
        expect(screen.queryByRole("switch")).toBeNull();
        expect(screen.getByText(/Global Privacy Control/)).toBeTruthy();
    });

    it("本番以外では送っていないことだけを出す", () => {
        render(<UsageSettings client={client({ hostname: "localhost" })} />);
        expect(screen.queryByRole("switch")).toBeNull();
        expect(screen.getByText("この環境では送っていません。")).toBeTruthy();
    });
});
