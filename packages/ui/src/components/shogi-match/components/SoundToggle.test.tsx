import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ShogiMatchProvider } from "../ShogiMatchContext";
import { DEFAULT_DISPLAY_SETTINGS, type DisplaySettings } from "../types";
import { SoundToggle } from "./SoundToggle";

vi.mock("../contexts/MatchStateContext", () => ({
    useMatchState: () => {
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

    describe("in a CPU game", () => {
        function renderMenu() {
            const previewSound = vi.fn();
            render(
                <ShogiMatchProvider config={{ soundVoiceSelectable: true, previewSound }}>
                    <SoundToggle />
                </ShogiMatchProvider>,
            );
            return previewSound;
        }

        it("closes the menu on Tab and returns focus to the button", async () => {
            renderMenu();
            const button = screen.getByRole("button", { name: "着手音: 犬" });
            fireEvent.click(button);
            for (const item of screen.getAllByRole("menuitemradio")) {
                expect(item.tabIndex).toBe(-1);
            }
            fireEvent.keyDown(document.activeElement as HTMLElement, { key: "Tab" });
            expect(screen.queryByRole("menu")).toBeNull();
            await waitFor(() => expect(document.activeElement).toBe(button));
        });

        it("defaults to the dog voice and can be turned off in one choice", () => {
            const previewSound = renderMenu();
            fireEvent.click(screen.getByRole("button", { name: "着手音: 犬" }));
            fireEvent.click(screen.getByRole("menuitemradio", { name: "OFF" }));
            expect(screen.getByRole("button", { name: "着手音: OFF" })).toBeTruthy();
            expect(screen.queryByRole("menuitemradio")).toBeNull();
            expect(previewSound).not.toHaveBeenCalled();
        });

        it("previews the chosen voice and turns sound back on", () => {
            const previewSound = renderMenu();
            fireEvent.click(screen.getByRole("button", { name: "着手音: 犬" }));
            fireEvent.click(screen.getByRole("menuitemradio", { name: "OFF" }));
            fireEvent.click(screen.getByRole("button", { name: "着手音: OFF" }));
            fireEvent.click(screen.getByRole("menuitemradio", { name: "通常" }));
            expect(screen.getByRole("button", { name: "着手音: 通常" })).toBeTruthy();
            expect(previewSound).toHaveBeenLastCalledWith("standard");
        });

        it("focuses the current choice and moves with arrow keys without choosing", () => {
            const previewSound = renderMenu();
            fireEvent.click(screen.getByRole("button", { name: "着手音: 犬" }));
            expect(document.activeElement).toBe(screen.getByRole("menuitemradio", { name: "犬" }));
            fireEvent.keyDown(document.activeElement as Element, { key: "ArrowDown" });
            fireEvent.keyDown(document.activeElement as Element, { key: "ArrowDown" });
            expect(document.activeElement).toBe(screen.getByRole("menuitemradio", { name: "OFF" }));
            expect(
                screen.getByRole("menuitemradio", { name: "犬" }).getAttribute("aria-checked"),
            ).toBe("true");
            expect(previewSound).not.toHaveBeenCalled();
        });

        it("keeps menu arrow keys away from the kifu keyboard navigation", () => {
            renderMenu();
            const onDocumentKeyDown = vi.fn();
            document.addEventListener("keydown", onDocumentKeyDown);
            fireEvent.click(screen.getByRole("button", { name: "着手音: 犬" }));
            for (const key of ["ArrowDown", "ArrowLeft", "ArrowRight", "Home", "End"]) {
                fireEvent.keyDown(document.activeElement as Element, { key });
            }
            document.removeEventListener("keydown", onDocumentKeyDown);
            expect(onDocumentKeyDown).not.toHaveBeenCalled();
        });
    });
});
