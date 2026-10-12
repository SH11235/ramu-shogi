/**
 * 棋譜ビューア・観戦の「この局面から対局」。
 *
 * ビューアは棋譜を見るだけの画面なので、対局開始などのボタンは持たない。対局したいときは、
 * いま盤に出ている局面（開始局面と、そこまでの手順）を対局ページへ引き継いで開く。
 * 引き継ぎ先の開き方（Web は `/play` へ移動、Desktop はローカル対局へ切り替え）は呼び出し側が決める。
 */

import { type ReactElement, useRef } from "react";
import { Button } from "./button";

/** 対局ページへ引き継ぐ局面。 */
export interface PlayFromPosition {
    /** 開始局面の SFEN。平手なら `"startpos"`。 */
    sfen: string;
    /** 開始局面から、いま表示している局面までの手順（USI）。分岐を見ていればその分岐の手順。 */
    moves: string[];
}

interface ShownPositionTracker {
    /** `<ShogiMatch onPositionSnapshot>` に渡す。盤に出ている局面が変わるたびに呼ばれる。 */
    handlePositionSnapshot: (snapshot: PlayFromPosition) => void;
    /**
     * いま盤に出ている局面。`startSfen` は表示中の棋譜の開始局面で、盤がまだその棋譜を
     * 読み込んでいない間（別の開始局面の通知しか届いていない間）は開始局面を返す。
     */
    getShownPosition: (startSfen: string) => PlayFromPosition;
    /** 棋譜を切り替えたときに、前の棋譜の局面を忘れる。 */
    reset: () => void;
}

/** 盤に出ている局面を覚えておく（描画には使わないので ref で持ち、再描画を起こさない）。 */
export function useShownPosition(): ShownPositionTracker {
    const shownRef = useRef<PlayFromPosition | null>(null);
    return {
        handlePositionSnapshot: (snapshot) => {
            shownRef.current = { sfen: snapshot.sfen, moves: [...snapshot.moves] };
        },
        getShownPosition: (startSfen) => {
            const shown = shownRef.current;
            return shown && shown.sfen === startSfen ? shown : { sfen: startSfen, moves: [] };
        },
        reset: () => {
            shownRef.current = null;
        },
    };
}

/** 「この局面から対局」。「研究ノートで開く」の隣に置く、控えめなボタン。 */
export function PlayFromPositionButton({ onClick }: { onClick: () => void }): ReactElement {
    return (
        <Button
            type="button"
            variant="outline"
            onClick={onClick}
            title="いま表示している局面を対局ページで開きます（先後・相手・持ち時間は対局ページで選べます）"
        >
            この局面から対局
        </Button>
    );
}
