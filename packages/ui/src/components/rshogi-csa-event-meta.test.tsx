import { fetchRshogiGameEvents, type RshogiGameEventSummary } from "@shogi/match-client";
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import {
    findRshogiEventMeta,
    RshogiEventMetaDetail,
    RshogiEventMetaLine,
} from "./rshogi-csa-event-meta";

/** 実際のクライアント（検証つきの読み取り）を通して、API の応答からイベント一覧を作る。 */
const eventsFromWire = (events: unknown[]): Promise<RshogiGameEventSummary[]> =>
    fetchRshogiGameEvents({
        baseUrl: "https://rshogi.example.com/api/v1",
        fetchImpl: vi.fn(
            async () => new Response(JSON.stringify({ events }), { status: 200 }),
        ) as unknown as typeof fetch,
    });

describe("findRshogiEventMeta", () => {
    const events: RshogiGameEventSummary[] = [
        { event: "A", source: "wdoor", games: 1 },
        { event: "A", source: "upload", games: 2, meta: { title: "大会 A" } },
        { event: "B", source: "upload", games: 3, meta: { title: "大会 B（upload）" } },
        { event: "B", source: "kifu", games: 1, meta: { title: "大会 B（kifu）" } },
        { event: "C", source: "upload", games: 1 },
    ];

    it("タグが同じ行のメタを返す。メタの無いイベント・タグ無しは undefined", () => {
        expect(findRshogiEventMeta(events, "A")?.title).toBe("大会 A");
        expect(findRshogiEventMeta(events, "C")).toBeUndefined();
        expect(findRshogiEventMeta(events, "無い大会")).toBeUndefined();
        expect(findRshogiEventMeta(events, undefined)).toBeUndefined();
        expect(findRshogiEventMeta([], "A")).toBeUndefined();
    });

    it("source が分かっていればその行を優先し、その行にメタが無ければ同じタグの別の行を使う", () => {
        expect(findRshogiEventMeta(events, "B", "kifu")?.title).toBe("大会 B（kifu）");
        expect(findRshogiEventMeta(events, "B")?.title).toBe("大会 B（upload）");
        expect(findRshogiEventMeta(events, "A", "wdoor")?.title).toBe("大会 A");
    });
});

describe("イベントのメタデータの表示（API の応答から）", () => {
    it("不正な URL はリンクにせず、正式名称と主催だけを出す", async () => {
        const events = await eventsFromWire([
            {
                event: "WCSC36",
                source: "upload",
                games: 1,
                meta: {
                    title: "第36回世界コンピュータ将棋選手権",
                    organizer: "コンピュータ将棋協会",
                    official_url: "javascript:alert(1)",
                    kifu_source_url: "ftp://example.org/kifu/",
                    terms_note: "運用メモ",
                },
            },
        ]);
        const meta = findRshogiEventMeta(events, "WCSC36");
        if (!meta) throw new Error("meta should be decoded");

        const { container, unmount } = render(<RshogiEventMetaDetail meta={meta} />);
        expect(screen.getByText("第36回世界コンピュータ将棋選手権")).toBeTruthy();
        expect(screen.getByText("主催: コンピュータ将棋協会")).toBeTruthy();
        expect(container.querySelector("a")).toBeNull();
        expect(container.innerHTML).not.toContain("javascript:");
        expect(container.textContent).not.toContain("運用メモ");
        unmount();

        const line = render(<RshogiEventMetaLine meta={meta} />);
        expect(line.container.textContent).toBe(
            "第36回世界コンピュータ将棋選手権（コンピュータ将棋協会）",
        );
        expect(line.container.querySelector("a")).toBeNull();
    });

    it("片方の URL だけが正しいときは、そのリンクだけを新しいタブで開く形で出す", async () => {
        const events = await eventsFromWire([
            {
                event: "DR5",
                games: 1,
                meta: {
                    title: "第5回電竜戦",
                    organizer: null,
                    official_url: "https://example.org/denryu5/",
                    kifu_source_url: "example.org/kifu",
                },
            },
        ]);
        const meta = findRshogiEventMeta(events, "DR5");
        if (!meta) throw new Error("meta should be decoded");

        const { container } = render(<RshogiEventMetaLine meta={meta} />);
        expect(container.textContent).toBe("第5回電竜戦・大会の公式ページ");
        const links = screen.getAllByRole("link");
        expect(links).toHaveLength(1);
        expect(links[0].getAttribute("href")).toBe("https://example.org/denryu5/");
        expect(links[0].getAttribute("target")).toBe("_blank");
        expect(links[0].getAttribute("rel")).toBe("noopener noreferrer");
    });

    it("未知の形のメタは、メタ無しとして扱う", async () => {
        const events = await eventsFromWire([
            { event: "X", games: 1, meta: { organizer: "名称が無い" } },
            { event: "Y", games: 1, meta: "文字列" },
        ]);
        expect(findRshogiEventMeta(events, "X")).toBeUndefined();
        expect(findRshogiEventMeta(events, "Y")).toBeUndefined();
    });
});
