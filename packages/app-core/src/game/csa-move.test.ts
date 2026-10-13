import { describe, expect, it } from "vitest";
import { applyCsaMoveStrict, isCheckmate } from "./csa-move";
import { buildCsaStartPosition } from "./csa-position";

describe("isCheckmate", () => {
    const position = (sente: string, gote: string) =>
        buildCsaStartPosition([`P+${sente}`, `P-${gote}`], "gote").position;

    it("守られた頭金で詰み、入力局面は変更しない", () => {
        const state = position("52KI53KI", "51OU");
        const before = structuredClone(state);
        expect(isCheckmate(state)).toBe(true);
        expect(state).toEqual(before);
    });

    it("玉が逃げられる王手は詰みでない", () => {
        expect(isCheckmate(position("59HI", "51OU"))).toBe(false);
    });

    it("玉で王手の駒を取れるなら詰みでない", () => {
        expect(isCheckmate(position("52KI", "51OU"))).toBe(false);
    });

    it("玉以外で王手の駒を取れるなら詰みでない", () => {
        expect(isCheckmate(position("52KI53KI", "51OU41GI"))).toBe(false);
    });

    it("王手でない局面と玉がない局面は詰みでない", () => {
        expect(isCheckmate(position("53KI", "51OU"))).toBe(false);
        expect(isCheckmate(position("52KI53KI", ""))).toBe(false);
    });

    it.each(["00KI", "43GI"])("持ち駒・盤上の合駒で逃れられる: %s", (defender) => {
        expect(isCheckmate(position("59HI", `51OU41KY61KY42FU62FU${defender}`))).toBe(false);
    });

    it("両王手には片方への合駒だけでは逃れられない", () => {
        expect(isCheckmate(position("59HI62KA63KI", "51OU41KY61KY42FU00KI"))).toBe(true);
    });

    it("ピンされた銀では頭金を取れない", () => {
        expect(isCheckmate(position("52KI53KI11HI", "51OU41GI"))).toBe(true);
    });

    it("唯一の合駒が二歩になるなら詰み", () => {
        // 5 筋の歩は飛車より後ろに置き、王手を遮らない。
        const state = position("58HI", "51OU41KY61KY42FU62FU59FU00FU");
        expect(isCheckmate(state)).toBe(true);
        state.board["5i"] = null;
        expect(isCheckmate(state)).toBe(false);
    });

    it("逃れるために必要な成りを許す", () => {
        const state = position("59HI", "51OU41KY61KY42FU62FU47KE");
        expect(isCheckmate(state)).toBe(false);
        expect(() => applyCsaMoveStrict("-4759NK", state)).not.toThrow();
    });

    it.each([
        ["38HI56KI", "58OU47KE67KE49KY59KY69KY", "N"],
        ["39HI57KI", "59OU48KE68KE69KY", "P"],
    ] as const)("行き所のない駒の合駒は許さない: %s / %s / %s", (sente, gote, piece) => {
        const state = position(sente, gote);
        state.hands.gote[piece] = 1;
        expect(isCheckmate(state)).toBe(true);
        state.hands.gote.G = 1;
        expect(isCheckmate(state)).toBe(false);
    });

    it("唯一の歩の合駒が相手玉を詰ます場合は合法手に数えない", () => {
        // 任意の局面入力として両玉に王手のある形を使う。2 三の角はピンされ、
        // 2 筋は二歩なので、後手の王手を遮れるのは 3 二への歩打ちだけ。
        const state = position("42HI33OU45KA43FU44FU24FU", "12OU11KY21KE13FU23KA25GI29FU00FU");
        const afterDrop = applyCsaMoveStrict("-0032FU", state).nextState;
        expect(isCheckmate(afterDrop)).toBe(true);
        expect(isCheckmate(state)).toBe(true);
        // 桂を外すと先手の飛車で合駒の歩を取れるので、打ち歩詰めではなくなる。
        state.board["2a"] = null;
        expect(isCheckmate(applyCsaMoveStrict("-0032FU", state).nextState)).toBe(false);
        expect(isCheckmate(state)).toBe(false);
    });
});
