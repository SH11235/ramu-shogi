import { render } from "@testing-library/react";
import { expect, it } from "vitest";
import { Spinner } from "./spinner";

it("動きを減らす設定では回転の代わりに明滅する", () => {
    const { container } = render(<Spinner label="読み込み中" />);
    const spinner = container.firstElementChild;
    expect(spinner?.className).toContain("animate-spin");
    expect(spinner?.className).toContain("motion-reduce:animate-pulse");
    expect(spinner?.getAttribute("aria-busy")).toBe("true");
});
