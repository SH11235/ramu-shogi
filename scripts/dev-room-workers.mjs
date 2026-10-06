// frontend Worker と backend Worker を 1 つの wrangler dev でローカル起動する。
//
//   pnpm --filter web dev:workers
//
// 環境変数:
//   BACKEND_DIR   ramu-shogi-backend の checkout（既定: この repo の隣の ../ramu-shogi-backend）
//   ROOM_BACKEND  ルーム API の処理先 "backend"（既定）または "legacy"
//   PORT          待ち受けポート（既定: 8787）
//
// backend の checkout には何も書き込まない。backend 用の wrangler 設定・.dev.vars・ローカル D1 は
// apps/web/.wrangler/room-dev/<PORT>/（git 管理外）に生成する。

import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const webDir = path.join(repoRoot, "apps", "web");

const ROOM_BACKENDS = ["backend", "legacy"];
const WEB_BUILD_COMMAND =
    "VITE_BASE_PATH=/ VITE_NNUE_MANIFEST_URL=/nnue/manifest.json pnpm --filter web build";
// backend が招待 URL やログイン後の戻り先に使う origin。ローカルの待ち受け先に合わせて上書きする
const ORIGIN_VARS = ["APP_ORIGIN", "AUTH_ORIGIN"];

function fail(message) {
    console.error(`[dev-room-workers] ${message}`);
    process.exit(1);
}

function requireFile(filePath, hint) {
    if (!fs.existsSync(filePath)) {
        fail(`${path.relative(process.cwd(), filePath) || filePath} がありません。${hint}`);
    }
}

// wrangler.jsonc のコメントと末尾カンマを取り除いて JSON として読む
function parseJsonc(text) {
    let json = "";
    let inString = false;
    for (let i = 0; i < text.length; i += 1) {
        const char = text[i];
        if (inString) {
            json += char;
            if (char === "\\") {
                json += text[i + 1];
                i += 1;
            } else if (char === '"') {
                inString = false;
            }
        } else if (char === '"') {
            inString = true;
            json += char;
        } else if (char === "/" && text[i + 1] === "/") {
            while (i < text.length && text[i] !== "\n") i += 1;
            json += "\n";
        } else if (char === "/" && text[i + 1] === "*") {
            i = text.indexOf("*/", i + 2) + 1;
        } else {
            json += char;
        }
    }
    return JSON.parse(json.replace(/,(\s*[}\]])/g, "$1"));
}

function resolveSettings() {
    const roomBackend = process.env.ROOM_BACKEND ?? "backend";
    if (!ROOM_BACKENDS.includes(roomBackend)) {
        fail(
            `ROOM_BACKEND は ${ROOM_BACKENDS.join(" / ")} のどちらかにしてください（指定値: ${roomBackend}）`,
        );
    }
    const port = Number(process.env.PORT ?? "8787");
    if (!Number.isInteger(port) || port <= 0 || port > 65535) {
        fail(`PORT が不正です（指定値: ${process.env.PORT}）`);
    }
    const backendDir = path.resolve(
        repoRoot,
        process.env.BACKEND_DIR ?? path.join("..", "ramu-shogi-backend"),
    );
    return { roomBackend, port, backendDir };
}

function checkPrerequisites(backendWorkerDir) {
    if (!fs.existsSync(backendWorkerDir)) {
        fail(
            `backend の checkout が見つかりません: ${backendWorkerDir}\n` +
                "  ramu-shogi-backend を clone し、場所が既定と違う場合は BACKEND_DIR で指定してください。",
        );
    }
    requireFile(
        path.join(backendWorkerDir, "wrangler.jsonc"),
        "BACKEND_DIR が ramu-shogi-backend のルートを指しているか確認してください。",
    );
    requireFile(
        path.join(backendWorkerDir, "node_modules"),
        "backend の checkout で pnpm install を実行してください。",
    );
    requireFile(
        path.join(webDir, "node_modules", ".bin", "wrangler"),
        "この repo で pnpm install を実行してください。",
    );
    const indexHtmlPath = path.join(webDir, "dist", "index.html");
    requireFile(indexHtmlPath, `先に apps/web/dist を作ってください: ${WEB_BUILD_COMMAND}`);
    // base path を指定しない build は /ramu-shogi/ 配下の配信を前提にするので、Worker からは読み込めない
    if (!fs.readFileSync(indexHtmlPath, "utf8").includes('src="/assets/')) {
        fail(
            `apps/web/dist が VITE_BASE_PATH=/ でビルドされていません。ビルドし直してください: ${WEB_BUILD_COMMAND}`,
        );
    }
}

