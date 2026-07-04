import type { RshogiGameMeta, RshogiLiveMove } from "@shogi/match-client";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import {
    appendMoveEval,
    applyMoveComment,
    computeRemaining,
    formatOwnEval,
    moveDetailsToEvals,
    RshogiLiveMetaPanel,
    RshogiLiveScoreboard,
    setMoveEvalAtPly,
    summarizeMoveDetails,
} from "./rshogi-csa-live-viewer";

const META: RshogiGameMeta = { gameId: "game-1", senteName: "alice", goteName: "bob" };

describe("computeRemaining", () => {
    it("手番側 (sideToMove) のみ経過分を減算し、相手側は据え置く", () => {
        const remaining = computeRemaining(
            { sente: 60_000, gote: 45_000, sideToMove: "sente" },
            5_000,
        );
        expect(remaining).toEqual({ sente: 55_000, gote: 45_000 });
    });

    it("後手番では後手側のみ減算する", () => {
        const remaining = computeRemaining(
            { sente: 60_000, gote: 45_000, sideToMove: "gote" },
            5_000,
        );
        expect(remaining).toEqual({ sente: 60_000, gote: 40_000 });
    });

    it("手番側の残時間が経過分を下回っても 0 で止める", () => {
        const remaining = computeRemaining(
            { sente: 3_000, gote: 45_000, sideToMove: "sente" },
            5_000,
        );
        expect(remaining).toEqual({ sente: 0, gote: 45_000 });
    });

    it("clocks 未取得時は両者 0 を返す", () => {
        expect(computeRemaining(null, 5_000)).toEqual({ sente: 0, gote: 0 });
    });
});

describe("formatOwnEval", () => {
    it("正/負/ゼロを符号付きで整形する (その手番視点)", () => {
        expect(formatOwnEval(123)).toBe("+123");
        expect(formatOwnEval(-45)).toBe("-45");
        expect(formatOwnEval(0)).toBe("+0");
    });
    it("±100000 の詰みセンチネルは詰み表記にする", () => {
        expect(formatOwnEval(100_000)).toBe("詰み");
        expect(formatOwnEval(-100_000)).toBe("詰まされ");
    });
});

describe("applyMoveComment (onMoveComment reducer)", () => {
    it("奇数 ply は先手・偶数 ply は後手の eval として保持する (wire=先手視点のまま)", () => {
        const afterSente = applyMoveComment({}, 1, { evalCp: 120, pv: ["+7776FU"] });
        expect(afterSente).toEqual({ senteEvalCp: 120, latestPv: ["+7776FU"] });
        const afterGote = applyMoveComment(afterSente, 2, { evalCp: -80, pv: ["-3334FU"] });
        expect(afterGote).toEqual({
            senteEvalCp: 120,
            goteEvalCp: -80,
            latestPv: ["-3334FU"],
        });
    });
    it("eval/pv の無いコメントは前の値を据え置く", () => {
        const prev = { senteEvalCp: 50, goteEvalCp: -10, latestPv: ["+2726FU"] };
        expect(applyMoveComment(prev, 3, {})).toEqual(prev);
    });
});

describe("summarizeMoveDetails", () => {
    const move = (
        csaMove: string,
        elapsedSec: number,
        comment?: RshogiLiveMove["comment"],
    ): RshogiLiveMove => ({ csaMove, elapsedSec, comment });

    it("各手番の最新 eval・最新 PV・直近消費秒を導出する", () => {
        const details = [
            move("7g7f", 8, { raw: "* 30 -3334FU", evalCp: 30, pv: ["-3334FU"] }),
            move("3c3d", 7, { raw: "* -20 +2726FU", evalCp: -20, pv: ["+2726FU"] }),
            move("2g2f", 5, { raw: "* 45", evalCp: 45 }),
        ];
        expect(summarizeMoveDetails(details)).toEqual({
            senteEvalCp: 45, // ply3 (先手) が最新
            goteEvalCp: -20, // ply2 (後手)
            latestPv: ["+2726FU"], // 最後に PV を持つコメント
            lastMoveElapsedSec: 5,
        });
    });
    it("コメントの無い (旧サーバ) moveDetails は eval/PV undefined・消費秒のみ", () => {
        const details = [move("7g7f", 0), move("3c3d", 0)];
        expect(summarizeMoveDetails(details)).toEqual({
            senteEvalCp: undefined,
            goteEvalCp: undefined,
            latestPv: undefined,
            lastMoveElapsedSec: 0,
        });
    });
    it("空配列では全て undefined", () => {
        expect(summarizeMoveDetails([])).toEqual({
            senteEvalCp: undefined,
            goteEvalCp: undefined,
            latestPv: undefined,
            lastMoveElapsedSec: undefined,
        });
    });
});

