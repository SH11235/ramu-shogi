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

// 探索スレッドのスタック（バイト）。探索は手数 MAX_PLY (246) で潜るのをやめるので、1 手ごとの
// search_node（約 5.3 KB）と probcut（約 5 KB）が毎手重なっても約 2.5 MB に収まる。wasm の既定
// （本体 1 MiB・補助スレッド 2 MiB）では深く読み続けると足りず、本体は `memory access out of bounds`
// で落ち、補助スレッドはヒープを壊す。スレッド版の本体の値は targets/wasm32-unknown-unknown.json の
// `stack-size` と同じにする（verifyStackSize で確かめる）。
const SEARCH_STACK_BYTES = 4 * 1024 * 1024;

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

/** wasm の最初の内部グローバル（`__stack_pointer`）の初期値。`--stack-first` ではスタックの大きさと同じ。 */
function readStackPointerInit(wasmPath) {
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
        return result;
    };
    while (offset < bytes.length) {
        const id = bytes[offset++];
        const size = readUleb();
        const end = offset + size;
        if (id === 6) {
            readUleb();
            const valueType = bytes[offset++];
            const mutable = bytes[offset++];
            const opcode = bytes[offset++];
            // i32・可変・i32.const で初期化されたものだけを __stack_pointer とみなす
            if (valueType === 0x7f && mutable === 1 && opcode === 0x41) return readSleb32();
            return null;
        }
        offset = end;
    }
    return null;
}

function verifyStackSize(wasmPath) {
    const stackBytes = readStackPointerInit(wasmPath);
    if (stackBytes === null || stackBytes < SEARCH_STACK_BYTES) {
        throw new Error(
            `${wasmPath} の探索スタックが ${stackBytes} バイトしかありません（${SEARCH_STACK_BYTES} 以上が必要）`,
        );
    }
}

/**
 * wasm-bindgen-rayon は補助スレッドの初期化に `thread_stack_size` を渡さず、wasm-bindgen の既定
 * （2 MiB）になる。生成された workerHelpers.js の初期化の引数に足す。
 */
function setRayonThreadStackSize(outputDir) {
    const snippetsDir = path.join(outputDir, "snippets");
    const helper = readdirSync(snippetsDir, { recursive: true })
        .map((entry) => path.join(snippetsDir, String(entry)))
        .find((entry) => path.basename(entry) === "workerHelpers.js");
    if (!helper) throw new Error(`workerHelpers.js not found under ${snippetsDir}`);
    const source = readFileSync(helper, "utf8");
    const original = "init: { module_or_path: module, memory },";
    if (!source.includes(original)) {
        throw new Error(
            `${helper} の補助スレッドの初期化が想定と違います（thread_stack_size を足せません）`,
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

    rmSync(outputDir, { recursive: true, force: true });
    mkdirSync(outputDir, { recursive: true });

    run(
        "wasm-bindgen",
        ["--target", "web", "--typescript", "--out-dir", outputDir, targetWasm],
        rustRoot,
    );

    // wasm-opt は不使用（Cargo LTO で十分最適化済み、wasm-opt は逆効果: -8〜12% NPS低下）

    verifyStackSize(path.join(outputDir, `${artifactName}_bg.wasm`));

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
        rustflags: `-C target-feature=+simd128 -C link-arg=-zstack-size=${SEARCH_STACK_BYTES}`,
    });

    buildWasm({
        label: "threaded",
        cargoArgs: ["--features", "wasm-threads"],
        outDir: threadedOutDir,
        rustflags:
            "-C target-feature=+simd128 -Z unstable-options -C panic=immediate-abort -C link-arg=--shared-memory -C link-arg=--import-memory -C link-arg=--max-memory=2147483648 -C link-arg=--export=__wasm_init_tls -C link-arg=--export=__tls_base -C link-arg=--export=__tls_size -C link-arg=--export=__tls_align",
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
