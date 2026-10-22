import { appendFileSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const severities = ["info", "low", "moderate", "high", "critical"];
const scopes = ["frontend-prod", "frontend-all", "pulumi"];
const isRecord = (value) => value !== null && typeof value === "object" && !Array.isArray(value);

export function evaluateAudit(report, status, scope, exceptions, now = new Date()) {
    if (!scopes.includes(scope)) throw new Error(`Unknown audit scope: ${scope}`);
    if (![0, 1].includes(status) || !isRecord(report) || report.error) {
        throw new Error(`Audit did not complete successfully (exit ${status}).`);
    }
    const counts = report.metadata?.vulnerabilities;
    if (
        !isRecord(counts) ||
        !severities.every(
            (severity) => Number.isInteger(counts[severity]) && counts[severity] >= 0,
        ) ||
        !isRecord(report.advisories)
    ) {
        throw new Error("Audit response is missing vulnerability metadata or advisories.");
    }
    const issues = Object.values(report.advisories).map((advisory) => {
        const id = advisory.url?.match(/^https:\/\/github\.com\/advisories\/(GHSA-[\w-]+)$/)?.[1];
        if (
            !id ||
            typeof advisory.module_name !== "string" ||
            !severities.includes(advisory.severity) ||
            !Array.isArray(advisory.findings) ||
            advisory.findings.length === 0 ||
            !advisory.findings.every(
                (finding) =>
                    typeof finding.version === "string" &&
                    Array.isArray(finding.paths) &&
                    finding.paths.length > 0 &&
                    finding.paths.every((path) => typeof path === "string"),
            )
        ) {
            throw new Error("Audit response contains an invalid advisory.");
        }
        const exception = exceptions.find(
            (entry) =>
                entry.scope === scope &&
                entry.advisory === id &&
                entry.module === advisory.module_name &&
                entry.severity === advisory.severity &&
                advisory.patched_versions === "<0.0.0" &&
                Date.parse(`${entry.reviewBy}T00:00:00Z`) > now.getTime() &&
                advisory.findings.every(
                    (finding) =>
                        finding.version === entry.version &&
                        finding.paths.every((path) => entry.paths.includes(path)),
                ),
        );
        return {
            id,
            module: advisory.module_name,
            severity: advisory.severity,
            occurrences: advisory.findings.length,
            paths: advisory.findings.flatMap((finding) => finding.paths),
            exception,
        };
    });
    if (
        !severities.every(
            (severity) =>
                counts[severity] ===
                issues.reduce(
                    (total, issue) => total + (issue.severity === severity ? issue.occurrences : 0),
                    0,
                ),
        ) ||
        status !== (issues.length === 0 ? 0 : 1)
    ) {
        throw new Error("Audit exit status, counts and advisory details do not agree.");
    }
    return {
        counts,
        issues,
        blocked: issues.some(
            (issue) => !issue.exception && ["high", "critical"].includes(issue.severity),
        ),
    };
}

function main() {
    const [scope, reportPath, status] = process.argv.slice(2);
    if (!scope || !reportPath || !/^[01]$/.test(status ?? "")) {
        throw new Error(
            "Usage: node scripts/check-dependency-audit.mjs <scope> <report.json> <audit-exit-code>",
        );
    }
    const exceptions = JSON.parse(
        readFileSync(
            new URL("../.github/dependency-audit-exceptions.json", import.meta.url),
            "utf8",
        ),
    );
    const result = evaluateAudit(
        JSON.parse(readFileSync(reportPath, "utf8")),
        Number(status),
        scope,
        exceptions,
    );
    const summary = [
        `### Dependency audit: ${scope}`,
        "",
        severities.map((severity) => `${severity}: ${result.counts[severity]}`).join(" | "),
        "",
        "High and critical findings block CI unless an unexpired exception matches the exact dependency path and version. All findings remain in the audit artifact.",
        "",
    ];
    for (const issue of result.issues) {
        const detail = issue.exception
            ? `Temporary exception until ${issue.exception.reviewBy}: ${issue.exception.reason}`
            : ["high", "critical"].includes(issue.severity)
              ? "Update or investigate before merging."
              : "Below the blocking threshold; review the audit artifact.";
        const message = `${issue.severity}: ${issue.module} (${issue.id}). ${detail}`;
        console.log(
            `::warning::${message.replaceAll("%", "%25").replaceAll("\r", "%0D").replaceAll("\n", "%0A")}`,
        );
        summary.push(`- ${message}`, ...issue.paths.map((path) => `  - ${path}`));
    }
    summary.push("", result.blocked ? "Result: blocked." : "Result: passed.", "");
    console.log(summary.join("\n"));
    if (process.env.GITHUB_STEP_SUMMARY) {
        appendFileSync(process.env.GITHUB_STEP_SUMMARY, summary.join("\n"));
    }
    process.exitCode = result.blocked ? 1 : 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    try {
        main();
    } catch (error) {
        console.error(error);
        process.exitCode = 2;
    }
}