function writeBackendConfig(backendWorkerDir, port) {
    const source = parseJsonc(
        fs.readFileSync(path.join(backendWorkerDir, "wrangler.jsonc"), "utf8"),
    );
    const { env: _namedEnvs, $schema: _schema, vars = {}, ...config } = source;

    const d1Databases = (config.d1_databases ?? []).map((database) => ({
        ...database,
        migrations_dir: path.resolve(backendWorkerDir, database.migrations_dir ?? "migrations"),
    }));
    if (d1Databases.length === 0) {
        fail("backend の wrangler.jsonc に d1_databases がありません。");
    }

    const generated = {
        ...config,
        main: path.resolve(backendWorkerDir, config.main),
        vars: {
            ...vars,
            ...Object.fromEntries(ORIGIN_VARS.map((key) => [key, `http://localhost:${port}`])),
        },
        d1_databases: d1Databases,
    };

    fs.mkdirSync(backendWorkDir, { recursive: true });
    const configPath = path.join(backendWorkDir, "wrangler.json");
    fs.writeFileSync(configPath, `${JSON.stringify(generated, null, 2)}\n`);
    return { configPath, databaseName: d1Databases[0].database_name };
}

function writeBackendDevVars(backendWorkerDir) {
    const candidates = [".dev.vars", ".dev.vars.example"].map((name) =>
        path.join(backendWorkerDir, name),
    );
    const sourcePath = candidates.find((candidate) => fs.existsSync(candidate));
    if (!sourcePath) {
        fail(
            `backend のローカル用シークレットが見つかりません: ${candidates.join(" / ")}\n` +
                "  backend の checkout で .dev.vars.example を .dev.vars にコピーして値を入れてください。",
        );
    }
    // .dev.vars は wrangler 設定の vars より優先されるので、origin の行は持ち込まない
    const lines = fs
        .readFileSync(sourcePath, "utf8")
        .split(/\r?\n/)
        .filter((line) => !ORIGIN_VARS.some((key) => line.trimStart().startsWith(`${key}=`)));
    fs.writeFileSync(path.join(backendWorkDir, ".dev.vars"), `${lines.join("\n")}\n`, {
        mode: 0o600,
    });
    return sourcePath;
}

function applyMigrations(wranglerBin, configPath, databaseName) {
    const result = spawnSync(
        wranglerBin,
        [
            "d1",
            "migrations",
            "apply",
            databaseName,
            "--local",
            "--config",
            configPath,
            "--persist-to",
            stateDir,
        ],
        // 非対話にして確認プロンプトを出させない
        { cwd: webDir, stdio: ["ignore", "inherit", "inherit"], env: { ...process.env, CI: "1" } },
    );
    if (result.status !== 0) {
        fail("backend のローカル D1 へのマイグレーション適用に失敗しました。");
    }
}

function startWorkers(wranglerBin, backendConfigPath, { roomBackend, port }) {
    const child = spawn(
        wranglerBin,
        [
            "dev",
            "--config",
            path.join(webDir, "wrangler.toml"),
            "--config",
            backendConfigPath,
            "--port",
            String(port),
            "--persist-to",
            stateDir,
            "--var",
            `ROOM_BACKEND:${roomBackend}`,
        ],
        { cwd: webDir, stdio: "inherit" },
    );

    for (const signal of ["SIGINT", "SIGTERM"]) {
        process.on(signal, () => {
            child.kill(signal);
        });
    }
    child.on("error", (error) => fail(`wrangler dev を起動できませんでした: ${error.message}`));
    child.on("exit", (code, signal) => {
        process.exit(code ?? (signal ? 1 : 0));
    });
}

const settings = resolveSettings();
// ポートを変えて同時に起動したもの同士で、生成物とローカルの状態を上書きし合わないようにする
const workDir = path.join(webDir, ".wrangler", "room-dev", String(settings.port));
const backendWorkDir = path.join(workDir, "backend");
const stateDir = path.join(workDir, "state");
const backendWorkerDir = path.join(settings.backendDir, "apps", "api-worker");
checkPrerequisites(backendWorkerDir);

const wranglerBin = path.join(webDir, "node_modules", ".bin", "wrangler");
const { configPath, databaseName } = writeBackendConfig(backendWorkerDir, settings.port);
const devVarsSource = writeBackendDevVars(backendWorkerDir);
console.log(
    `[dev-room-workers] backend: ${settings.backendDir}\n` +
        `[dev-room-workers] backend のシークレット: ${devVarsSource} から複製\n` +
        `[dev-room-workers] ROOM_BACKEND=${settings.roomBackend}  http://localhost:${settings.port}`,
);
applyMigrations(wranglerBin, configPath, databaseName);
startWorkers(wranglerBin, configPath, settings);
