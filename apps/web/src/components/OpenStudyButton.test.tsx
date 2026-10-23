import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { OpenStudyButton } from "./OpenStudyButton";

vi.mock("@tanstack/react-router", () => ({ useNavigate: () => vi.fn() }));
vi.mock("../hooks/useAuthSession", () => ({
    useAuthSession: () => ({ session: null, isLoadingSession: false, sessionError: null }),
}));
vi.mock("../lib/studySync", () => ({ ensureStudySession: vi.fn(async () => {}) }));

describe("OpenStudyButton", () => {
    afterEach(() => {
        vi.useRealTimers();
    });

    it("小さいボタンのエラーは、下の操作を塞がずに重ねて出し、しばらくすると消える", async () => {
        vi.useFakeTimers();
        render(
            <OpenStudyButton
                size="compact"
                label="研究ノート"
                open={async () => {
                    throw new Error("オフラインです");
                }}
            />,
        );
        await act(async () => {
            fireEvent.click(screen.getByRole("button", { name: "研究ノート" }));
        });
        const alert = screen.getByRole("alert");
        expect(alert.textContent).toContain("オフラインです");
        expect(alert.className).toContain("pointer-events-none");
        expect(alert.className).toContain("absolute");

        act(() => {
            vi.advanceTimersByTime(6000);
        });
        expect(screen.queryByRole("alert")).toBeNull();
    });
});
