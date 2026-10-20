// @vitest-environment node
// サーバーの合法手判定 (shogi-rules-wasm) と同じ fixture を、クライアントの棋譜再生
// (engine-wasm の wasm_replay_moves_strict) でも同じ合法/反則と判定することを確かめる。
// Wasm のビルド成果物 (packages/engine-wasm/pkg) を使うので、先にビルドしておく必要がある。

import { describe, expect, it, vi } from "vitest";

type FixtureCase = {
    name: string;
    startSfen: string;
    passRights: { b: number; w: number } | null;
    moves: string[];
    expected?: { ok: boolean; illegalIndex?: number; reason?: string };
    expectedError?: boolean;
    serverOnly?: boolean;
};

type ReplayResult = { applied: string[]; error?: string | null };

// node:fs と pkg を文字列で指すのは、Node の型を持たないアプリ用 tsconfig でも型検査を通すため
const { glue, cases } = await vi.hoisted(async () => {
    const { fileURLToPath } = await vi.importActual<{
        fileURLToPath(url: URL): string;
    }>("node:url");
    const { readFileSync } = await vi.importActual<{
        readFileSync(path: string, encoding?: "utf8"): Uint8Array & string;
    }>("node:fs");
    const root = fileURLToPath(new URL("../../../../", import.meta.url));
    const pkgDir = `${root}packages/engine-wasm/pkg/`;
    const engine = await import(/* @vite-ignore */ `${pkgDir}engine_wasm.js`);
    engine.initSync({ module: readFileSync(`${pkgDir}engine_wasm_bg.wasm`) });
    const fixture = JSON.parse(
        readFileSync(
            `${root}packages/rust-core/crates/shogi-rules-wasm/fixtures/rules-fixtures.json`,
            "utf8",
        ),
    ) as { cases: FixtureCase[] };
    return { glue: engine, cases: fixture.cases };
});

function replay(fixture: FixtureCase): { ok: boolean; illegalIndex?: number } {
    const passRights = fixture.passRights
        ? { sente: fixture.passRights.b, gote: fixture.passRights.w }
        : undefined;
    const result: ReplayResult = glue.wasm_replay_moves_strict(
        fixture.startSfen,
        fixture.moves,
        passRights,
    );
    return result.error
        ? { ok: false, illegalIndex: result.applied.length }
        : { ok: true, illegalIndex: undefined };
}

// 開始局面の検査 (玉の数・パス権の上限・手数) と、互換表記 ("0000" / "none") を拒む USI の検査は
// サーバー側だけが持つので比べない
const moveCases = cases.filter((fixture) => !fixture.expectedError && !fixture.serverOnly);

describe("サーバーの合法手判定 fixture とクライアントの棋譜再生", () => {
    it("fixture を読み込めている (fixture を増減したら件数も直す)", () => {
        expect(moveCases.length).toBe(34);
    });

    it.each(
        moveCases.map((fixture) => [fixture.name, fixture] as const),
    )("%s", (_name, fixture) => {
        const expected = fixture.expected;
        if (!expected) throw new Error("expected is missing");
        // engine-wasm は USI として読めない手を反則ではなく例外として扱う
        if (expected.reason === "invalid_usi") {
            expect(() => replay(fixture)).toThrow(/failed to parse move/);
            return;
        }
        expect(replay(fixture)).toEqual({
            ok: expected.ok,
            illegalIndex: expected.illegalIndex,
        });
    });
});
