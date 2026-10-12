import { cleanup, render, screen } from "@testing-library/react";
import { StrictMode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { savePlayHandoff } from "./lib/playHandoff";

interface CapturedShogiMatchProps {
    initialReview?: { sfen: string; moves: string[] };
    reviewMode?: boolean;
    viewerMode?: boolean;
}

const capturedProps: CapturedShogiMatchProps[] = [];

vi.mock("@shogi/ui", () => ({
    ShogiMatch: (props: CapturedShogiMatchProps) => {
        capturedProps.push(props);
        return <div data-testid="shogi-match" />;
    },
    EngineControlPanel: () => null,
    useDevMode: () => false,
}));
vi.mock("@tanstack/react-router", () => ({ useNavigate: () => vi.fn() }));
vi.mock("./components/HeaderNav", () => ({ HeaderNav: () => null }));
vi.mock("./components/PageHeader", () => ({ PageHeader: () => null }));
vi.mock("./hooks/useRemotePrivateNnueManager", () => ({
    useRemotePrivateNnueManager: () => undefined,
}));
vi.mock("./platform/wasm-engine-client", () => ({ createWebWasmEngineClient: () => ({}) }));

const { default: App } = await import("./App");

const KEY = "ramu_review_kifu";
const MIDGAME_SFEN = "ln1gk1snl/1r4g2/p1ppppspp/6p2/1p5P1/2P6/PPSPPPP1P/2G4R1/LN2KGSNL w Bb 1";

describe("/play (App): 引き継がれた局面", () => {
    beforeEach(() => {
        window.sessionStorage.clear();
        capturedProps.length = 0;
    });
    afterEach(cleanup);

    it("引き継がれた局面があれば、その開始局面と手順を読み込んで開く", async () => {
        savePlayHandoff({ sfen: "startpos", moves: ["7g7f", "3c3d"] });

        render(<App />);
        await screen.findByTestId("shogi-match");

        expect(capturedProps.at(-1)?.initialReview).toEqual({
            sfen: "startpos",
            moves: ["7g7f", "3c3d"],
        });
    });

    it("通常の対局画面として開く（見るだけの画面にも、設定を隠す検討画面にもしない）", async () => {
        savePlayHandoff({ sfen: "startpos", moves: ["7g7f"] });

        render(<App />);
        await screen.findByTestId("shogi-match");

        expect(capturedProps.at(-1)?.viewerMode).toBeUndefined();
        expect(capturedProps.at(-1)?.reviewMode).toBeUndefined();
    });

    it("平手以外・後手番開始の局面も、SFEN のまま読み込む", async () => {
        savePlayHandoff({ sfen: MIDGAME_SFEN, moves: ["B*5e"] });

        render(<App />);
        await screen.findByTestId("shogi-match");

        expect(capturedProps.at(-1)?.initialReview).toEqual({
            sfen: MIDGAME_SFEN,
            moves: ["B*5e"],
        });
    });

    it("読み込んだら消す（/play を開き直したときに前の局面を出さない）", async () => {
        savePlayHandoff({ sfen: "startpos", moves: ["7g7f"] });

        const first = render(<App />);
        await screen.findByTestId("shogi-match");
        expect(window.sessionStorage.getItem(KEY)).toBeNull();
        first.unmount();
        capturedProps.length = 0;

        render(<App />);
        await screen.findByTestId("shogi-match");
        expect(capturedProps.at(-1)?.initialReview).toBeUndefined();
    });

    it("StrictMode の二重実行でも、引き継がれた局面を取りこぼさない", async () => {
        savePlayHandoff({ sfen: "startpos", moves: ["7g7f"] });

        render(
            <StrictMode>
                <App />
            </StrictMode>,
        );
        await screen.findByTestId("shogi-match");

        expect(capturedProps.at(-1)?.initialReview).toEqual({ sfen: "startpos", moves: ["7g7f"] });
    });

    it("引き継がれた局面が無ければ、何も読み込まずに開く", async () => {
        render(<App />);
        await screen.findByTestId("shogi-match");

        expect(capturedProps.at(-1)?.initialReview).toBeUndefined();
    });
});
