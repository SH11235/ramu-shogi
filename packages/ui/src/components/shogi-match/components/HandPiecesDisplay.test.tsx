import { render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { HandPiecesDisplay } from "./HandPiecesDisplay";

describe("HandPiecesDisplay", () => {
    const defaultHand = {
        R: 0,
        B: 0,
        G: 0,
        S: 0,
        N: 0,
        L: 0,
        P: 0,
    };

    const mockHandSelect = vi.fn();

    /**
     * 実際の駒表示エリアのみをクエリするヘルパー
     * （レイアウト維持用の不可視プレースホルダーを除外）
     */
    const getActualPiecesContainer = () => screen.getByTestId("hand-pieces-actual");

    describe("レイアウトロジック", () => {
        it("対局前は count=0 でも全駒種を表示する", () => {
            render(
                <HandPiecesDisplay
                    owner="sente"
                    hand={defaultHand}
                    selectedPiece={null}
                    isActive={false}
                    onHandSelect={mockHandSelect}
                    size="normal"
                    isMatchRunning={false}
                />,
            );

            const container = getActualPiecesContainer();
            // 対局前は全7種類の駒が表示される（画像のalt属性で確認）
            expect(within(container).getByAltText("先手の飛")).toBeDefined();
            expect(within(container).getByAltText("先手の角")).toBeDefined();
            expect(within(container).getByAltText("先手の金")).toBeDefined();
            expect(within(container).getByAltText("先手の銀")).toBeDefined();
            expect(within(container).getByAltText("先手の桂")).toBeDefined();
            expect(within(container).getByAltText("先手の香")).toBeDefined();
            expect(within(container).getByAltText("先手の歩")).toBeDefined();
        });

        it("対局中は count=0 の駒は表示しない（normal サイズ）", () => {
            render(
                <HandPiecesDisplay
                    owner="sente"
                    hand={{ ...defaultHand, P: 3, G: 1 }}
                    selectedPiece={null}
                    isActive={false}
                    onHandSelect={mockHandSelect}
                    size="normal"
                    isMatchRunning={true}
                />,
            );

            const container = getActualPiecesContainer();
            // 持っている駒のみ表示
            expect(within(container).getByAltText("先手の金")).toBeDefined();
            expect(within(container).getByAltText("先手の歩")).toBeDefined();

            // 持っていない駒は表示されない
            expect(within(container).queryByAltText("先手の飛")).toBeNull();
            expect(within(container).queryByAltText("先手の角")).toBeNull();
            expect(within(container).queryByAltText("先手の銀")).toBeNull();
            expect(within(container).queryByAltText("先手の桂")).toBeNull();
            expect(within(container).queryByAltText("先手の香")).toBeNull();
        });

        it("対局中は count=0 の駒は表示しない（compact サイズ）", () => {
            render(
                <HandPiecesDisplay
                    owner="sente"
                    hand={{ ...defaultHand, P: 3, G: 1 }}
                    selectedPiece={null}
                    isActive={false}
                    onHandSelect={mockHandSelect}
                    size="compact"
                    isMatchRunning={true}
                />,
            );

            const container = getActualPiecesContainer();
            // 持っている駒のみ表示
            expect(within(container).getByAltText("先手の金")).toBeDefined();
            expect(within(container).getByAltText("先手の歩")).toBeDefined();

            // 持っていない駒は表示されない
            expect(within(container).queryByAltText("先手の飛")).toBeNull();
            expect(within(container).queryByAltText("先手の角")).toBeNull();
            expect(within(container).queryByAltText("先手の銀")).toBeNull();
            expect(within(container).queryByAltText("先手の桂")).toBeNull();
            expect(within(container).queryByAltText("先手の香")).toBeNull();
        });

        it("medium サイズでも count=0 の駒は表示しない（対局中）", () => {
            render(
                <HandPiecesDisplay
                    owner="gote"
                    hand={{ ...defaultHand, R: 1 }}
                    selectedPiece={null}
                    isActive={false}
                    onHandSelect={mockHandSelect}
                    size="medium"
                    isMatchRunning={true}
                />,
            );

            const container = getActualPiecesContainer();
            // 持っている飛車のみ表示
            expect(within(container).getByAltText("後手の飛")).toBeDefined();

            // 他は表示されない
            expect(within(container).queryByAltText("後手の角")).toBeNull();
            expect(within(container).queryByAltText("後手の金")).toBeNull();
        });

        it("compact サイズでも編集モードでは全駒種を表示する", () => {
            render(
                <HandPiecesDisplay
                    owner="sente"
                    hand={defaultHand}
                    selectedPiece={null}
                    isActive={false}
                    onHandSelect={mockHandSelect}
                    size="compact"
                    isEditMode={true}
                />,
            );

            const container = getActualPiecesContainer();
            // 編集モードでは全7種類の駒が表示される
            expect(within(container).getByAltText("先手の飛")).toBeDefined();
            expect(within(container).getByAltText("先手の角")).toBeDefined();
            expect(within(container).getByAltText("先手の金")).toBeDefined();
            expect(within(container).getByAltText("先手の銀")).toBeDefined();
            expect(within(container).getByAltText("先手の桂")).toBeDefined();
            expect(within(container).getByAltText("先手の香")).toBeDefined();
            expect(within(container).getByAltText("先手の歩")).toBeDefined();
        });
    });

    describe("プレイヤーマーカー", () => {
        it("先手の場合は ☗ マーカーを表示", () => {
            render(
                <HandPiecesDisplay
                    owner="sente"
                    hand={defaultHand}
                    selectedPiece={null}
                    isActive={false}
                    onHandSelect={mockHandSelect}
                />,
            );

            expect(screen.getByText("☗")).toBeDefined();
        });

        it("後手の場合は ☖ マーカーを表示", () => {
            render(
                <HandPiecesDisplay
                    owner="gote"
                    hand={defaultHand}
                    selectedPiece={null}
                    isActive={false}
                    onHandSelect={mockHandSelect}
                />,
            );

            expect(screen.getByText("☖")).toBeDefined();
        });
    });

    describe("±ボタン表示", () => {
        it("normal サイズかつ編集モードでは ± ボタンが表示される", () => {
            render(
                <HandPiecesDisplay
                    owner="sente"
                    hand={{ ...defaultHand, P: 2 }}
                    selectedPiece={null}
                    isActive={false}
                    onHandSelect={mockHandSelect}
                    size="normal"
                    isEditMode={true}
                    onIncrement={vi.fn()}
                    onDecrement={vi.fn()}
                />,
            );

            // + と − ボタンが存在する（複数あるので getAllByText を使用）
            const plusButtons = screen.getAllByText("+");
            const minusButtons = screen.getAllByText("−");

            expect(plusButtons.length).toBeGreaterThan(0);
            expect(minusButtons.length).toBeGreaterThan(0);
        });

        it("compact サイズでも編集モードでは ± ボタンが表示される", () => {
            render(
                <HandPiecesDisplay
                    owner="sente"
                    hand={{ ...defaultHand, P: 2 }}
                    selectedPiece={null}
                    isActive={false}
                    onHandSelect={mockHandSelect}
                    size="compact"
                    isEditMode={true}
                    onIncrement={vi.fn()}
                    onDecrement={vi.fn()}
                />,
            );

            const plusButtons = screen.getAllByText("+");
            expect(plusButtons.length).toBeGreaterThan(0);
        });
    });
});
