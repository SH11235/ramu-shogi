import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { RSHOGI_VENUE_FILTERS, RshogiVenueBadge, resolveRshogiVenue } from "./rshogi-csa-venue";

describe("resolveRshogiVenue", () => {
    it("自前サーバーの対局 (kifu / floodgate) は「rshogi サーバー」", () => {
        expect(resolveRshogiVenue("kifu")).toEqual({ kind: "rshogi", label: "rshogi サーバー" });
        expect(resolveRshogiVenue("floodgate")).toEqual({
            kind: "rshogi",
            label: "rshogi サーバー",
        });
    });

    it("wdoor は「Floodgate」、upload は「その他」に固定する", () => {
        expect(resolveRshogiVenue("wdoor")).toEqual({ kind: "floodgate", label: "Floodgate" });
        expect(resolveRshogiVenue("upload")).toEqual({ kind: "other", label: "その他" });
    });

    it("未知の値はそのまま表示し、値が無ければ undefined", () => {
        expect(resolveRshogiVenue("future-source")).toEqual({
            kind: "unknown",
            label: "future-source",
        });
        expect(resolveRshogiVenue(undefined)).toBeUndefined();
        expect(resolveRshogiVenue("")).toBeUndefined();
    });
});

describe("RSHOGI_VENUE_FILTERS", () => {
    it("対局場所ごとに検索 API へ送る source を持つ", () => {
        expect(RSHOGI_VENUE_FILTERS.map((f) => [f.label, f.sources.join(",")])).toEqual([
            ["rshogi サーバー", "kifu,floodgate"],
            ["Floodgate", "wdoor"],
            ["その他", "upload"],
        ]);
    });

    it("どの source も、対応する対局場所のラベルに解決される", () => {
        for (const filter of RSHOGI_VENUE_FILTERS) {
            for (const source of filter.sources) {
                expect(resolveRshogiVenue(source)).toEqual({
                    kind: filter.kind,
                    label: filter.label,
                });
            }
        }
    });
});

describe("RshogiVenueBadge", () => {
    it("色付きアイコンに加えてラベルを文字で出す", () => {
        const { container } = render(<RshogiVenueBadge source="wdoor" />);
        expect(screen.getByText("Floodgate")).toBeTruthy();
        expect(container.querySelector("[data-venue='floodgate']")).toBeTruthy();
        expect(container.querySelector("[aria-hidden='true']")).toBeTruthy();
    });

    it("source が無ければ何も描画しない", () => {
        const { container } = render(<RshogiVenueBadge source={undefined} />);
        expect(container.innerHTML).toBe("");
    });
});
