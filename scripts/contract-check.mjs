import { execFileSync } from "node:child_process";
import { mkdtemp, readdir, readFile, realpath, rm, stat } from "node:fs/promises";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { isDeepStrictEqual } from "node:util";
import openapiTS, { astToString } from "openapi-typescript";
import ts from "typescript";

const generatedPath = "packages/api-contract/src/generated";
const protocolPath = "packages/match-protocol/src";
const jsonValueRef = "#/components/schemas/JsonValue";
const nullableJsonValue = { oneOf: [{ $ref: jsonValueRef }, { type: "null" }] };
const jsonValueSchema = {
    anyOf: [
        { type: "string" },
        { type: "number" },
        { type: "boolean" },
        { type: "null" },
        { type: "array", items: nullableJsonValue },
        { type: "object", additionalProperties: nullableJsonValue },
    ],
};
const jsonValueType = `export type JsonValueValue =
    string | number | boolean | null | JsonValueValue[] | { [key: string]: JsonValueValue };`;

function fail(message) {
    throw new Error(message);
}

async function readText(filename) {
    try {
        return await readFile(filename, "utf8");
    } catch (error) {
        fail(`Cannot read ${filename} (${error.code ?? "read failed"}).`);
    }
}

async function readJson(filename) {
    const text = await readText(filename);
    try {
        return JSON.parse(text);
    } catch {
        fail(`Invalid JSON: ${filename}.`);
    }
}

function assertLocalReferences(document) {
    const pending = [document];
    while (pending.length > 0) {
        const value = pending.pop();
        if (value === null || typeof value !== "object") continue;
        for (const [key, child] of Object.entries(value)) {
            if (key === "$ref" && (typeof child !== "string" || !child.startsWith("#"))) {
                fail("OpenAPI must be self-contained: external $ref is not supported.");
            }
            pending.push(child);
        }
    }
}

export async function generateFrontendSchema(document) {
    assertLocalReferences(document);
    const hasJsonValue = Object.hasOwn(document.components?.schemas ?? {}, "JsonValue");
    if (
        hasJsonValue &&
        !isDeepStrictEqual(document.components.schemas.JsonValue, jsonValueSchema)
    ) {
        fail(
            "JsonValue schema changed; review its recursive TypeScript alias before regenerating.",
        );
    }
    const ast = await openapiTS(document, {
        cwd: pathToFileURL(`${process.cwd()}${path.sep}`),
        inject: hasJsonValue ? jsonValueType : undefined,
        transform(_schema, { path: schemaPath }) {
            // A named alias avoids circular indexed-access types in recursive JSON values.
            if (hasJsonValue && schemaPath === jsonValueRef) {
                return ts.factory.createTypeReferenceNode("JsonValueValue");
            }
        },
    });
    return astToString(
        ast.map((node) => {
            if (
                ts.isTypeAliasDeclaration(node) &&
                ["webhooks", "$defs"].includes(node.name.text) &&
                !node.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword)
            ) {
                return ts.factory.updateTypeAliasDeclaration(
                    node,
                    [ts.factory.createModifier(ts.SyntaxKind.ExportKeyword)],
                    node.name,
                    node.typeParameters,
                    node.type,
                );
            }
            return node;
        }),
    );
}

export function declarationSignature(source, filename = "contract.ts") {
    const parsed = ts.createSourceFile(filename, source, ts.ScriptTarget.Latest, true);
    const diagnostic = parsed.parseDiagnostics[0];
    if (diagnostic) {
        const { line, character } = parsed.getLineAndCharacterOfPosition(diagnostic.start ?? 0);
        fail(`Invalid TypeScript: ${filename}:${line + 1}:${character + 1}.`);
    }
    if (
        parsed.referencedFiles.length > 0 ||
        parsed.typeReferenceDirectives.length > 0 ||
        parsed.libReferenceDirectives.length > 0 ||
        parsed.hasNoDefaultLib
    ) {
        fail(`Reference directives are not supported in contract declarations: ${filename}.`);
    }
    for (const statement of parsed.statements) {
        if (
            !ts.isInterfaceDeclaration(statement) &&
            !ts.isTypeAliasDeclaration(statement) &&
            !(ts.isImportDeclaration(statement) && statement.importClause?.isTypeOnly) &&
            !(ts.isExportDeclaration(statement) && statement.isTypeOnly)
        ) {
            fail(`Expected only type declarations or type-only imports/exports: ${filename}.`);
        }
    }
    const signature = (node) => {
        const children = [];
        ts.forEachChild(node, (child) => {
            children.push(signature(child));
        });
        // Type operators and type-only import/export flags are not AST child nodes.
        return [
            node.kind,
            node.text,
            node.operator,
            node.isTypeOnly,
            node.isTypeOf,
            node.token,
            children,
        ];
    };
    return parsed.statements.map(signature);
}

export function firstJsonDifference(left, right, pointer = "") {
    if (isDeepStrictEqual(left, right)) return null;
    if (
        left === null ||
        right === null ||
        typeof left !== "object" ||
        typeof right !== "object" ||
        Array.isArray(left) !== Array.isArray(right)
    ) {
        return pointer || "/";
    }
    if (Array.isArray(left) && left.length !== right.length) return pointer || "/";
    for (const key of [...new Set([...Object.keys(left), ...Object.keys(right)])].sort()) {
        const childPointer = `${pointer}/${key.replaceAll("~", "~0").replaceAll("/", "~1")}`;
        if (!Object.hasOwn(left, key) || !Object.hasOwn(right, key)) return childPointer;
        const difference = firstJsonDifference(left[key], right[key], childPointer);
        if (difference !== null) return difference;
    }
    return pointer || "/";
}

