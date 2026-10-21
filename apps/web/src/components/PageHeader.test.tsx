import { render } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@tanstack/react-router", () => ({
    Link: ({ to, children }: { to: string; children: ReactNode }) => <a href={to}>{children}</a>,
}));
vi.mock("./NavDrawer", () => ({ NavDrawer: () => null }));

const { PageHeader } = await import("./PageHeader");

describe("PageHeader", () => {
    beforeEach(() => {
        document.title = "ラム将棋";
    });

    it("タブの名前を現在地にし、外したら元に戻す", () => {
        const { unmount } = render(
            <PageHeader
                items={[
                    { label: "ラム将棋", to: "/" },
                    { label: "オンライン対局", to: "/online" },
                    { label: "対局設定" },
                ]}
            />,
        );
        expect(document.title).toBe("対局設定 | ラム将棋");
        unmount();
        expect(document.title).toBe("ラム将棋");
    });

    it("トップではサイト名だけにする", () => {
        render(<PageHeader items={[{ label: "ラム将棋" }]} />);
        expect(document.title).toBe("ラム将棋");
    });

    it("現在地が変わったらタブの名前も変える", () => {
        const { rerender } = render(<PageHeader items={[{ label: "研究ノート" }]} />);
        rerender(<PageHeader items={[{ label: "矢倉の研究" }]} />);
        expect(document.title).toBe("矢倉の研究 | ラム将棋");
    });
});
