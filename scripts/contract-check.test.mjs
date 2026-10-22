import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
    checkFrontendContracts,
    declarationSignature,
    firstJsonDifference,
    generateFrontendSchema,
    withTemporaryDirectory,
} from "./contract-check.mjs";

const cli = fileURLToPath(new URL("./check-backend-contracts.mjs", import.meta.url));
const generatedPath = "packages/api-contract/src/generated";
const protocolPath = "packages/match-protocol/src/index.ts";
const protocol = 'export interface Message { type: "move"; sequence: number; }';

function document() {
    return {
        openapi: "3.1.0",
        info: { title: "Contract fixture", version: "1.0.0" },
        paths: {
            "/probe": {
                get: {
                    operationId: "probe",
                    responses: {
                        200: {
                            description: "Probe",
                            content: {
                                "application/json": {
                                    schema: { $ref: "#/components/schemas/Probe" },
                                },
                            },
                        },
                    },
                },
            },
        },
        components: {
            schemas: {
                Probe: {
                    type: "object",
                    required: ["id"],
                    properties: { id: { type: "string" } },
                },
            },
        },
    };
}

async function put(root, filename, contents) {
    const destination = path.join(root, filename);
    await mkdir(path.dirname(destination), { recursive: true });
    await writeFile(destination, contents, "utf8");
}

async function fixture(root, options = {}) {
    const frontend = path.join(root, "frontend with spaces");
    const backend = path.join(root, "backend with spaces");
    const frontendDocument = document();
    const backendDocument = structuredClone(frontendDocument);
    options.changeBackendDocument?.(backendDocument);
    const frontendSchema = await generateFrontendSchema(frontendDocument);
    const backendSchema = await generateFrontendSchema(backendDocument);
    await put(frontend, `${generatedPath}/openapi.json`, JSON.stringify(frontendDocument));
    await put(frontend, `${generatedPath}/schema.ts`, frontendSchema);
    await put(frontend, protocolPath, protocol);
    await put(backend, "package.json", '{"type":"module"}');
    await put(backend, protocolPath, options.backendProtocol ?? protocol);
    await put(backend, "contract-fixture/openapi.json", JSON.stringify(backendDocument));
    await put(backend, "contract-fixture/schema.ts", backendSchema);
    await put(
        backend,
        "scripts/generate-api-contract.ts",
        options.generator ??
            `import { copyFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
const args = process.argv.slice(2);
if (args.length !== 2 || args[0] !== "--output-dir" || !path.isAbsolute(args[1])) {
    throw new Error("Expected explicit absolute output directory");
}
if (process.env.TSX_DISABLE_CACHE !== "1") throw new Error("tsx cache must be disabled");
const source = fileURLToPath(new URL("../contract-fixture/", import.meta.url));
for (const name of ["openapi.json", "schema.ts"]) {
    await copyFile(path.join(source, name), path.join(args[1], name));
}
`,
    );
    if (!options.omitTsx) {
        await put(
            backend,
            "node_modules/tsx/package.json",
            '{"name":"tsx","type":"module","bin":"./cli.mjs"}',
        );
        await put(
            backend,
            "node_modules/tsx/cli.mjs",
            `import { pathToFileURL } from "node:url";
const [, , script, ...args] = process.argv;
process.argv = [process.execPath, script, ...args];
await import(pathToFileURL(script).href);
`,
        );
    }
    return { frontend, backend };
}

function runCli(root, args) {
    const result = spawnSync(process.execPath, [cli, ...args], {
        cwd: root,
        env: { ...process.env, TEMP: root, TMP: root, TMPDIR: root },
        encoding: "utf8",
        timeout: 30_000,
    });
    assert.equal(result.error, undefined);
    assert.equal(result.signal, null);
    return { ...result, output: `${result.stdout}\n${result.stderr}` };
}

async function fingerprint(root, relative = "") {
    const entries = await readdir(path.join(root, relative), { withFileTypes: true });
    const result = {};
    for (const entry of entries) {
        const filename = path.join(relative, entry.name);
        if (entry.isDirectory()) {
            Object.assign(result, await fingerprint(root, filename));
        } else {
            result[filename] = createHash("sha256")
                .update(await readFile(path.join(root, filename)))
                .digest("hex");
        }
    }
    return result;
}

async function runFixture(options, callback) {
    return withTemporaryDirectory(async (root) => {
        const paths = await fixture(root, options);
        await callback(root, paths);
        assert.equal(
            (await readdir(root)).some((name) => name.startsWith("ramu-contract-check-")),
            false,
            "temporary generation directories must be removed on success and failure",
        );
    });
}

test("OpenAPI comparison ignores object key order but preserves array contents", () => {
    assert.equal(firstJsonDifference({ a: 1, b: { c: 2 } }, { b: { c: 2 }, a: 1 }), null);
    assert.equal(
        firstJsonDifference({ required: ["id"] }, { required: ["id", "name"] }),
        "/required",
    );
    assert.equal(firstJsonDifference({ "/route~": { type: "string" } }, {}), "/~1route~0");
});