async function readHttpContracts(directory) {
    return {
        document: await readJson(path.join(directory, "openapi.json")),
        schema: await readText(path.join(directory, "schema.ts")),
    };
}

export async function checkFrontendContracts(frontendDirectory) {
    const current = await readHttpContracts(path.join(frontendDirectory, generatedPath));
    const generated = await generateFrontendSchema(current.document);
    return isDeepStrictEqual(
        declarationSignature(current.schema, "stored schema.ts"),
        declarationSignature(generated, "regenerated schema.ts"),
    )
        ? []
        : ["HTTP TypeScript drift: schema.ts does not match the stored OpenAPI document."];
}

async function protocolFiles(directory, relative = "") {
    const entries = await readdir(path.join(directory, relative), { withFileTypes: true });
    const files = [];
    for (const entry of entries) {
        const name = path.posix.join(relative, entry.name);
        if (entry.isSymbolicLink()) fail(`Protocol sources must not be symlinks: ${name}.`);
        if (entry.isDirectory()) {
            files.push(...(await protocolFiles(directory, name)));
        } else if (entry.isFile() && name.endsWith(".ts") && !/\.(test|spec)\.ts$/.test(name)) {
            files.push(name);
        } else if (/\.(tsx|mts|cts)$/.test(name)) {
            fail(`Protocol sources must use .ts declarations: ${name}.`);
        }
    }
    return files.sort();
}

async function compareProtocols(frontendDirectory, backendDirectory) {
    const frontendRoot = path.join(frontendDirectory, protocolPath);
    const backendRoot = path.join(backendDirectory, protocolPath);
    const frontendFiles = await protocolFiles(frontendRoot);
    const backendFiles = await protocolFiles(backendRoot);
    if (!frontendFiles.includes("index.ts") || !backendFiles.includes("index.ts")) {
        fail("Missing match-protocol/src/index.ts in one of the checkouts.");
    }
    const differences = [];
    for (const filename of [...new Set([...frontendFiles, ...backendFiles])].sort()) {
        if (!frontendFiles.includes(filename) || !backendFiles.includes(filename)) {
            differences.push(`WS source inventory drift: ${filename}.`);
            continue;
        }
        const frontendSource = await readText(path.join(frontendRoot, filename));
        const backendSource = await readText(path.join(backendRoot, filename));
        if (
            !isDeepStrictEqual(
                declarationSignature(frontendSource, `frontend ${filename}`),
                declarationSignature(backendSource, `backend ${filename}`),
            )
        ) {
            differences.push(`WS declaration drift: ${filename}.`);
        }
    }
    return differences;
}

export async function withTemporaryDirectory(callback) {
    const root = await realpath(os.tmpdir());
    const directory = await mkdtemp(path.join(root, "ramu-contract-check-"));
    try {
        return await callback(directory);
    } finally {
        const resolved = path.resolve(directory);
        if (
            path.dirname(resolved) !== root ||
            !path.basename(resolved).startsWith("ramu-contract-check-")
        ) {
            fail("Refusing to remove a directory outside the contract-check temporary root.");
        }
        await rm(resolved, { recursive: true, force: true });
    }
}

async function generateBackendContracts(backendDirectory, outputDirectory) {
    const generator = path.join(backendDirectory, "scripts/generate-api-contract.ts");
    await readText(generator);
    const backendRequire = createRequire(path.join(backendDirectory, "package.json"));
    let tsxPackage;
    try {
        tsxPackage = backendRequire.resolve("tsx/package.json");
    } catch {
        fail("Backend tsx is unavailable. Install the backend's frozen dependencies first.");
    }
    const metadata = await readJson(tsxPackage);
    const bin = typeof metadata.bin === "string" ? metadata.bin : metadata.bin?.tsx;
    if (!bin) fail("The backend tsx package has no CLI entry point.");
    const tsxCli = path.resolve(path.dirname(tsxPackage), bin);
    try {
        execFileSync(process.execPath, [tsxCli, generator, "--output-dir", outputDirectory], {
            cwd: backendDirectory,
            env: { ...process.env, TSX_DISABLE_CACHE: "1" },
            stdio: "inherit",
            timeout: 120_000,
        });
    } catch (error) {
        fail(
            `Backend contract generation failed (exit ${error.status ?? error.code ?? "unknown"}).`,
        );
    }
}

export async function checkBackendContracts(frontendDirectory, backendDirectory) {
    const frontend = await realpath(frontendDirectory);
    const backend = await realpath(backendDirectory);
    if (!(await stat(frontend)).isDirectory() || !(await stat(backend)).isDirectory()) {
        fail("Both --frontend-dir and --backend-dir must refer to directories.");
    }
    const current = await readHttpContracts(path.join(frontend, generatedPath));
    return withTemporaryDirectory(async (outputDirectory) => {
        await generateBackendContracts(backend, outputDirectory);
        const expected = await readHttpContracts(outputDirectory);
        const differences = [];
        const pointer = firstJsonDifference(current.document, expected.document);
        if (pointer !== null) differences.push(`HTTP OpenAPI drift at ${pointer}.`);
        if (
            !isDeepStrictEqual(
                declarationSignature(current.schema, "frontend schema.ts"),
                declarationSignature(expected.schema, "backend generated schema.ts"),
            )
        ) {
            differences.push(
                "HTTP TypeScript drift: frontend and backend generated schema.ts differ.",
            );
        }
        differences.push(...(await compareProtocols(frontend, backend)));
        differences.push(...(await checkFrontendContracts(frontend)));
        return differences;
    });
}
