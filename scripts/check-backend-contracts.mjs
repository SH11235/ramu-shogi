import path from "node:path";
import { fileURLToPath } from "node:url";
import { checkBackendContracts } from "./contract-check.mjs";

const usage =
    "Usage: node scripts/check-backend-contracts.mjs --backend-dir <checkout> [--frontend-dir <checkout>]";

try {
    const args = process.argv.slice(2);
    if (args.length === 1 && args[0] === "--help") {
        console.log(usage);
    } else {
        const values = new Map();
        for (let index = 0; index < args.length; index += 2) {
            const flag = args[index];
            const value = args[index + 1];
            if (
                !["--backend-dir", "--frontend-dir"].includes(flag) ||
                values.has(flag) ||
                !value ||
                value.startsWith("--")
            ) {
                throw new Error(usage);
            }
            values.set(flag, path.resolve(value));
        }
        if (!values.has("--backend-dir")) throw new Error(`--backend-dir is required.\n${usage}`);
        const frontend =
            values.get("--frontend-dir") ?? fileURLToPath(new URL("../", import.meta.url));
        const backend = values.get("--backend-dir");
        const differences = await checkBackendContracts(frontend, backend);
        if (differences.length > 0) throw new Error(differences.join("\n"));
        console.log("Cross-repository HTTP / WS contracts PASS.");
        console.log(`frontend: ${frontend}`);
        console.log(`backend: ${backend}`);
    }
} catch (error) {
    console.error(error.message);
    process.exitCode = 1;
}
