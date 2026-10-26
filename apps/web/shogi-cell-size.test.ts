import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const uiSrcDir = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "../../packages/ui/src",
);

const sourceFiles = (readdirSync(uiSrcDir, { recursive: true }) as string[])
    .filter((file) => /\.tsx?$/.test(file) && !/\.test\.tsx?$/.test(file))
    .map((file) => path.join(uiSrcDir, file));

describe("--shogi-cell-size の既定値", () => {
    // 盤と持ち駒で既定値が違うと、変数を指定しない画面で盤と持ち駒の大きさが合わなくなる。
    // Tailwind のクラスには定数を埋め込めないので、文字列の既定値を DEFAULT_SHOGI_CELL_SIZE と比べる。
    it("ui のどのクラスも DEFAULT_SHOGI_CELL_SIZE を既定値にする", () => {
        const board = readFileSync(path.join(uiSrcDir, "components/shogi-board.tsx"), "utf8");
        const expected = board.match(/export const DEFAULT_SHOGI_CELL_SIZE = (\d+);/)?.[1];
        expect(expected).toBeDefined();
        // ui の置き場所が変わって 1 つも読めていないのに通る、ということが無いように
        expect(sourceFiles.length).toBeGreaterThan(0);
        const mismatches = sourceFiles.flatMap((file) =>
            [...readFileSync(file, "utf8").matchAll(/--shogi-cell-size,\s*(\d+)px/g)]
                .filter((match) => match[1] !== expected)
                .map((match) => `${path.relative(uiSrcDir, file)}: ${match[0]}`),
        );
        expect(mismatches).toEqual([]);
    });
});
