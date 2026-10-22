import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { test } from "node:test";
import { resolveWasmOpt } from "./build.mjs";

test("the bundled optimizer runs through Node without platform-specific bin shims", () => {
    const optimizer = resolveWasmOpt("");
    assert.equal(optimizer.command, process.execPath);
    assert.deepEqual(optimizer.args, [
        createRequire(import.meta.url).resolve("binaryen/bin/wasm-opt"),
    ]);
    const result = spawnSync(optimizer.command, [...optimizer.args, "--version"], {
        encoding: "utf8",
    });
    assert.ifError(result.error);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /^wasm-opt version \d+/);
});

test("an explicit optimizer executable keeps its path and receives no Node arguments", () => {
    const optimizer = resolveWasmOpt(process.execPath);
    assert.deepEqual(optimizer, { command: process.execPath, args: [] });
    const result = spawnSync(optimizer.command, [...optimizer.args, "--version"], {
        encoding: "utf8",
    });
    assert.ifError(result.error);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout.trim(), process.version);
});

test("explicit executable paths with spaces stay a single command", () => {
    const executable = "optimizer tools/wasm-opt";
    assert.deepEqual(resolveWasmOpt(executable), { command: executable, args: [] });
});

test("the optimized rules WASM matches every shared fixture", async () => {
    const rules = await import(new URL("../pkg/shogi_rules_wasm.js", import.meta.url).href);
    rules.initSync({
        module: readFileSync(new URL("../pkg/shogi_rules_wasm_bg.wasm", import.meta.url)),
    });
    const { cases } = JSON.parse(
        readFileSync(new URL("../fixtures/rules-fixtures.json", import.meta.url), "utf8"),
    );
    assert.ok(cases.length > 0);
    for (const fixture of cases) {
        const input = {
            startSfen: fixture.startSfen,
            passRights: fixture.passRights,
            moves: fixture.moves,
        };
        if (fixture.expectedError) {
            assert.throws(() => rules.judgeGame(input), fixture.name);
            continue;
        }
        const actual = rules.judgeGame(input);
        for (const [key, value] of Object.entries(fixture.expected)) {
            assert.deepEqual(actual[key], value, `${fixture.name}: ${key}`);
        }
        if (fixture.expected.ok) {
            assert.equal(actual.illegalIndex, undefined, fixture.name);
        }
    }
});
