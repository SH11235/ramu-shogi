/**
 * 別のページで見ていた局面を、対局ページ（`/play`）へ引き継ぐ。
 *
 * 手順は長くなりうるので URL には載せず、同じタブの sessionStorage に置く。
 * 渡す側（棋譜ビューアの「この局面から対局」）が `savePlayHandoff` で置いてから `/play` へ移り、
 * `/play` が開くときに `readPlayHandoff` で読んで、読み終えたら `clearPlayHandoff` で消す
 * （`/play` を開き直したときに、前の局面がまた出てこないようにする）。
 */

import type { PlayFromPosition } from "@shogi/ui";

const PLAY_HANDOFF_KEY = "ramu_review_kifu";

/** 引き継ぐ局面を置く。置けなかったら（ストレージが使えない等）false。 */
export function savePlayHandoff(position: PlayFromPosition): boolean {
    try {
        window.sessionStorage.setItem(
            PLAY_HANDOFF_KEY,
            JSON.stringify({ sfen: position.sfen, moves: position.moves }),
        );
        return true;
    } catch {
        return false;
    }
}

/** 引き継がれた局面を読む（消さない）。無い・壊れているときは undefined。 */
export function readPlayHandoff(): PlayFromPosition | undefined {
    try {
        const raw = window.sessionStorage.getItem(PLAY_HANDOFF_KEY);
        if (!raw) return undefined;
        const parsed: unknown = JSON.parse(raw);
        if (parsed === null || typeof parsed !== "object") return undefined;
        const { sfen, moves } = parsed as { sfen?: unknown; moves?: unknown };
        if (typeof sfen !== "string" || sfen.trim() === "") return undefined;
        if (!Array.isArray(moves) || !moves.every((move) => typeof move === "string")) {
            return undefined;
        }
        return { sfen, moves };
    } catch {
        return undefined;
    }
}

/** 引き継がれた局面を消す。 */
export function clearPlayHandoff(): void {
    try {
        window.sessionStorage.removeItem(PLAY_HANDOFF_KEY);
    } catch {
        // ストレージが使えないなら、消すものも無い。
    }
}
