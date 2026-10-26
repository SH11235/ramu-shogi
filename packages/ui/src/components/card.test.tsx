import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Card, cardVariants } from "./card";

describe("Card", () => {
    it("既定は角丸 xl・枠線・カードの地で、影も余白も付けない", () => {
        render(<Card data-testid="card" />);
        const classes = screen.getByTestId("card").className.split(" ");
        expect(classes).toEqual(
            expect.arrayContaining(["rounded-xl", "border", "border-border", "bg-card"]),
        );
        expect(classes.some((c) => c.startsWith("shadow-"))).toBe(false);
        expect(classes.some((c) => /^p[xytrbl]?-/.test(c))).toBe(false);
    });

    it("影は raised が shadow-sm、floating が shadow-panel", () => {
        expect(cardVariants({ elevation: "raised" })).toContain("shadow-sm");
        expect(cardVariants({ elevation: "floating" })).toContain("shadow-panel");
    });

    it("inset は角丸 md の背景色の枠", () => {
        const classes = cardVariants({ variant: "inset" }).split(" ");
        expect(classes).toEqual(expect.arrayContaining(["rounded-md", "bg-background"]));
        expect(classes).not.toContain("rounded-xl");
    });

    it("className で地の色や影を上書きできる", () => {
        render(<Card data-testid="card" elevation="raised" className="bg-muted shadow-panel" />);
        const classes = screen.getByTestId("card").className.split(" ");
        expect(classes).toContain("bg-muted");
        expect(classes).not.toContain("bg-card");
        expect(classes).toContain("shadow-panel");
        expect(classes).not.toContain("shadow-sm");
    });

    it("asChild では子の要素にカードの見た目を付ける", () => {
        render(
            <Card asChild variant="washi" interactive>
                <section aria-label="棋譜">中身</section>
            </Card>,
        );
        const section = screen.getByRole("region", { name: "棋譜" });
        expect(section.tagName).toBe("SECTION");
        expect(section.className).toContain("bg-wafuu-washi-warm");
        expect(section.className).toContain("hover:bg-muted/20");
    });
});
