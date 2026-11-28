import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const crateName = "engine-wasm";
const artifactName = crateName.replace(/-/g, "_");
const rustRoot = path.resolve(__dirname, "../../rust-core");
const nightlyToolchain = process.env.RUST_NIGHTLY_TOOLCHAIN ?? "nightly-2026-04-03";

// --production フラグで本番ビルド（最大最適化）
const isProduction = process.argv.includes("--production");
const profile = isProduction ? "production" : "release";
const targetDir = isProduction ? "production" : "release";

const defaultCargoTargetDir = process.env.CARGO_TARGET_DIR
    ? path.resolve(rustRoot, process.env.CARGO_TARGET_DIR)
    : path.join(rustRoot, "target");
// CI の rust-cache は保存前に cargo metadata に無い成果物を消すため、build-std で作る
// core/std まで消えてスレッド版が毎回フルビルドになる。CI ではここを別ディレクトリにして別途キャッシュする
const threadedCargoTargetDir = process.env.ENGINE_WASM_THREADED_TARGET_DIR
    ? path.resolve(rustRoot, process.env.ENGINE_WASM_THREADED_TARGET_DIR)
    : defaultCargoTargetDir;

const outDir = path.resolve(__dirname, "../pkg");
const threadedOutDir = path.resolve(__dirname, "../pkg-threaded");
const threadedTarget = path.resolve(rustRoot, "targets", "wasm32-unknown-unknown.json");

// 探索スレッドのスタック（バイト）。wasm の既定（本体 1 MiB・補助スレッド 2 MiB）では深く読み続けると
// 足りず、本体は `memory access out of bounds` で落ち、補助スレッドはヒープを壊す。探索は手数
// MAX_PLY (246) で潜るのをやめ、search_node は 1 フレーム約 5.3 KB。1 手の中でも singular extension・
// null move の確認・probcut で呼び直すので、毎手 search_node 2〜3 フレーム（約 2.5〜3.8 MiB）に
// try_probcut（約 5 KB、計約 1.2 MiB）が重なると概算 4〜5 MiB になる。
const SEARCH_STACK_BYTES = 8 * 1024 * 1024;

// スタックの下端・上端（リンカーが作るシンボル）。wasm から外へ出して、ビルドの最後に大きさを確かめる。
const STACK_BOUND_EXPORTS = "-C link-arg=--export=__stack_low -C link-arg=--export=__stack_high";

function run(cmd, args, cwd = process.cwd(), extraEnv = {}) {
    const fullCommand = `${cmd} ${args.join(" ")}`;

    // Ensure Rust environment variables are properly set
    const rustEnv = {
        ...process.env,
        ...extraEnv,
    };

    // Set default toolchain if not already set (Windows-specific issue workaround)
    if (!rustEnv.RUSTUP_TOOLCHAIN && process.platform === "win32") {
        rustEnv.RUSTUP_TOOLCHAIN = "stable-x86_64-pc-windows-msvc";
    }

    // Try to find RUSTUP_HOME on Windows if not set (for non-standard installations)
    if (!rustEnv.RUSTUP_HOME && process.env.USERPROFILE) {
        const scoop = path.join(
            process.env.USERPROFILE,
            "scoop",
            "persist",
            "rustup-msvc",
            ".rustup",
        );
        const defaultLoc = path.join(process.env.USERPROFILE, ".rustup");
        if (existsSync(scoop)) {
            rustEnv.RUSTUP_HOME = scoop;
        } else if (existsSync(defaultLoc)) {
            rustEnv.RUSTUP_HOME = defaultLoc;
        }
    }

    const result = spawnSync(cmd, args, {
        cwd,
        stdio: "inherit",
        env: rustEnv,
    });
    if (result.status !== 0) {
        throw new Error(`Command failed: ${fullCommand}`);
    }
}

