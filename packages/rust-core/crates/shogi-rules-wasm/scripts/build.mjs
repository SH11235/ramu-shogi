// shogi-rules-wasm を wasm にビルドし、wasm-bindgen (--target web) と wasm-opt -Oz を通して
// pkg/ に出力する。pkg/manifest.json に生成元とファイルの sha256 を記録する。
//
// 使い方: node packages/rust-core/crates/shogi-rules-wasm/scripts/build.mjs
// wasm-opt は WASM_OPT で指定するか、packages/engine-wasm の devDependencies (npm の wasm-opt) を使う。

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const crateName = "shogi-rules-wasm";
const artifactName = crateName.replace(/-/g, "_");
const profile = "rules-wasm";
const target = "wasm32-unknown-unknown";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const crateDir = path.resolve(scriptDir, "..");
const rustRoot = path.resolve(crateDir, "../..");
const repoRoot = path.resolve(rustRoot, "../..");
const outDir = path.join(crateDir, "pkg");
const fixturePath = path.join(crateDir, "fixtures", "rules-fixtures.json");

// rustc の wasm32-unknown-unknown が既定で使う機能。wasm-opt 側でも許可しないと検証で落ちる
const wasmFeatures = [
    "--enable-bulk-memory",
    "--enable-mutable-globals",
    "--enable-nontrapping-float-to-int",
    "--enable-sign-ext",
    "--enable-reference-types",
    "--enable-multivalue",
];

function run(cmd, args, { cwd = rustRoot, capture = false } = {}) {
    const result = spawnSync(cmd, args, {
        cwd,
        stdio: capture ? ["ignore", "pipe", "inherit"] : "inherit",
        encoding: "utf8",
    });
    if (result.error) throw new Error(`${cmd} を起動できません: ${result.error.message}`);
    if (result.status !== 0) throw new Error(`Command failed: ${cmd} ${args.join(" ")}`);
    return capture ? result.stdout.trim() : "";
}

function lockedPackage(name) {
    const lock = readFileSync(path.join(rustRoot, "Cargo.lock"), "utf8");
    const block = lock
        .split("[[package]]")
        .find((entry) => entry.includes(`\nname = "${name}"\n`));
    if (!block) throw new Error(`${name} が Cargo.lock にありません`);
    return {
        version: block.match(/\nversion = "([^"]+)"/)?.[1],
        source: block.match(/\nsource = "([^"]+)"/)?.[1],
    };
}

// glue と wasm 側の wasm-bindgen は版が一致しないと実行時に壊れるため、CLI の版を Cargo.lock に揃えさせる
function ensureWasmBindgen(expectedVersion) {
    const actual = run("wasm-bindgen", ["--version"], { capture: true });
    if (actual !== `wasm-bindgen ${expectedVersion}`) {
        throw new Error(
            `wasm-bindgen CLI ${expectedVersion} が必要です (現在: ${actual})。` +
                ` cargo install wasm-bindgen-cli --version ${expectedVersion}`,
        );
    }
}

function resolveWasmOpt() {
    if (process.env.WASM_OPT) return process.env.WASM_OPT;
    const bundled = path.join(repoRoot, "packages/engine-wasm/node_modules/.bin/wasm-opt");
    if (existsSync(bundled)) return bundled;
    throw new Error("wasm-opt が見つかりません。pnpm install するか WASM_OPT で指定してください");
}

function sha256(filePath) {
    return createHash("sha256").update(readFileSync(filePath)).digest("hex");
}

function main() {
    const wasmBindgen = lockedPackage("wasm-bindgen");
    const rshogiCore = lockedPackage("rshogi-core");
    const rshogiRev = rshogiCore.source?.split("#")[1];
    if (!rshogiRev) throw new Error("rshogi-core の git rev を Cargo.lock から読めません");
    ensureWasmBindgen(wasmBindgen.version);
    const wasmOpt = resolveWasmOpt();

    run("cargo", ["build", "--profile", profile, "--target", target, "-p", crateName]);
    const builtWasm = path.join(rustRoot, "target", target, profile, `${artifactName}.wasm`);
    if (!existsSync(builtWasm)) throw new Error(`Built wasm not found at ${builtWasm}`);

    rmSync(outDir, { recursive: true, force: true });
    mkdirSync(outDir, { recursive: true });
    run("wasm-bindgen", [
        "--target",
        "web",
        "--typescript",
        "--omit-default-module-path",
        "--out-dir",
        outDir,
        builtWasm,
    ]);
    rmSync(path.join(outDir, `${artifactName}_bg.wasm.d.ts`));

    const bgWasm = path.join(outDir, `${artifactName}_bg.wasm`);
    run(wasmOpt, ["-Oz", ...wasmFeatures, bgWasm, "-o", bgWasm]);

    const files = [`${artifactName}.js`, `${artifactName}.d.ts`, `${artifactName}_bg.wasm`];
    const manifest = {
        crate: crateName,
        sourceRepository: "https://github.com/SH11235/ramu-shogi",
        sourceCommit: run("git", ["rev-parse", "HEAD"], { capture: true }),
        // wasm の入力は packages/rust-core 配下 (workspace の Cargo.toml / Cargo.lock / crate) だけ
        sourceDirty:
            run("git", ["status", "--porcelain", "--", rustRoot], { capture: true }) !== "",
        rshogiCoreRev: rshogiRev,
        rustc: run("rustc", ["--version"], { capture: true }),
        wasmBindgen: wasmBindgen.version,
        wasmOpt: run(wasmOpt, ["--version"], { capture: true }),
        files: Object.fromEntries([
            ...files.map((name) => [name, sha256(path.join(outDir, name))]),
            ["rules-fixtures.json", sha256(fixturePath)],
        ]),
    };
    writeFileSync(path.join(outDir, "manifest.json"), `${JSON.stringify(manifest, null, 4)}\n`);
    console.log(`Wrote ${outDir}`);
    console.log(JSON.stringify(manifest, null, 4));
}

try {
    main();
} catch (error) {
    console.error(error.message);
    process.exitCode = 1;
}
