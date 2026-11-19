import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { checkBundleCount } from "./check-web-bundle-count.mjs";

function makeDist(t, html, jsCount = 0) {
    const dist = mkdtempSync(join(tmpdir(), "web-bundle-count-"));
    t.after(() => rmSync(dist, { recursive: true, force: true }));

    if (html !== undefined) {
        writeFileSync(join(dist, "index.html"), html);
        const assets = join(dist, "assets");
        mkdirSync(assets);
        mkdirSync(join(assets, "directory.js"));
        writeFileSync(join(assets, "index.css"), "");
        writeFileSync(join(assets, "index.js.map"), "");
        for (let i = 0; i < jsCount; i++) {
            writeFileSync(join(assets, `chunk-${i}.js`), "");
        }
    }

    return dist;
}

function preloads(count) {
    return Array.from(
        { length: count },
        (_, i) => `<link rel="modulepreload" crossorigin href="/assets/chunk-${i}.js">`,
    ).join("\n");
}

test("上限未満のビルドは通り、HTML の同じ参照は一度だけ数える", (t) => {
    const html = `
        <script type="module" crossorigin src="/assets/chunk-0.js"></script>
        ${preloads(2)}
        <link rel="stylesheet" crossorigin href="/assets/index.css">
        <link rel="modulepreload" crossorigin href="/ramu-shogi/assets/vendor.js">
        <!-- <link rel="modulepreload" href="/assets/comment.js"> -->
        <link rel="icon" href="/favicon.svg">
    `;
    const dist = makeDist(t, html, 2);
    const log = t.mock.method(console, "log", () => {});
    checkBundleCount(dist);
    assert.deepEqual(
        log.mock.calls.map(({ arguments: args }) => args[0]),
        ["index.html /assets/ references: 4 (limit: 20)", "assets/ .js files: 2 (limit: 70)"],
    );
});

test("件数が上限と同じ場合は通る", (t) => {
    checkBundleCount(makeDist(t, preloads(20), 70));
});

test("HTML の参照数が上限を超えると失敗する", (t) => {
    const dist = makeDist(t, preloads(21), 21);
    assert.throws(() => checkBundleCount(dist), {
        message:
            /Each file is loaded in a separate request.*CDN rate limit in production.*apps\/web\/vite\.config\.ts before raising the limit/,
    });
});

test("JS ファイル数が上限を超えると失敗する", (t) => {
    const dist = makeDist(t, preloads(1), 71);
    assert.throws(() => checkBundleCount(dist), /Web bundle file count exceeded/);
});

test("index.html が無ければビルドが必要だと伝える", (t) => {
    const dist = makeDist(t);
    assert.throws(() => checkBundleCount(dist), /Missing .*index\.html\. Build apps\/web/);
});