describe("moveEvals accumulation (initialReview.moveData の材料)", () => {
    const move = (
        csaMove: string,
        elapsedSec: number,
        comment?: RshogiLiveMove["comment"],
    ): RshogiLiveMove => ({ csaMove, elapsedSec, comment });

    it("moveDetailsToEvals: snapshot を moves と同順・同長の付随情報に変換する", () => {
        const details = [
            // 先手 (奇数 ply): 先手視点 +30
            move("7g7f", 3, { raw: "* 30 -3334FU", evalCp: 30, pv: ["-3334FU"] }),
            // 後手 (偶数 ply): 先手視点 -20 (符号そのまま = 反転しない)
            move("3c3d", 5, { raw: "* -20", evalCp: -20 }),
            // 消費秒のみ (コメント無し)
            move("2g2f", 4),
            // eval も T も無い (旧サーバ) → undefined
            move("8c8d", 0),
        ];
        expect(moveDetailsToEvals(details)).toEqual([
            { elapsedMs: 3000, evalCp: 30 },
            { elapsedMs: 5000, evalCp: -20 },
            { elapsedMs: 4000, evalCp: undefined },
            undefined,
        ]);
    });

    it("moveDetailsToEvals: 詰みセンチネル ±100000 は ±2000 に丸める (evalMate 化しない・グラフ autoscale を潰さない)", () => {
        // ±100000 を素通しすると EvalGraph の autoscale が引き伸ばされ通常評価値が
        // 中央線に潰れるため、表示用に ±2000 へ丸める。evalMate は捏造しない。
        const details = [
            move("3f3e", 3, { raw: "* 100000", evalCp: 100000 }),
            move("5a4b", 2, { raw: "* -100000", evalCp: -100000 }),
        ];
        expect(moveDetailsToEvals(details)).toEqual([
            { elapsedMs: 3000, evalCp: 2000 },
            { elapsedMs: 2000, evalCp: -2000 },
        ]);
    });

    it("setMoveEvalAtPly: 後追いコメントの詰みセンチネルも ±2000 に丸める", () => {
        const prev = [{ elapsedMs: 3000, evalCp: 30 }, { elapsedMs: 6000 }];
        expect(setMoveEvalAtPly(prev, 2, { evalCp: -100000 })).toEqual([
            { elapsedMs: 3000, evalCp: 30 },
            { elapsedMs: 6000, evalCp: -2000 },
        ]);
    });

    it("appendMoveEval: broadcast move は消費秒のみで追加し eval は後追い", () => {
        const prev = [{ elapsedMs: 3000, evalCp: 30 }];
        // T 付きの新規手 → elapsedMs のみ (eval 未確定)
        expect(appendMoveEval(prev, 6)).toEqual([
            { elapsedMs: 3000, evalCp: 30 },
            { elapsedMs: 6000 },
        ]);
        // T 無し (旧サーバ) → undefined を追加
        expect(appendMoveEval(prev, 0)).toEqual([{ elapsedMs: 3000, evalCp: 30 }, undefined]);
    });

    it("setMoveEvalAtPly: 該当 ply に eval を後追いし、消費秒は保持する", () => {
        // onMove で消費秒だけ入った状態に、onMoveComment で ply2 の eval を書き込む
        const prev = [{ elapsedMs: 3000, evalCp: 30 }, { elapsedMs: 6000 }];
        const next = setMoveEvalAtPly(prev, 2, { evalCp: -45 });
        expect(next).toEqual([
            { elapsedMs: 3000, evalCp: 30 },
            { elapsedMs: 6000, evalCp: -45 },
        ]);
        // 元配列は不変
        expect(prev[1]).toEqual({ elapsedMs: 6000 });
    });

    it("setMoveEvalAtPly: eval 無しコメント・範囲外 ply は配列を据え置く", () => {
        const prev = [{ elapsedMs: 3000, evalCp: 30 }];
        expect(setMoveEvalAtPly(prev, 1, {})).toBe(prev); // eval 無し
        expect(setMoveEvalAtPly(prev, 5, { evalCp: 10 })).toBe(prev); // 範囲外
    });

    it("snapshot → 増分 move → 増分 comment の一連で moves と整合する", () => {
        // snapshot: 1 手 (eval 付き)
        let evals = moveDetailsToEvals([move("7g7f", 3, { raw: "* 30", evalCp: 30 })]);
        expect(evals).toEqual([{ elapsedMs: 3000, evalCp: 30 }]);
        // broadcast move (ply2): 消費秒のみ
        evals = appendMoveEval(evals, 5);
        expect(evals).toEqual([{ elapsedMs: 3000, evalCp: 30 }, { elapsedMs: 5000 }]);
        // move comment (ply2): 後手視点でも先手視点 -20 のまま
        evals = setMoveEvalAtPly(evals, 2, { evalCp: -20 });
        expect(evals).toEqual([
            { elapsedMs: 3000, evalCp: 30 },
            { elapsedMs: 5000, evalCp: -20 },
        ]);
    });
});

