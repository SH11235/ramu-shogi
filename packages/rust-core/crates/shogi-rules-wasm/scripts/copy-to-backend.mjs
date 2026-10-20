// build.mjs の出力 (pkg/) と共通 fixture を backend repo の api-worker へコピーする。
//
// 使い方: node packages/rust-core/crates/shogi-rules-wasm/scripts/copy-to-backend.mjs <backend repo のパス>
// 未コミットの変更を含むビルドは生成元を辿れないので、--allow-dirty を付けない限り拒否する。

import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const crateDir = path.resolve(scriptDir, "..");
const pkgDir = path.join(crateDir, "pkg");
const fixturePath = path.join(crateDir, "fixtures", "rules-fixtures.json");
const destinationInBackend = "apps/api-worker/src/rules-wasm";

const readme = `# rules-wasm (生成物)

このディレクトリのファイルは frontend repo (ramu-shogi) の
\`packages/rust-core/crates/shogi-rules-wasm\` から生成したもので、手で編集しない。
生成元の commit・rshogi-core の rev・各ファイルの sha256 は \`manifest.json\` にある。

再生成 (frontend repo のルートで):

\`\`\`sh
node packages/rust-core/crates/shogi-rules-wasm/scripts/build.mjs
node packages/rust-core/crates/shogi-rules-wasm/scripts/copy-to-backend.mjs <backend repo のパス>
\`\`\`

\`rules-fixtures.json\` は frontend と共通の判定 fixture で、backend のテストもこれを読む。
`;

function sha256(filePath) {
    return createHash("sha256").update(readFileSync(filePath)).digest("hex");
}

function main() {
    const args = process.argv.slice(2);
    const allowDirty = args.includes("--allow-dirty");
    const backendRoot = args.find((arg) => !arg.startsWith("--"));
    if (!backendRoot) throw new Error("backend repo のパスを引数で指定してください");
    if (!existsSync(path.join(backendRoot, "apps/api-worker/package.json"))) {
        throw new Error(`${backendRoot} は backend repo (apps/api-worker) ではありません`);
    }

    const manifestPath = path.join(pkgDir, "manifest.json");
    if (!existsSync(manifestPath)) throw new Error("先に build.mjs を実行してください");
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
    if (manifest.sourceDirty && !allowDirty) {
        throw new Error("未コミットの変更を含むビルドです。commit してから build.mjs をやり直してください");
    }

    const sources = Object.keys(manifest.files).map((name) => [
        name,
        name === "rules-fixtures.json" ? fixturePath : path.join(pkgDir, name),
    ]);
    for (const [name, source] of sources) {
        if (sha256(source) !== manifest.files[name]) {
            throw new Error(`${name} が manifest と一致しません。build.mjs をやり直してください`);
        }
    }

    const destination = path.resolve(backendRoot, destinationInBackend);
    rmSync(destination, { recursive: true, force: true });
    mkdirSync(destination, { recursive: true });
    for (const [name, source] of sources) copyFileSync(source, path.join(destination, name));
    copyFileSync(manifestPath, path.join(destination, "manifest.json"));
    writeFileSync(path.join(destination, "README.md"), readme);
    console.log(`Copied ${sources.length} files and manifest to ${destination}`);
}

try {
    main();
} catch (error) {
    console.error(error.message);
    process.exitCode = 1;
}