/** wasm の外へ出したグローバルの初期値（`i32.const` で初期化されたもの）を、名前ごとに読む。 */
function readExportedGlobals(wasmPath) {
    const bytes = readFileSync(wasmPath);
    let offset = 8;
    const readUleb = () => {
        let result = 0;
        let shift = 0;
        let byte;
        do {
            byte = bytes[offset++];
            result += (byte & 0x7f) * 2 ** shift;
            shift += 7;
        } while (byte & 0x80);
        return result;
    };
    const readSleb32 = () => {
        let result = 0;
        let shift = 0;
        let byte;
        do {
            byte = bytes[offset++];
            result |= (byte & 0x7f) << shift;
            shift += 7;
        } while (byte & 0x80);
        if (shift < 32 && byte & 0x40) result |= -1 << shift;
        return result >>> 0;
    };
    const readName = () => {
        const length = readUleb();
        const name = bytes.subarray(offset, offset + length).toString("utf8");
        offset += length;
        return name;
    };
    const skipLimits = () => {
        const flags = bytes[offset++];
        readUleb();
        if (flags & 1) readUleb();
    };
    // 定数式を命令ごとに読み、`i32.const <値>; end` だけのときにその値を返す（ほかは null）。
    const readConstExpr = () => {
        const instructions = [];
        for (;;) {
            const opcode = bytes[offset++];
            if (opcode === 0x0b) break;
            if (opcode === 0x41) instructions.push({ opcode, value: readSleb32() });
            else {
                instructions.push({ opcode });
                if (opcode === 0x42 || opcode === 0x23 || opcode === 0xd2 || opcode === 0xd0)
                    readUleb();
                else if (opcode === 0x43) offset += 4;
                else if (opcode === 0x44) offset += 8;
                else if (opcode === 0xfd) {
                    if (readUleb() !== 12) throw new Error(`${wasmPath}: 読めない定数式`);
                    offset += 16;
                } else if (![0x6a, 0x6b, 0x6c, 0x7c, 0x7d, 0x7e].includes(opcode)) {
                    throw new Error(`${wasmPath}: 読めない定数式の命令 0x${opcode.toString(16)}`);
                }
            }
        }
        return instructions.length === 1 && instructions[0].opcode === 0x41
            ? instructions[0].value
            : null;
    };
    let importedGlobals = 0;
    const definedGlobals = [];
    const exportedGlobals = new Map();
    while (offset < bytes.length) {
        const id = bytes[offset++];
        const size = readUleb();
        const end = offset + size;
        if (id === 2) {
            const count = readUleb();
            for (let i = 0; i < count; i++) {
                readName();
                readName();
                const kind = bytes[offset++];
                if (kind === 0) readUleb();
                else if (kind === 1) {
                    offset++;
                    skipLimits();
                } else if (kind === 2) skipLimits();
                else if (kind === 3) {
                    offset += 2;
                    importedGlobals++;
                } else if (kind === 4) {
                    offset++;
                    readUleb();
                } else throw new Error(`${wasmPath}: 想定していない import の種類 ${kind}`);
            }
        } else if (id === 6) {
            const count = readUleb();
            for (let i = 0; i < count; i++) {
                offset += 2;
                definedGlobals.push(readConstExpr());
            }
        } else if (id === 7) {
            const count = readUleb();
            for (let i = 0; i < count; i++) {
                const name = readName();
                const kind = bytes[offset++];
                const index = readUleb();
                if (kind === 3) exportedGlobals.set(name, index);
            }
        }
        offset = end;
    }
    const values = new Map();
    for (const [name, index] of exportedGlobals) {
        values.set(name, definedGlobals[index - importedGlobals] ?? null);
    }
    return values;
}

