import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { RamNotice } from "./RamNotice";

describe("RamNotice", () => {
    it("error は alert、loading は status として通知される", () => {
        const { rerender } = render(<RamNotice tone="error" title="失敗" />);
        expect(screen.getByRole("alert").textContent).toContain("失敗");
        rerender(<RamNotice tone="loading" title="読み込み中" />);
        expect(screen.getByRole("status").textContent).toContain("読み込み中");
    });

    it("マスコットは通知の読み上げに含めない", () => {
        render(<RamNotice tone="error" title="失敗" />);
        expect(screen.queryByRole("img")).toBeNull();
    });
});
