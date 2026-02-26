import fs from "node:fs";
import path from "node:path";

const required = ["VITE_NNUE_MANIFEST_URL"];

const parseArgs = () => {
    const args = process.argv.slice(2);
    const result = { dir: process.cwd(), mode: "production" };
    for (let i = 0; i < args.length; i += 1) {
        if (args[i] === "--dir" && args[i + 1]) {
            result.dir = path.resolve(args[i + 1]);
            i += 1;
        } else if (args[i] === "--mode" && args[i + 1]) {
            result.mode = args[i + 1];
            i += 1;
        }
    }
    return result;
};

const parseEnvFile = (content) => {
    const lines = content.split(/\r?\n/);
    const result = {};
    for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith("#")) continue;
        const eqIndex = trimmed.indexOf("=");
        if (eqIndex === -1) continue;
        const key = trimmed.slice(0, eqIndex).trim();
        let value = trimmed.slice(eqIndex + 1).trim();
        if (
            (value.startsWith('"') && value.endsWith('"')) ||
            (value.startsWith("'") && value.endsWith("'"))
        ) {
            value = value.slice(1, -1);
        }
        result[key] = value;
    }
    return result;
};

const loadEnv = (dir, mode) => {
    const files = [".env", ".env.local", `.env.${mode}`, `.env.${mode}.local`];
    const merged = {};
    for (const file of files) {
        const fullPath = path.join(dir, file);
        if (!fs.existsSync(fullPath)) continue;
        const content = fs.readFileSync(fullPath, "utf8");
        Object.assign(merged, parseEnvFile(content));
    }
    return merged;
};

const { dir, mode } = parseArgs();
const fileEnv = loadEnv(dir, mode);
const env = { ...fileEnv, ...process.env };

const missing = required.filter((key) => {
    const value = env[key];
    return !value || String(value).trim() === "";
});

if (missing.length > 0) {
    console.error("Missing required environment variables:");
    console.error(`- directory: ${dir}`);
    console.error(`- mode: ${mode}`);
    for (const key of missing) {
        console.error(`- ${key}`);
    }
    process.exit(1);
}
