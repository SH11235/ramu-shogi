import { fileURLToPath } from "node:url";
import { checkFrontendContracts } from "./contract-check.mjs";

try {
    if (process.argv.length !== 2) {
        throw new Error("Usage: node scripts/check-frontend-contracts.mjs");
    }
    const differences = await checkFrontendContracts(
        fileURLToPath(new URL("../", import.meta.url)),
    );
    if (differences.length > 0) throw new Error(differences.join("\n"));
    console.log("Frontend contract self-consistency PASS (backend synchronization not checked).");
} catch (error) {
    console.error(error.message);
    process.exitCode = 1;
}
