import type { PlayFromPosition } from "@shogi/ui";
import { useNavigate } from "@tanstack/react-router";
import { savePlayHandoff } from "../lib/playHandoff";

/**
 * 棋譜ビューア・観戦の「この局面から対局」と、オンライン対局の終局後の「棋譜を検討する」。
 * 局面を `/play` へ引き継いで開く（対局は始めず、先後・相手・持ち時間を選べる状態で開く）。
 * 引き継げず `/play` へ移らなかったときは false を返す。
 */
export function usePlayFromPosition(): (position: PlayFromPosition) => boolean {
    const navigate = useNavigate();
    return (position) => {
        if (!savePlayHandoff(position)) {
            window.alert("局面を引き継げませんでした（ブラウザの保存領域が使えません）。");
            return false;
        }
        void navigate({ to: "/play" });
        return true;
    };
}
