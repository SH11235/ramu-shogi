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

    it("棋譜を見るだけの画面でも、検討の案内とメッセージは出す", () => {
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
        expect(screen.getByText("検討モード: 駒を動かして分岐を作成できます")).toBeTruthy();
        expect(screen.getByText("合法手ではありません")).toBeTruthy();
    });
});
