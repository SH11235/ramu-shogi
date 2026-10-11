/**
 * rshogi viewer の「対局場所」。
 *
 * API の `source` (内部値) と画面上の呼び名の対応をここ 1 か所に置く。
 * 一覧カード・検索フィルタ・単局ページはすべてここを通す。
 */

import type { ReactElement } from "react";

/** 画面上の対局場所の種類。`unknown` は UI がまだ知らない `source`。 */
type RshogiVenueKind = "rshogi" | "floodgate" | "other" | "unknown";

/** 検索フィルタで選べる対局場所。 */
export type RshogiVenueFilterKind = Exclude<RshogiVenueKind, "unknown">;

interface RshogiVenue {
    kind: RshogiVenueKind;
    label: string;
}

const VENUE_LABEL: Record<RshogiVenueFilterKind, string> = {
    rshogi: "rshogi サーバー",
    floodgate: "Floodgate",
    other: "その他",
};

/**
 * `source` から対局場所を決める。
 *
 * - `kifu` / `floodgate` (自前サーバーの対局) → rshogi サーバー
 * - `wdoor` (wdoor の Floodgate から取り込んだ対局) → Floodgate
 * - `upload` (管理者がアップロードした棋譜) → その他。大会名などはイベントタグ側で見せる
 * - 未知の値 → 値をそのまま表示する
 * - 値が無い → undefined (何も表示しない)
 */
export function resolveRshogiVenue(source: string | undefined): RshogiVenue | undefined {
    if (!source) return undefined;
    switch (source) {
        case "kifu":
        case "floodgate":
            return { kind: "rshogi", label: VENUE_LABEL.rshogi };
        case "wdoor":
            return { kind: "floodgate", label: VENUE_LABEL.floodgate };
        case "upload":
            return { kind: "other", label: VENUE_LABEL.other };
        default:
            return { kind: "unknown", label: source };
    }
}

/** 検索フィルタの選択肢と、検索 API に送る `source` の組。 */
export const RSHOGI_VENUE_FILTERS: readonly {
    kind: RshogiVenueFilterKind;
    label: string;
    sources: readonly string[];
}[] = [
    { kind: "rshogi", label: VENUE_LABEL.rshogi, sources: ["kifu", "floodgate"] },
    { kind: "floodgate", label: VENUE_LABEL.floodgate, sources: ["wdoor"] },
    { kind: "other", label: VENUE_LABEL.other, sources: ["upload"] },
];

// 色だけに頼らないよう、種類ごとにアイコンの形も変え、ラベルを必ず併記する。
const VENUE_ICON_CLASS: Record<RshogiVenueKind, string> = {
    rshogi: "bg-wafuu-shu rounded-full",
    floodgate: "bg-wafuu-ai rounded-[2px]",
    other: "bg-wafuu-kincha rotate-45 rounded-[1px]",
    unknown: "bg-wafuu-sumi-light rounded-full opacity-60",
};

/** 対局場所の色付きアイコン + ラベル。`source` が無ければ何も描画しない。 */
export function RshogiVenueBadge({ source }: { source: string | undefined }): ReactElement | null {
    const venue = resolveRshogiVenue(source);
    if (!venue) return null;
    return (
        <span
            data-venue={venue.kind}
            className="inline-flex items-center gap-1.5 font-medium text-wafuu-sumi"
        >
            <span
                aria-hidden="true"
                className={`inline-block h-2 w-2 ${VENUE_ICON_CLASS[venue.kind]}`}
            />
            <span>
                <span className="sr-only">対局場所: </span>
                {venue.label}
            </span>
        </span>
    );
}
