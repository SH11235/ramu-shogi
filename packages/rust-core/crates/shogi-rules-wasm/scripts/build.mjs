// shogi-rules-wasm を wasm にビルドし、wasm-bindgen (--target web) と wasm-opt -Oz を通して
// pkg/ に出力する。pkg/manifest.json に生成元とファイルの sha256 を記録する。
//
// 使い方: node packages/rust-core/crates/shogi-rules-wasm/scripts/build.mjs
// wasm-opt は WASM_OPT で指定するか、ルートの devDependencies (binaryen) を使う。

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const crateName = "shogi-rules-wasm";
const artifactName = crateName.replace(/-/g, "_");
const profile = "rules-wasm";
const target = "wasm32-unknown-unknown";
const require = createRequire(import.meta.url);

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

function run(cmd, args, { cwd = rustRoot, capture = false, env = process.env } = {}) {
    const result = spawnSync(cmd, args, {
        cwd,
        env,
        stdio: capture ? ["ignore", "pipe", "inherit"] : "inherit",
        encoding: "utf8",
        maxBuffer: 64 * 1024 * 1024,
    });
    if (result.error) throw new Error(`${cmd} を起動できません: ${result.error.message}`);
    if (result.status !== 0) throw new Error(`Command failed: ${cmd} ${args.join(" ")}`);
    return capture ? result.stdout.trim() : "";
}

function lockedPackage(name) {
    const lock = readFileSync(path.join(rustRoot, "Cargo.lock"), "utf8");
    const block = lock.split("[[package]]").find((entry) => entry.includes(`\nname = "${name}"\n`));
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

export function resolveWasmOpt(override = process.env.WASM_OPT) {
    if (override) return { command: override, args: [] };
    try {
        const cli = require.resolve("binaryen/bin/wasm-opt");
        return { command: process.execPath, args: [cli] };
    } catch (cause) {
        throw new Error(
            "binaryen の wasm-opt が見つかりません。pnpm install するか WASM_OPT で指定してください",
            { cause },
        );
    }
}

const cargoHome = process.env.CARGO_HOME ?? path.join(os.homedir(), ".cargo");

// target dir は CARGO_TARGET_DIR や cargo config で変わるので、cargo が報告した成果物のパスを使う
function cargoBuild() {
    // panic の位置にローカルの絶対パスが入らないよう、依存・repo・rust-src のパスを置き換える
    const remappedPrefixes = [
        [cargoHome, "/cargo"],
        [repoRoot, "/ramu-shogi"],
        [
            path.join(
                run("rustc", ["--print", "sysroot"], { capture: true }),
                "lib/rustlib/src/rust",
            ),
            "/rustc",
        ],
    ];
    const rustflags = [
        ...(process.env.RUSTFLAGS ?? "").split(/\s+/).filter(Boolean),
        ...remappedPrefixes.map(([from, to]) => `--remap-path-prefix=${from}=${to}`),
    ];
    const { RUSTFLAGS: _ignored, ...baseEnv } = process.env;
    const output = run(
        "cargo",
        [
            "build",
            "--profile",
            profile,
            "--target",
            target,
            "-p",
            crateName,
            "--message-format=json-render-diagnostics",
        ],
        {
            capture: true,
            env: { ...baseEnv, CARGO_ENCODED_RUSTFLAGS: rustflags.join("\x1f") },
        },
    );
    const wasmFiles = output
        .split("\n")
        .filter((line) => line.startsWith("{"))
        .map((line) => JSON.parse(line))
        .filter((message) => message.reason === "compiler-artifact")
        .filter((message) => message.target?.name === artifactName)
        .flatMap((message) => message.filenames ?? [])
        .filter((file) => file.endsWith(".wasm"));
    if (wasmFiles.length !== 1) {
        throw new Error(`cargo の成果物から wasm を 1 つに特定できません: ${wasmFiles.join(", ")}`);
    }
    return wasmFiles[0];
}

function assertNoLocalPaths(filePath) {
    const contents = readFileSync(filePath).toString("latin1");
    const leaked = [cargoHome, repoRoot, os.homedir()].filter((prefix) =>
        contents.includes(prefix),
    );
    if (leaked.length > 0) {
        throw new Error(`${filePath} にローカルの絶対パスが残っています: ${leaked.join(", ")}`);
    }
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

    const builtWasm = cargoBuild();
    assertNoLocalPaths(builtWasm);

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
    run(wasmOpt.command, [...wasmOpt.args, "-Oz", ...wasmFeatures, bgWasm, "-o", bgWasm]);

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
        wasmOpt: run(wasmOpt.command, [...wasmOpt.args, "--version"], { capture: true }),
        // wasm-bindgen の出力は実行ごとに揺れ得るため、決定的な rustc の出力でも出所を辿れるようにする
        rustcWasmSha256: sha256(builtWasm),
        files: Object.fromEntries([
            ...files.map((name) => [name, sha256(path.join(outDir, name))]),
            ["rules-fixtures.json", sha256(fixturePath)],
        ]),
    };
    writeFileSync(path.join(outDir, "manifest.json"), `${JSON.stringify(manifest, null, 4)}\n`);
    console.log(`Wrote ${outDir}`);
    console.log(JSON.stringify(manifest, null, 4));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    try {
        main();
    } catch (error) {
        console.error(error.message);
        process.exitCode = 1;
    }
}
