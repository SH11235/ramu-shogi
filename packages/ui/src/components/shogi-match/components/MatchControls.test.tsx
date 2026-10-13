import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { GameMode } from "../types";
import { MatchControls } from "./MatchControls";

afterEach(cleanup);

const noop = () => {};

function renderControls(gameMode: GameMode, viewerMode?: boolean) {
    return render(
        <MatchControls
            onResetToStartpos={noop}
            onStop={noop}
            onStart={noop}
            onStartReview={noop}
            onEnterEditMode={noop}
            onResign={noop}
            onUndo={noop}
            isMatchRunning={false}
            gameMode={gameMode}
            message={null}
            onOpenSettings={noop}
            viewerMode={viewerMode}
        />,
    );
}

const buttonNames = () => screen.queryAllByRole("button").map((button) => button.textContent);

describe("MatchControls", () => {
    it("通常の画面では、検討モードで対局開始・棋譜読込・平手に戻す・局面編集を出す", () => {
        renderControls("reviewing");
        expect(buttonNames()).toEqual(["対局開始", "棋譜読込", "平手に戻す", "局面編集"]);
    });

    it("通常の画面では、一時停止中に対局再開・棋譜読込・局面編集・投了を出す", () => {
        renderControls("paused");
        expect(buttonNames()).toEqual(["対局再開", "棋譜読込", "局面編集", "投了"]);
    });

    it.each<GameMode>([
        "reviewing",
        "editing",
        "paused",
    ])("棋譜を見るだけの画面では、対局を始める・棋譜を読み込む・局面を編集するボタンを出さない（%s）", (gameMode) => {
        renderControls(gameMode, true);
        expect(buttonNames()).toEqual([]);
        for (const label of ["対局開始", "対局再開", "棋譜読込", "局面編集", "平手に戻す"]) {
            expect(screen.queryByText(label)).toBeNull();
        }
    });

    it("棋譜を見るだけの画面は、メッセージだけを出す（盤を操作できないので、検討の案内は出さない）", () => {
        render(
            <MatchControls
                onResetToStartpos={noop}
                onStop={noop}
                onStart={noop}
                isMatchRunning={false}
                gameMode="reviewing"
                message={{ text: "合法手ではありません", type: "error" }}
                viewerMode
            />,
        );
        expect(screen.queryByText(/検討モード/)).toBeNull();
        expect(screen.getByText("合法手ではありません")).toBeTruthy();
    });

    it("長いメッセージは、盤の列を横に広げずに折り返す", () => {
        // 盤の列は中身の幅で決まるので、メッセージは幅の計算に加えず、列の幅で折り返す。
        const text =
            "解析を開始できません: 評価関数がダウンロードされていません。\n開いた画面でダウンロードしてから、もう一度お試しください。";
        for (const viewerMode of [true, false]) {
            const view = render(
                <MatchControls
                    onResetToStartpos={noop}
                    onStop={noop}
                    onStart={noop}
                    isMatchRunning={false}
                    gameMode="reviewing"
                    message={{ text, type: "error" }}
                    viewerMode={viewerMode}
                />,
            );
            const messageElement = screen.getByText(/解析を開始できません/);
            // 外側が盤の列の幅を受け取らないと、メッセージが案内文の幅（無ければ 0）で折り返される。
            expect(messageElement.parentElement?.className.split(" ")).toContain("w-full");
            const classes = messageElement.className.split(" ");
            expect(classes).toEqual(
                expect.arrayContaining(["w-0", "min-w-full", "whitespace-pre-line"]),
            );
            view.unmount();
        }
    });
});
