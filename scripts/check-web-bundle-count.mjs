import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const MAX_INDEX_ASSETS = 20;
const MAX_JS_FILES = 70;

export function checkBundleCount(distDir) {
    const indexPath = join(distDir, "index.html");
    let html;
    try {
        html = readFileSync(indexPath, "utf8");
    } catch (error) {
        if (error.code === "ENOENT") {
            throw new Error(
                `Missing ${indexPath}. Build apps/web before checking the bundle count.`,
            );
        }
        throw error;
    }

    const references = new Set();
    const markup = html.replace(/<!--[\s\S]*?-->/g, "");
    for (const [, asset] of markup.matchAll(
        /<(?:script|link)\b[^>]*?\s(?:src|href)\s*=\s*["']((?:\/[^/"'\s]+)*\/assets\/[^"']+)["']/gi,
    )) {
        references.add(asset);
    }
    const jsCount = readdirSync(join(distDir, "assets"), { withFileTypes: true }).filter(
        (entry) => entry.isFile() && entry.name.endsWith(".js"),
    ).length;

    console.log(`index.html /assets/ references: ${references.size} (limit: ${MAX_INDEX_ASSETS})`);
    console.log(`assets/ .js files: ${jsCount} (limit: ${MAX_JS_FILES})`);
    if (references.size > MAX_INDEX_ASSETS || jsCount > MAX_JS_FILES) {
        throw new Error(
            "Web bundle file count exceeded. Each file is loaded in a separate request. " +
                "A past increase tripped the CDN rate limit in production. " +
                "Check the code-splitting config in apps/web/vite.config.ts before raising the limit.",
        );
    }
}

if (import.meta.main) {
    try {
        checkBundleCount(process.argv[2] ?? "apps/web/dist");
    } catch (error) {
        console.error(error.message);
        process.exitCode = 1;
    }
}