test("TypeScript comparison ignores comments, whitespace, quotes and type separators", () => {
    assert.deepEqual(
        declarationSignature(
            'export type Kind =\n | "a"\n | "b";\nexport interface M { id: Kind; }',
        ),
        declarationSignature(
            "// comment\r\nexport type Kind = 'a' | 'b'\r\nexport interface M{id:Kind}",
        ),
    );
});

for (const [name, left, right] of [
    ["optional fields", "export interface M { id: string }", "export interface M { id?: string }"],
    ["field types", "export interface M { id: string }", "export interface M { id: number }"],
    ["field names", "export interface M { id: string }", "export interface M { name: string }"],
    [
        "generic constraint versus default",
        "export interface ClientMessage<T = unknown> { value: T }",
        "export interface ClientMessage<T extends unknown> { value: T }",
    ],
    [
        "mapped key remapping versus value type",
        "export type M<T> = { [K in keyof T as string] }",
        "export type M<T> = { [K in keyof T]: string }",
    ],
    [
        "mapped optional modifiers",
        "export type M<T> = { [K in keyof T]+?: T[K] }",
        "export type M<T> = { [K in keyof T]-?: T[K] }",
    ],
    ["exports", "export interface M { id: string }", "interface M { id: string }"],
    ["literal values", 'export type M = "move"', 'export type M = "resign"'],
    ["type operators", "export type M = readonly string[]", "export type M = string[]"],
    ["unary operators", "export type M = -1", "export type M = 1"],
    ["import type queries", 'export type M = import("x")', 'export type M = typeof import("x")'],
]) {
    test(`TypeScript comparison detects changed ${name}`, () => {
        assert.notDeepEqual(declarationSignature(left), declarationSignature(right));
    });
}

test("unsupported runtime declarations, syntax errors and reference directives fail closed", () => {
    assert.throws(() => declarationSignature("export const value = 1"), /only type declarations/);
    assert.throws(() => declarationSignature("export interface M { id: }"), /Invalid TypeScript/);
    assert.throws(
        () => declarationSignature('/// <reference types="node" />\nexport type M = string'),
        /Reference directives/,
    );
});

test("self-consistency detects an OpenAPI edit without regenerated TypeScript", async () => {
    await runFixture({}, async (_root, { frontend }) => {
        assert.deepEqual(await checkFrontendContracts(frontend), []);
        const changed = document();
        changed.components.schemas.Probe.required.push("name");
        changed.components.schemas.Probe.properties.name = { type: "string" };
        await put(frontend, `${generatedPath}/openapi.json`, JSON.stringify(changed));
        assert.match((await checkFrontendContracts(frontend)).join("\n"), /TypeScript drift/);
    });
});

test("self-consistency detects a generated TypeScript-only edit", async () => {
    await runFixture({}, async (_root, { frontend }) => {
        const schema = await readFile(path.join(frontend, generatedPath, "schema.ts"), "utf8");
        assert.match(schema, /id: string/);
        await put(
            frontend,
            `${generatedPath}/schema.ts`,
            schema.replace("id: string", "id: number"),
        );
        assert.match((await checkFrontendContracts(frontend)).join("\n"), /TypeScript drift/);
    });
});

test("external schema references fail without fetching another document", async () => {
    for (const ref of ["https://example.invalid/schema.json", "file:///private/schema.json"]) {
        const changed = document();
        changed.components.schemas.Probe = { $ref: ref };
        await assert.rejects(generateFrontendSchema(changed), /external \$ref/);
    }
});

test("recursive JSON schema changes cannot be hidden by the named alias", async () => {
    const changed = document();
    changed.components.schemas.JsonValue = { type: "string" };
    await assert.rejects(generateFrontendSchema(changed), /JsonValue schema changed/);
});

test("CLI rejects missing, unknown, duplicate and valueless backend arguments", async () => {
    await withTemporaryDirectory(async (root) => {
        for (const args of [
            [],
            ["--unknown", root],
            ["--backend-dir", root, "--backend-dir", root],
            ["--backend-dir"],
            ["--frontend-dir", root],
        ]) {
            const result = runCli(root, args);
            assert.equal(result.status, 1, result.output);
            assert.match(result.output, /Usage:/);
            assert.doesNotMatch(result.output, /PASS/);
        }
    });
});

test("cross-repository CLI passes matching contracts with spaces in paths and leaves both trees intact", async () => {
    await runFixture(
        {
            backendProtocol:
                "// formatted\nexport interface Message {type:'move'\nsequence:number}",
        },
        async (root, { frontend, backend }) => {
            const reordered = document();
            reordered.info = { version: "1.0.0", title: "Contract fixture" };
            await put(backend, "contract-fixture/openapi.json", JSON.stringify(reordered, null, 4));
            const before = await fingerprint(root);
            const result = runCli(root, ["--backend-dir", backend, "--frontend-dir", frontend]);
            assert.equal(result.status, 0, result.output);
            assert.match(result.output, /Cross-repository HTTP \/ WS contracts PASS/);
            assert.deepEqual(await fingerprint(root), before);
        },
    );
});

