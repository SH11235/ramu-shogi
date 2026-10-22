import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { evaluateAudit } from "./check-dependency-audit.mjs";

const exceptions = JSON.parse(
    readFileSync(new URL("../.github/dependency-audit-exceptions.json", import.meta.url), "utf8"),
);
const reviewDeadline = new Date(`${exceptions[0].reviewBy}T00:00:00Z`);
const now = new Date(reviewDeadline.getTime() - 86_400_000);
const reportFor = (advisories = []) => ({
    advisories: Object.fromEntries(advisories.map((advisory, index) => [index, advisory])),
    metadata: {
        vulnerabilities: Object.fromEntries(
            ["info", "low", "moderate", "high", "critical"].map((severity) => [
                severity,
                advisories.reduce(
                    (total, advisory) =>
                        total + (advisory.severity === severity ? advisory.findings.length : 0),
                    0,
                ),
            ]),
        ),
    },
});
const finding = (overrides = {}) => ({
    url: "https://github.com/advisories/GHSA-vfj7-8cjw-p6xm",
    module_name: "braces",
    severity: "high",
    patched_versions: "<0.0.0",
    findings: [{ version: "3.0.3", paths: [".>knip>fast-glob>micromatch>braces"] }],
    ...overrides,
});
const evaluate = (advisory, scope = "frontend-all", date = now) =>
    evaluateAudit(reportFor([advisory]), 1, scope, exceptions, date);

test("a completed clean audit passes", () => {
    assert.equal(evaluateAudit(reportFor(), 0, "frontend-prod", exceptions, now).blocked, false);
});

test("the known tool finding remains visible under its narrow exception", () => {
    const result = evaluate(finding());
    assert.equal(result.blocked, false);
    assert.equal(result.issues.length, 1);
    assert.ok(result.issues[0].exception?.reason);
});

test("the exception cannot exempt a production or Pulumi dependency", () => {
    assert.equal(evaluate(finding(), "frontend-prod").blocked, true);
    assert.equal(evaluate(finding(), "pulumi").blocked, true);
});

test("exceptions stop applying on their review deadline", () => {
    assert.equal(evaluate(finding(), "frontend-all", reviewDeadline).blocked, true);
});

test("an available fix, new version, new path or increased severity requires review", () => {
    for (const advisory of [
        finding({ patched_versions: ">=3.0.4" }),
        finding({ findings: [{ version: "3.0.4", paths: exceptions[0].paths }] }),
        finding({ findings: [{ version: "3.0.3", paths: [".>another-tool>braces"] }] }),
        finding({ severity: "critical" }),
        finding({ url: "https://github.com/advisories/GHSA-new1-new2-new3" }),
    ]) {
        assert.equal(evaluate(advisory).blocked, true);
    }
});

test("low and moderate findings are reported without blocking", () => {
    for (const severity of ["low", "moderate"]) {
        const result = evaluate(finding({ severity }));
        assert.equal(result.blocked, false);
        assert.equal(result.issues[0].exception, undefined);
        assert.equal(result.issues[0].severity, severity);
    }
});

test("multiple installed versions of an advisory are counted separately", () => {
    const result = evaluate(
        finding({
            findings: [
                { version: "3.0.3", paths: exceptions[0].paths },
                { version: "3.0.2", paths: [".>another-tool>braces"] },
            ],
        }),
    );
    assert.equal(result.counts.high, 2);
    assert.equal(result.issues.length, 1);
    assert.equal(result.blocked, true);
});

test("registry errors and incomplete reports fail closed", () => {
    for (const report of [{ error: { code: "ECONNRESET" } }, {}, { advisories: {} }, reportFor()]) {
        assert.throws(() => evaluateAudit(report, 1, "frontend-all", exceptions, now));
    }
    assert.throws(() => evaluateAudit(reportFor(), 2, "frontend-all", exceptions, now));
    assert.throws(() => evaluateAudit(reportFor(), 0, "unknown", exceptions, now));
});

test("mismatched counts and malformed advisory details fail closed", () => {
    const mismatched = reportFor([finding()]);
    mismatched.metadata.vulnerabilities.high = 0;
    assert.throws(() => evaluateAudit(mismatched, 1, "frontend-all", exceptions, now));
    assert.throws(() => evaluate(finding({ findings: [] })));
    assert.throws(() => evaluate(finding({ severity: "unknown" })));
});
