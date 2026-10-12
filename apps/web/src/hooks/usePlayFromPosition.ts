import type { PlayFromPosition } from "@shogi/ui";
import { useNavigate } from "@tanstack/react-router";
import { savePlayHandoff } from "../lib/playHandoff";

/**
 * 棋譜ビューア・観戦の「この局面から対局」。
 * いま表示している局面を `/play` へ引き継いで開く（対局は始めず、先後・相手・持ち時間を
 * 選べる状態で開く）。
 */
export function usePlayFromPosition(): (position: PlayFromPosition) => void {
    const navigate = useNavigate();
    return (position) => {
        if (!savePlayHandoff(position)) {
            window.alert("局面を引き継げませんでした（ブラウザの保存領域が使えません）。");
            return;
        }
        void navigate({ to: "/play" });
    };
}