/** スタックが 0 番地から始まり（`--stack-first`）、ちょうど SEARCH_STACK_BYTES あることを確かめる。 */
function verifyStackSize(wasmPath) {
    const globals = readExportedGlobals(wasmPath);
    const low = globals.get("__stack_low");
    const high = globals.get("__stack_high");
    if (low !== 0 || high !== SEARCH_STACK_BYTES) {
        throw new Error(
            `${wasmPath} の探索スタックが [${low}, ${high}) です（[0, ${SEARCH_STACK_BYTES}) を想定）`,
        );
    }
}

/** スレッド版の本体のスタックは、ターゲット仕様の `stack-size` で決まる。 */
function verifyTargetStackSize(targetPath) {
    const spec = JSON.parse(readFileSync(targetPath, "utf8"));
    const expected = `stack-size=${SEARCH_STACK_BYTES}`;
    const linkArgs = Object.values(spec["pre-link-args"] ?? {}).flat();
    const sizes = linkArgs.filter((arg) => arg.includes("stack-size="));
    if (sizes.length === 0 || sizes.some((arg) => !arg.endsWith(expected))) {
        throw new Error(`${targetPath} の stack-size が ${SEARCH_STACK_BYTES} ではありません`);
    }
}

/**
 * wasm-bindgen-rayon は補助スレッドの初期化に `thread_stack_size` を渡さず、wasm-bindgen の既定
 * （2 MiB）になる。生成された workerHelpers.js の初期化の引数に足す。
 */
function setRayonThreadStackSize(outputDir) {
    const snippetsDir = path.join(outputDir, "snippets");
    const helpers = readdirSync(snippetsDir, { recursive: true })
        .map((entry) => path.join(snippetsDir, String(entry)))
        .filter((entry) => path.basename(entry) === "workerHelpers.js");
    if (helpers.length !== 1) {
        throw new Error(
            `${snippetsDir} に workerHelpers.js が ${helpers.length} 個あります（1 個を想定）`,
        );
    }
    const [helper] = helpers;
    const source = readFileSync(helper, "utf8");
    const original = "init: { module_or_path: module, memory },";
    if (source.split(original).length !== 2) {
        throw new Error(
            `${helper} の補助スレッドの初期化が想定と違います（thread_stack_size を足す箇所が 1 つではない）`,
        );
    }
    writeFileSync(
        helper,
        source.replace(
            original,
            `init: { module_or_path: module, memory, thread_stack_size: ${SEARCH_STACK_BYTES} },`,
        ),
        "utf8",
    );
}

function ensureWasmBindgen() {
    const check = spawnSync("wasm-bindgen", ["--version"], {
        stdio: "pipe",
    });
    if (check.status !== 0) {
        throw new Error(
            "wasm-bindgen CLI is required. Install it with `cargo install wasm-bindgen-cli --version 0.2.106`.",
        );
    }
}

