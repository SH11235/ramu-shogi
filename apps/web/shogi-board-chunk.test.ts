import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
    SHOGI_BOARD_ALLOWED_PACKAGES,
    SHOGI_BOARD_ALLOWED_SHARED_MODULES,
    SHOGI_BOARD_MODULES,
} from "./shogi-board-chunk";

const componentsDir = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "../../packages/ui/src/components",
);

/** 実行時に残る import / re-export の指定子（`import type` と `export type` は消えるので除く）。 */
const runtimeSpecifiers = (source: string): string[] =>
    [
        ...source.matchAll(
            /^\s*(?:import|export)\s+(type\s+)?(?:[^;"']*?\s+from\s+)?["']([^"']+)["']/gm,
        ),
    ]
        .filter((match) => match[1] === undefined)
        .map((match) => match[2] ?? "");

const extensions = ["", ".ts", ".tsx"];

describe("shogi-board chunk", () => {
    // 一覧の外（shogi-match/ のほかのファイル）を import すると、shogi-match が shogi-board を import して
    // いるので 2 つの chunk が互いを読み込み、トップページも shogi-match を読み込むようになる。
    it.each(
        SHOGI_BOARD_MODULES,
    )("%s は一覧のファイルと許した package だけを import する", (file) => {
        const source = readFileSync(path.join(componentsDir, file), "utf8");
        const outside = runtimeSpecifiers(source).filter((specifier) => {
            if (!specifier.startsWith("."))
                return !SHOGI_BOARD_ALLOWED_PACKAGES.includes(specifier);
            const base = path.join(path.dirname(file), specifier);
            return !extensions.some((ext) => {
                const resolved = path.posix.normalize((base + ext).split(path.sep).join("/"));
                return (
                    SHOGI_BOARD_MODULES.includes(resolved) ||
                    SHOGI_BOARD_ALLOWED_SHARED_MODULES.includes(resolved)
                );
            });
        });
        expect(outside).toEqual([]);
    });

    // 一覧の外から読んでよいファイルが、さらに何かを読むと、その先が shogi-match chunk に入りうる。
    it.each(
        SHOGI_BOARD_ALLOWED_SHARED_MODULES,
    )("%s は許した package だけを import する", (file) => {
        const source = readFileSync(path.join(componentsDir, file), "utf8");
        const outside = runtimeSpecifiers(source).filter(
            (specifier) => !SHOGI_BOARD_ALLOWED_PACKAGES.includes(specifier),
        );
        expect(outside).toEqual([]);
    });
});