describe("RshogiLiveScoreboard: 評価値 / 消費時間の表示", () => {
    it("各手番の評価値をその手番視点で表示する (後手は符号反転)", () => {
        render(
            <RshogiLiveScoreboard
                meta={META}
                moveCount={2}
                clocks={{ sente: 60_000, gote: 60_000, sideToMove: "sente" }}
                elapsedSinceAnchor={0}
                connectionState="connected"
                senteEvalCp={120}
                goteEvalCp={-80}
                lastMoveElapsedSec={12}
            />,
        );
        // 先手: wire 120 (先手視点) → そのまま +120
        expect(screen.getByText("評価値 +120")).toBeDefined();
        // 後手: wire -80 (先手視点) → 後手視点 +80
        expect(screen.getByText("評価値 +80")).toBeDefined();
        // 直近手の消費秒
        expect(screen.getByText("直前手 12秒")).toBeDefined();
    });

    it("評価値・消費秒が無いときは評価値/直前手を表示しない (graceful)", () => {
        render(
            <RshogiLiveScoreboard
                meta={META}
                moveCount={0}
                clocks={{ sente: 60_000, gote: 60_000, sideToMove: "sente" }}
                elapsedSinceAnchor={0}
                connectionState="connected"
            />,
        );
        expect(screen.queryByText(/評価値/)).toBeNull();
        expect(screen.queryByText(/直前手/)).toBeNull();
    });
});

describe("RshogiLiveMetaPanel: 読み筋の表示", () => {
    it("最新 PV を CSA トークンで表示する", () => {
        render(<RshogiLiveMetaPanel meta={META} latestPv={["+7776FU", "-3334FU"]} />);
        expect(screen.getByText("読み筋")).toBeDefined();
        expect(screen.getByText("+7776FU -3334FU")).toBeDefined();
    });
    it("長い PV は表示を末尾省略しつつ title には全文を渡す", () => {
        const pv = Array.from({ length: 20 }, (_, i) => `+m${i}`);
        render(<RshogiLiveMetaPanel meta={META} latestPv={pv} />);
        const truncated = screen.getByText(/…$/);
        expect(truncated).toBeDefined();
        // ツールチップ (title) は省略前の全文。
        expect(truncated.getAttribute("title")).toBe(pv.join(" "));
    });
    it("PV が無いときは読み筋を表示しない", () => {
        render(<RshogiLiveMetaPanel meta={META} />);
        expect(screen.queryByText("読み筋")).toBeNull();
    });
});