function buildWasm({
    label,
    cargoArgs,
    outDir: outputDir,
    rustflags,
    toolchain,
    cargoZArgs,
    emitThreadWorker,
    target,
    cargoTargetDir = defaultCargoTargetDir,
}) {
    const targetArg = target ?? "wasm32-unknown-unknown";
    const targetName = targetArg.endsWith(".json") ? path.basename(targetArg, ".json") : targetArg;
    const targetWasm = path.join(cargoTargetDir, targetName, targetDir, `${artifactName}.wasm`);

    console.log(`Building ${crateName}${label ? ` (${label})` : ""} with profile: ${profile}`);
    console.log(`Expected output: ${targetWasm}`);

    const extraEnv = {
        CARGO_TARGET_DIR: cargoTargetDir,
        ...(rustflags
            ? { RUSTFLAGS: [process.env.RUSTFLAGS, rustflags].filter(Boolean).join(" ") }
            : {}),
    };

    const args = [
        ...(toolchain ? [`+${toolchain}`] : []),
        "build",
        "--profile",
        profile,
        "--target",
        targetArg,
        "-p",
        crateName,
        ...cargoArgs,
        ...(cargoZArgs ?? []),
    ];

    run("cargo", args, rustRoot, extraEnv);

    if (!existsSync(targetWasm)) {
        throw new Error(`Built wasm not found at ${targetWasm}`);
    }
    verifyStackSize(targetWasm);

    rmSync(outputDir, { recursive: true, force: true });
    mkdirSync(outputDir, { recursive: true });

    run(
        "wasm-bindgen",
        ["--target", "web", "--typescript", "--out-dir", outputDir, targetWasm],
        rustRoot,
    );

    // wasm-opt は不使用（Cargo LTO で十分最適化済み、wasm-opt は逆効果: -8〜12% NPS低下）

    if (emitThreadWorker) {
        const workerPath = path.join(outputDir, `${artifactName}_worker.js`);
        const workerSource = [
            `import { initSync } from "./${artifactName}.js";`,
            "",
            "self.onmessage = (event) => {",
            "    const { module, memory, thread_stack_size: threadStackSize } = event.data ?? {};",
            "    if (!module || !memory) return;",
            "    initSync({ module, memory, thread_stack_size: threadStackSize });",
            '    self.postMessage({ type: "ready" });',
            "};",
            "",
        ].join("\n");
        writeFileSync(workerPath, workerSource, "utf8");
        setRayonThreadStackSize(outputDir);
    }

    console.log(`Wrote wasm bindings to ${outputDir}`);
}

function verifyThreadedOutput(outputDir) {
    const jsPath = path.join(outputDir, `${artifactName}.js`);
    const workerPath = path.join(outputDir, `${artifactName}_worker.js`);

    if (!existsSync(workerPath)) {
        throw new Error(`Threaded worker script not found at ${workerPath}`);
    }

    if (!existsSync(jsPath)) {
        throw new Error(`Threaded JS output not found at ${jsPath}`);
    }

    const jsSource = readFileSync(jsPath, "utf8");
    if (!jsSource.includes("initThreadPool")) {
        throw new Error("initThreadPool export missing in threaded wasm output");
    }

    // Generate package.json for Vite/Rollup to resolve import('../../..') in workerHelpers.js
    // wasm-bindgen-rayon's workerHelpers.js uses import('../../..') to load the main module,
    // which requires a package.json with "main" pointing to the entry file.
    const pkgJsonPath = path.join(outputDir, "package.json");
    const pkgJson = {
        name: "engine-wasm-threaded",
        type: "module",
        main: `./${artifactName}.js`,
    };
    writeFileSync(pkgJsonPath, JSON.stringify(pkgJson, null, 2), "utf8");
    console.log(`Generated ${pkgJsonPath} for wasm-bindgen-rayon compatibility`);
}

try {
    ensureWasmBindgen();

    buildWasm({
        label: "single",
        cargoArgs: [],
        outDir,
        rustflags: `-C target-feature=+simd128 -C link-arg=-zstack-size=${SEARCH_STACK_BYTES} ${STACK_BOUND_EXPORTS}`,
    });

    verifyTargetStackSize(threadedTarget);
    buildWasm({
        label: "threaded",
        cargoArgs: ["--features", "wasm-threads"],
        outDir: threadedOutDir,
        rustflags: `-C target-feature=+simd128 -Z unstable-options -C panic=immediate-abort -C link-arg=--shared-memory -C link-arg=--import-memory -C link-arg=--max-memory=2147483648 -C link-arg=--export=__wasm_init_tls -C link-arg=--export=__tls_base -C link-arg=--export=__tls_size -C link-arg=--export=__tls_align ${STACK_BOUND_EXPORTS}`,
        toolchain: nightlyToolchain,
        cargoZArgs: ["-Z", "build-std=core,alloc,std", "-Z", "json-target-spec"],
        emitThreadWorker: true,
        target: threadedTarget,
        cargoTargetDir: threadedCargoTargetDir,
    });

    verifyThreadedOutput(threadedOutDir);
} catch (error) {
    console.error(error.message);
    process.exitCode = 1;
}
