/**
 * イベント (大会など) のメタデータの表示。
 *
 * 大会の正式名称・主催・公式ページ・棋譜の出典は、アプリに書かず、棋譜サーバーのイベント一覧
 * (`GET /games/events` の `meta`) から受け取る。メタが登録されていないイベントと、メタに
 * 対応していない古いサーバーでは何も出さず、呼び出し側はイベントのタグだけを表示する。
 */

import { cn } from "@shogi/design-system";
import type { RshogiGameEventMeta, RshogiGameEventSummary } from "@shogi/match-client";
import type { ReactElement } from "react";

/**
 * イベントのタグに対応するメタデータを探す。
 *
 * イベント一覧は `(event, source)` ごとの行なので、`source` が分かっていればその行を優先し、
 * 無ければ同じタグの行のうちメタを持つものを使う。
 */
export function findRshogiEventMeta(
    events: readonly RshogiGameEventSummary[],
    event: string | undefined,
    source?: string,
): RshogiGameEventMeta | undefined {
    if (!event) return undefined;
    let fallback: RshogiGameEventMeta | undefined;
    for (const entry of events) {
        if (entry.event !== event || !entry.meta) continue;
        if (source !== undefined && entry.source === source) return entry.meta;
        fallback ??= entry.meta;
    }
    return fallback;
}

const LINK_CLASS = "text-wafuu-ai underline underline-offset-2 hover:text-wafuu-ai-light";

interface RshogiEventLinkItem {
    key: string;
    href: string;
    label: string;
}

const eventLinkItems = (meta: RshogiGameEventMeta): RshogiEventLinkItem[] => {
    const items: RshogiEventLinkItem[] = [];
    if (meta.officialUrl) {
        items.push({ key: "official", href: meta.officialUrl, label: "大会の公式ページ" });
    }
    if (meta.kifuSourceUrl) {
        items.push({ key: "kifu-source", href: meta.kifuSourceUrl, label: "棋譜の出典" });
    }
    return items;
};

function RshogiEventLink({ item }: { item: RshogiEventLinkItem }): ReactElement {
    return (
        <a href={item.href} target="_blank" rel="noopener noreferrer" className={LINK_CLASS}>
            {item.label}
            {/* 外部サイトを新しいタブで開くことを、見た目（矢印）と読み上げ（文）の両方で伝える */}
            <span aria-hidden="true"> ↗</span>
            <span className="sr-only">（新しいタブで開く）</span>
        </a>
    );
}

/**
 * 対局情報の「イベント」の欄の中身。正式名称、主催、公式ページと棋譜の出典へのリンクを縦に並べる。
 * `terms_note` は利用者向けの文ではないので出さない。
 */
export function RshogiEventMetaDetail({ meta }: { meta: RshogiGameEventMeta }): ReactElement {
    const links = eventLinkItems(meta);
    return (
        <>
            <span>{meta.title}</span>
            {meta.organizer && (
                <span className="text-xs text-muted-foreground">主催: {meta.organizer}</span>
            )}
            {links.length > 0 && (
                <span className="flex flex-wrap gap-x-3 gap-y-1 text-xs">
                    {links.map((item) => (
                        <RshogiEventLink key={item.key} item={item} />
                    ))}
                </span>
            )}
        </>
    );
}

/**
 * 一覧の上に出す、絞り込んでいるイベントの 1 行: 「正式名称（主催）・公式ページ・棋譜の出典」。
 *
 * 一覧の見出しなので背景と枠は付けない（背景付きのカードは、脇に置く補足情報のかたまりだけに使う）。
 */
export function RshogiEventMetaLine({
    meta,
    className,
}: {
    meta: RshogiGameEventMeta;
    className?: string;
}): ReactElement {
    const links = eventLinkItems(meta);
    return (
        <p
            data-testid="rshogi-event-meta-line"
            className={cn(
                "flex flex-wrap items-baseline gap-x-2 gap-y-1 text-sm text-wafuu-sumi",
                className,
            )}
        >
            <span className="font-semibold [overflow-wrap:anywhere]">
                {meta.title}
                {meta.organizer && (
                    <span className="font-normal text-muted-foreground">（{meta.organizer}）</span>
                )}
            </span>
            {links.map((item) => (
                <span key={item.key} className="flex items-baseline gap-x-2 text-xs">
                    <span aria-hidden="true" className="text-muted-foreground">
                        ・
                    </span>
                    <RshogiEventLink item={item} />
                </span>
            ))}
        </p>
    );
}
