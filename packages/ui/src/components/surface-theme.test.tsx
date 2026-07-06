import { render, screen } from "@testing-library/react";
import type { ReactElement } from "react";
import { describe, expect, it } from "vitest";
import { Dialog, DialogContent, DialogTitle } from "./dialog";
import { SurfaceThemeProvider, useSurfaceTheme } from "./surface-theme";

function ThemeProbe(): ReactElement {
    const theme = useSurfaceTheme();
    return <span data-testid="probe">{theme ?? "(none)"}</span>;
}

describe("SurfaceThemeProvider / useSurfaceTheme", () => {
    it("Provider 外では undefined", () => {
        render(<ThemeProbe />);
        expect(screen.getByTestId("probe").textContent).toBe("(none)");
    });

    it("Provider 内では dark が伝搬する", () => {
        render(
            <SurfaceThemeProvider theme="dark">
                <ThemeProbe />
            </SurfaceThemeProvider>,
        );
        expect(screen.getByTestId("probe").textContent).toBe("dark");
    });

    it("theme=undefined の Provider は何も上書きしない", () => {
        render(
            <SurfaceThemeProvider theme={undefined}>
                <ThemeProbe />
            </SurfaceThemeProvider>,
        );
        expect(screen.getByTestId("probe").textContent).toBe("(none)");
    });

    it("theme=undefined をネストしても親の dark を消さない", () => {
        render(
            <SurfaceThemeProvider theme="dark">
                <SurfaceThemeProvider theme={undefined}>
                    <ThemeProbe />
                </SurfaceThemeProvider>
            </SurfaceThemeProvider>,
        );
        expect(screen.getByTestId("probe").textContent).toBe("dark");
    });
});

describe("Portal 系 Content へのテーマ伝搬", () => {
    it("dark サーフェス内から開いた Dialog は Portal 先でも dark クラスを持つ", () => {
        render(
            <SurfaceThemeProvider theme="dark">
                <Dialog open>
                    <DialogContent>
                        <DialogTitle>設定</DialogTitle>
                    </DialogContent>
                </Dialog>
            </SurfaceThemeProvider>,
        );
        const content = screen.getByRole("dialog");
        expect(content.className.split(" ")).toContain("dark");
    });

    it("Provider 外の Dialog に dark は付かない", () => {
        render(
            <Dialog open>
                <DialogContent>
                    <DialogTitle>設定</DialogTitle>
                </DialogContent>
            </Dialog>,
        );
        const content = screen.getByRole("dialog");
        expect(content.className.split(" ")).not.toContain("dark");
    });
});
