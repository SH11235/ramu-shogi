import { fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import DogSoundsPage from "./DogSoundsPage";
import catalog from "./dogSoundCatalog.json";

vi.mock("../../components/HeaderNav", () => ({ HeaderNav: () => null }));
vi.mock("../../components/PageHeader", () => ({ PageHeader: () => null }));

describe("DogSoundsPage", () => {
    afterEach(() => vi.unstubAllGlobals());

    it("lists every sound and marks the ones the app plays", () => {
        const { container } = render(<DogSoundsPage />);
        expect(container.querySelectorAll("[data-sound]")).toHaveLength(catalog.length);

        const bark6 = container.querySelector<HTMLElement>('[data-sound="bark6"]');
        expect(bark6).not.toBeNull();
        expect(within(bark6 as HTMLElement).getByText("成り")).toBeTruthy();
        expect(within(bark6 as HTMLElement).getByText("終局")).toBeTruthy();
        const bark4 = container.querySelector<HTMLElement>('[data-sound="bark4"]');
        expect(bark4?.className).toContain("border-l-transparent");
    });

    it("loads a sound only when its play button is pressed", () => {
        const created: string[] = [];
        class FakeAudio {
            onended: (() => void) | null = null;
            constructor(public src = "") {
                if (src) created.push(src);
            }
            canPlayType = () => "probably";
            play = () => Promise.resolve();
            pause = () => {};
        }
        vi.stubGlobal("Audio", FakeAudio);
        render(<DogSoundsPage />);
        expect(created).toEqual([]);
        fireEvent.click(screen.getByRole("button", { name: "v4_07 を再生" }));
        expect(created).toEqual(["/sounds/dog/catalog/v4_07.opus"]);
    });

    it("plays the AAC file when Opus fails to play", async () => {
        const created: string[] = [];
        class FailingOpusAudio {
            onended: (() => void) | null = null;
            constructor(public src = "") {
                if (src) created.push(src);
            }
            canPlayType = () => "maybe";
            play = () =>
                this.src.endsWith(".opus")
                    ? Promise.reject(new DOMException("unsupported", "NotSupportedError"))
                    : Promise.resolve();
            pause = () => {};
        }
        vi.stubGlobal("Audio", FailingOpusAudio);
        render(<DogSoundsPage />);
        fireEvent.click(screen.getByRole("button", { name: "bark1 を再生" }));
        await vi.waitFor(() => expect(created).toHaveLength(2));
        expect(created).toEqual([
            "/sounds/dog/catalog/bark1.opus",
            "/sounds/dog/catalog/bark1.m4a",
        ]);
    });
});