test("cross-repository CLI rejects HTTP validation drift that does not change TypeScript", async () => {
    await runFixture(
        {
            changeBackendDocument(value) {
                value.components.schemas.Probe.properties.id.minLength = 2;
            },
        },
        async (root, { frontend, backend }) => {
            const result = runCli(root, ["--backend-dir", backend, "--frontend-dir", frontend]);
            assert.equal(result.status, 1, result.output);
            assert.match(
                result.output,
                /HTTP OpenAPI drift at \/components\/schemas\/Probe\/properties\/id\/minLength/,
            );
            assert.doesNotMatch(result.output, /TypeScript drift|PASS/);
        },
    );
});

test("cross-repository CLI rejects generated TypeScript drift even when OpenAPI matches", async () => {
    await runFixture({}, async (root, { frontend, backend }) => {
        const schema = await readFile(path.join(backend, "contract-fixture/schema.ts"), "utf8");
        await put(
            backend,
            "contract-fixture/schema.ts",
            schema.replace("id: string", "id: number"),
        );
        const result = runCli(root, ["--backend-dir", backend, "--frontend-dir", frontend]);
        assert.equal(result.status, 1, result.output);
        assert.match(result.output, /HTTP TypeScript drift: frontend and backend/);
        assert.doesNotMatch(result.output, /OpenAPI drift|PASS/);
    });
});

test("cross-repository CLI rejects a WS optional-field drift", async () => {
    await runFixture(
        { backendProtocol: protocol.replace("sequence:", "sequence?:") },
        async (root, { frontend, backend }) => {
            const result = runCli(root, ["--backend-dir", backend, "--frontend-dir", frontend]);
            assert.equal(result.status, 1, result.output);
            assert.match(result.output, /WS declaration drift: index.ts/);
            assert.doesNotMatch(result.output, /HTTP .*drift|PASS/);
        },
    );
});

test("cross-repository CLI detects added and removed WS source files", async () => {
    await runFixture({}, async (root, { frontend, backend }) => {
        await put(frontend, "packages/match-protocol/src/removed.ts", "export type Old = string");
        await put(backend, "packages/match-protocol/src/added.ts", "export type New = string");
        const result = runCli(root, ["--backend-dir", backend, "--frontend-dir", frontend]);
        assert.equal(result.status, 1, result.output);
        assert.match(result.output, /WS source inventory drift: added.ts/);
        assert.match(result.output, /WS source inventory drift: removed.ts/);
        assert.doesNotMatch(result.output, /PASS/);
    });
});

test("backend generation failure is nonzero and cleans up only its temporary output", async () => {
    await runFixture(
        { generator: 'process.stderr.write("fixture generation failure\\n"); process.exit(23);' },
        async (root, { frontend, backend }) => {
            await put(root, "keep.txt", "unrelated file");
            const before = await fingerprint(root);
            const result = runCli(root, ["--backend-dir", backend, "--frontend-dir", frontend]);
            assert.equal(result.status, 1, result.output);
            assert.match(result.output, /fixture generation failure/);
            assert.match(result.output, /generation failed \(exit 23\)/);
            assert.doesNotMatch(result.output, /PASS/);
            assert.deepEqual(await fingerprint(root), before);
        },
    );
});

test("missing backend dependencies cannot be mistaken for a successful check", async () => {
    await runFixture({ omitTsx: true }, async (root, { frontend, backend }) => {
        await put(
            root,
            "node_modules/tsx/package.json",
            '{"name":"tsx","type":"module","bin":"./cli.mjs"}',
        );
        await put(
            root,
            "node_modules/tsx/cli.mjs",
            `import { pathToFileURL } from "node:url";
const [, , script, ...args] = process.argv;
process.argv = [process.execPath, script, ...args];
await import(pathToFileURL(script).href);
`,
        );
        const result = runCli(root, ["--backend-dir", backend, "--frontend-dir", frontend]);
        assert.equal(result.status, 1, result.output);
        assert.match(result.output, /Backend tsx is unavailable/);
        assert.doesNotMatch(result.output, /PASS/);
    });
});

test("a generator that produces no contract fails instead of skipping comparison", async () => {
    await runFixture(
        { generator: "process.exitCode = 0;" },
        async (root, { frontend, backend }) => {
            const result = runCli(root, ["--backend-dir", backend, "--frontend-dir", frontend]);
            assert.equal(result.status, 1, result.output);
            assert.match(result.output, /Cannot read .*openapi.json/);
            assert.doesNotMatch(result.output, /PASS/);
        },
    );
});
