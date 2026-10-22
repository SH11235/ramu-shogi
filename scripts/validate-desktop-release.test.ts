import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import {
    existsSync,
    mkdirSync,
    mkdtempSync,
    readFileSync,
    realpathSync,
    rmSync,
    writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import {
    readNodeVersion,
    run,
    validateDesktopRelease,
    validateReleaseVersion,
    verifyReleaseCommit,
    verifyRemoteTag,
} from "./validate-desktop-release.mjs";

function fixture(t: { after: (cleanup: () => void) => void }) {
    const parent = realpathSync(tmpdir());
    const root = mkdtempSync(path.join(parent, "desktop-release-test-"));
    assert.equal(path.dirname(realpathSync(root)), parent);
    t.after(() => rmSync(root, { recursive: true, force: true }));
    const write = (filename: string, content: string) => {
        const target = path.join(root, filename);
        mkdirSync(path.dirname(target), { recursive: true });
        writeFileSync(target, content);
    };
    write("package.json", JSON.stringify({ volta: { node: "24.13.0" } }));
    write("apps/desktop/package.json", JSON.stringify({ version: "0.1.0" }));
    write("apps/desktop/src-tauri/tauri.conf.json", JSON.stringify({ version: "0.1.0" }));
    write(
        "apps/desktop/src-tauri/Cargo.toml",
        '[package]\nname = "desktop"\nversion = "0.1.0"\n[dependencies]\nother = { version = "9.0.0" }\n',
    );
    write(
        "apps/desktop/src-tauri/Cargo.lock",
        'version = 4\n[[package]]\nname = "other"\nversion = "9.0.0"\n[[package]]\nname = "desktop"\nversion = "0.1.0"\n',
    );
    const git = (...args: string[]) =>
        execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();
    return { root, write, git };
}

test("all four committed version locations agree with the requested release", async (t) => {
    const { root } = fixture(t);
    assert.deepEqual(await validateDesktopRelease(root, "0.1.0"), {
        version: "0.1.0",
        tag: "v0.1.0",
        node: "24.13.0",
    });
});

for (const value of [
    undefined,
    null,
    "",
    "v0.1.0",
    " 0.1.0",
    "0.1.0\n",
    "0.1",
    "01.1.0",
    "0.1.0-beta.1",
    "0.1.0+build",
    "0.1.0\ntag=v9.9.9",
    "256.0.0",
    "0.256.0",
    "0.0.65536",
]) {
    test(`reject invalid release version ${JSON.stringify(value)}`, () => {
        assert.throws(() => validateReleaseVersion(value));
    });
}

test("accept the MSI numeric boundary", () => {
    assert.equal(validateReleaseVersion("255.255.65535"), "255.255.65535");
});

for (const [filename, content] of [
    ["apps/desktop/package.json", '{"version":"0.2.0"}'],
    ["apps/desktop/src-tauri/tauri.conf.json", '{"version":"0.2.0"}'],
    ["apps/desktop/src-tauri/Cargo.toml", '[package]\nname="desktop"\nversion="0.2.0"'],
    ["apps/desktop/src-tauri/Cargo.lock", '[[package]]\nname="desktop"\nversion="0.2.0"'],
]) {
    test(`reject a mismatch in ${filename}`, async (t) => {
        const { root, write } = fixture(t);
        write(filename, content);
        await assert.rejects(validateDesktopRelease(root, "0.1.0"), (error: Error) =>
            error.message.includes(filename),
        );
    });
}

test("reject a requested version that was not committed", async (t) => {
    const { root } = fixture(t);
    await assert.rejects(validateDesktopRelease(root, "0.2.0"), /expected 0.2.0/);
});

for (const content of [
    '[[package]]\nname="other"\nversion="0.1.0"',
    '[[package]]\nname="desktop"\nversion="0.1.0"\n[[package]]\nname="desktop"\nversion="0.1.0"',
    '[[package]]\nname="desktop"\nversion="0.1.0"\nsource="registry+https://example.test"',
]) {
    test("reject a missing or ambiguous local lockfile package", async (t) => {
        const { root, write } = fixture(t);
        write("apps/desktop/src-tauri/Cargo.lock", content);
        await assert.rejects(validateDesktopRelease(root, "0.1.0"), /exactly one local desktop/);
    });
}

test("parse TOML sections and reject malformed TOML", async (t) => {
    const { root, write } = fixture(t);
    write(
        "apps/desktop/src-tauri/Cargo.toml",
        "[package]\r\nname = 'desktop'\r\nversion = '0.1.0' # app version\r\n[dependencies]\r\nother = { version = '9.0.0' }\r\n",
    );
    assert.equal((await validateDesktopRelease(root, "0.1.0")).version, "0.1.0");
    write(
        "apps/desktop/src-tauri/Cargo.toml",
        '[package]\nname="desktop"\nversion="0.1.0"\nversion="0.2.0"',
    );
    await assert.rejects(validateDesktopRelease(root, "0.1.0"));
});

test("missing and malformed files fail before producing release outputs", async (t) => {
    const { root, write } = fixture(t);
    const output = path.join(root, "output");
    write("apps/desktop/package.json", "{invalid}");
    await assert.rejects(run([], { RELEASE_VERSION: "0.1.0", GITHUB_OUTPUT: output }, root));
    assert.equal(existsSync(output), false);
    rmSync(path.join(root, "apps/desktop/package.json"));
    await assert.rejects(validateDesktopRelease(root, "0.1.0"), /ENOENT/);
});

for (const node of [undefined, null, "", "24", "lts/*", "24.13.0\nnode=99", 24]) {
    test(`reject invalid Node pin ${JSON.stringify(node)}`, async (t) => {
        const { root, write } = fixture(t);
        const output = path.join(root, "output");
        write("package.json", JSON.stringify({ volta: { node } }));
        assert.throws(() => readNodeVersion(root), /volta.node/);
        await assert.rejects(run(["--node-version"], { GITHUB_OUTPUT: output }, root));
        assert.equal(existsSync(output), false);
    });
}

test("a valid Node pin is emitted without loading release dependencies", async (t) => {
    const { root } = fixture(t);
    const output = path.join(root, "output");
    await run(["--node-version"], { GITHUB_OUTPUT: output }, root);
    assert.equal(readFileSync(output, "utf8"), "node=24.13.0\n");
});

test("commit and lightweight/annotated tags must identify the checkout", async (t) => {
    const { root, write, git } = fixture(t);
    git("init");
    git("config", "user.name", "Release Validator Test");
    git("config", "user.email", "release-validator@example.test");
    git("config", "commit.gpgsign", "false");
    git("config", "tag.gpgsign", "false");
    git("config", "core.autocrlf", "false");
    git("add", ".");
    git("commit", "-m", "fixture");
    git("remote", "add", "origin", root);
    const commit = git("rev-parse", "HEAD");
    assert.equal(verifyReleaseCommit(root, commit), commit);
    assert.throws(() => verifyReleaseCommit(root, "main"), /full 40-character/);
    assert.throws(() => verifyReleaseCommit(root, "a".repeat(40)), /does not match/);
    verifyRemoteTag(root, "0.1.0", commit);
    git("tag", "v0.1.0");
    verifyRemoteTag(root, "0.1.0", commit);
    git("tag", "-a", "v0.2.0", "-m", "annotated");
    verifyRemoteTag(root, "0.2.0", commit);
    const output = path.join(root, "output");
    await run([], { RELEASE_VERSION: "0.1.0", GITHUB_SHA: commit, GITHUB_OUTPUT: output }, root);
    assert.equal(
        readFileSync(output, "utf8"),
        `version=0.1.0\ntag=v0.1.0\nnode=24.13.0\ncommit=${commit}\n`,
    );
    write("apps/desktop/package.json", '{"version":"0.2.0"}');
    assert.throws(() => verifyReleaseCommit(root, commit), /must match the committed checkout/);
    write("apps/desktop/package.json", '{"version":"0.1.0"}');
    write("changed", "next commit");
    git("add", "changed");
    git("commit", "-m", "next fixture");
    const next = git("rev-parse", "HEAD");
    assert.throws(() => verifyRemoteTag(root, "0.1.0", next), /Existing tag/);
    assert.throws(() => verifyRemoteTag(root, "0.2.0", next), /Existing tag/);
    await assert.rejects(
        run(["--check-tag"], { RELEASE_VERSION: "0.1.0", RELEASE_COMMIT: next }, root),
        /Existing tag/,
    );
    git("remote", "remove", "origin");
    assert.throws(() => verifyRemoteTag(root, "0.3.0", next));
});

test("CLI rejects invalid input with a nonzero exit and no GitHub outputs", (t) => {
    const { root } = fixture(t);
    const output = path.join(root, "output");
    const script = fileURLToPath(new URL("./validate-desktop-release.mjs", import.meta.url));
    const result = spawnSync(process.execPath, [script], {
        encoding: "utf8",
        env: { ...process.env, RELEASE_VERSION: "0.1.0\ntag=unexpected", GITHUB_OUTPUT: output },
    });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /Release version must/);
    assert.equal(result.stdout, "");
    assert.equal(existsSync(output), false);
});
