import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_DISPLAY_SETTINGS, type DisplaySettings } from "../types";
import { SoundToggle } from "./SoundToggle";

vi.mock("../contexts/NavigationContext", () => ({
    useNavigation: () => {
        // 古い保存値にはenableSoundがなく、表示時に既定値だけが補完される。
        const [stored, setStored] = useState<Partial<DisplaySettings>>({ showBoardLabels: false });
        return {
            displaySettings: { ...DEFAULT_DISPLAY_SETTINGS, ...stored },
            onDisplaySettingsChange: (updater: (previous: DisplaySettings) => DisplaySettings) =>
                setStored((previous) => updater(previous as DisplaySettings)),
        };
    },
}));

afterEach(cleanup);

describe("SoundToggle", () => {
    it("mutes on the first click with legacy settings and can turn sound back on", () => {
        render(<SoundToggle />);
        const button = screen.getByRole("button", { name: "サウンド" });
        expect(button.getAttribute("aria-pressed")).toBe("true");
        fireEvent.click(button);
        expect(button.getAttribute("aria-pressed")).toBe("false");
        expect(button.getAttribute("title")).toBe("サウンドOFF（クリックでON）");
        fireEvent.click(button);
        expect(button.getAttribute("aria-pressed")).toBe("true");
        expect(button.getAttribute("title")).toBe("サウンドON（クリックでOFF）");
    });
});
