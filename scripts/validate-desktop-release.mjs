import { execFileSync } from "node:child_process";
import { appendFileSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const repositoryRoot = fileURLToPath(new URL("../", import.meta.url));
const versionPattern = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
const commitPattern = /^[0-9a-f]{40}$/;
const versionFiles = [
    "package.json",
    "apps/desktop/package.json",
    "apps/desktop/src-tauri/tauri.conf.json",
    "apps/desktop/src-tauri/Cargo.toml",
    "apps/desktop/src-tauri/Cargo.lock",
];

function requireVersion(value, label) {
    if (typeof value !== "string" || !versionPattern.test(value)) {
        throw new Error(
            `${label} must be a stable X.Y.Z version; received ${JSON.stringify(value)}`,
        );
    }
    return value;
}

export function readNodeVersion(root) {
    const manifest = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8"));
    return requireVersion(manifest.volta?.node, "package.json volta.node");
}

export function validateReleaseVersion(value) {
    const version = requireVersion(value, "Release version");
    const [major, minor, patch] = version.split(".").map(Number);
    // The same version must fit the MSI installer, which has narrower numeric fields than SemVer.
    if (major > 255 || minor > 255 || patch > 65535) {
        throw new Error("Release version exceeds MSI limits: major/minor <= 255, patch <= 65535");
    }
    return version;
}

export async function validateDesktopRelease(root, requestedVersion) {
    const version = validateReleaseVersion(requestedVersion);
    const node = readNodeVersion(root);
    const { parse } = await import("smol-toml");
    const read = (filename) => readFileSync(path.join(root, filename), "utf8");
    const desktop = JSON.parse(read("apps/desktop/package.json"));
    const tauri = JSON.parse(read("apps/desktop/src-tauri/tauri.conf.json"));
    const cargo = parse(read("apps/desktop/src-tauri/Cargo.toml"));
    const lock = parse(read("apps/desktop/src-tauri/Cargo.lock"));
    const packageName = cargo.package?.name;
    if (typeof packageName !== "string" || !packageName) {
        throw new Error("Cargo.toml must contain a package name");
    }
    const packages = Array.isArray(lock.package)
        ? lock.package.filter((entry) => entry.name === packageName && entry.source === undefined)
        : [];
    if (packages.length !== 1) {
        throw new Error(`Cargo.lock must contain exactly one local ${packageName} package`);
    }
    const versions = {
        "apps/desktop/package.json": desktop.version,
        "apps/desktop/src-tauri/tauri.conf.json": tauri.version,
        "apps/desktop/src-tauri/Cargo.toml": cargo.package.version,
        "apps/desktop/src-tauri/Cargo.lock": packages[0].version,
    };
    for (const [filename, actual] of Object.entries(versions)) {
        if (actual !== version) {
            throw new Error(`${filename}: expected ${version}, received ${JSON.stringify(actual)}`);
        }
    }
    return { version, tag: `v${version}`, node };
}

function git(root, args) {
    return execFileSync("git", args, {
        cwd: root,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
        timeout: 30_000,
    }).trim();
}

export function verifyReleaseCommit(root, expectedCommit) {
    if (typeof expectedCommit !== "string" || !commitPattern.test(expectedCommit)) {
        throw new Error("Release commit must be a full 40-character commit SHA");
    }
    const commit = git(root, ["rev-parse", "HEAD"]);
    if (commit !== expectedCommit) {
        throw new Error(`Checkout ${commit} does not match release commit ${expectedCommit}`);
    }
    git(root, ["ls-files", "--error-unmatch", "--", ...versionFiles]);
    try {
        git(root, ["diff", "--quiet", "HEAD", "--", ...versionFiles]);
    } catch (error) {
        throw new Error("Release version files must match the committed checkout", {
            cause: error,
        });
    }
    return commit;
}

export function verifyRemoteTag(root, version, commit) {
    const tag = `v${validateReleaseVersion(version)}`;
    const ref = `refs/tags/${tag}`;
    const peeledRef = `${ref}^{}`;
    const output = git(root, ["ls-remote", "--tags", "origin", ref, peeledRef]);
    if (!output) return;
    const refs = new Map();
    for (const line of output.split(/\r?\n/)) {
        const [sha, name, extra] = line.split("\t");
        if (
            !commitPattern.test(sha) ||
            ![ref, peeledRef].includes(name) ||
            extra ||
            refs.has(name)
        ) {
            throw new Error(`Unexpected remote tag response for ${tag}`);
        }
        refs.set(name, sha);
    }
    const target = refs.get(peeledRef) ?? refs.get(ref);
    if (!refs.has(ref) || target !== commit) {
        throw new Error(`Existing tag ${tag} points to ${target}, expected ${commit}`);
    }
}

function emitOutputs(values, filename) {
    const output = `${Object.entries(values)
        .map(([key, value]) => `${key}=${value}`)
        .join("\n")}\n`;
    if (filename) appendFileSync(filename, output);
    process.stdout.write(output);
}

export async function run(args, env, root = repositoryRoot) {
    if (args.length === 1 && args[0] === "--node-version") {
        emitOutputs({ node: readNodeVersion(root) }, env.GITHUB_OUTPUT);
    } else if (args.length === 1 && args[0] === "--check-tag") {
        const commit = verifyReleaseCommit(root, env.RELEASE_COMMIT);
        verifyRemoteTag(root, env.RELEASE_VERSION, commit);
    } else if (args.length === 0) {
        const release = await validateDesktopRelease(root, env.RELEASE_VERSION);
        const commit = verifyReleaseCommit(root, env.GITHUB_SHA);
        verifyRemoteTag(root, release.version, commit);
        emitOutputs({ ...release, commit }, env.GITHUB_OUTPUT);
    } else {
        throw new Error("Usage: validate-desktop-release.mjs [--node-version | --check-tag]");
    }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
    await run(process.argv.slice(2), process.env).catch((error) => {
        console.error(error.message);
        process.exitCode = 1;
    });
}
