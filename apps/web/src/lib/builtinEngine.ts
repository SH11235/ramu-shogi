/**
 * 内蔵エンジン（Wasm の rshogi）の、研究ノートの解析レイヤー用の識別情報。
 *
 * 版は build 時に `packages/rust-core/Cargo.lock` の rshogi-core から埋め込まれる
 * （`vite.config.ts` の `VITE_RSHOGI_CORE_VERSION`。例: `0.8.1+05d89777`）。
 * アプリを更新しただけではレイヤーが割れず、エンジンを更新したときだけ変わる。
 * 取れない環境（テストなど）では `version` が null になり、`buildStudyLayerSpec` が
 * アプリの版（`app-<版>`）で代用する。
 */
interface BuiltinEngineIdentity {
    kind: "wasm";
    name: "rshogi";
    /** rshogi-core の版。取れなければ null。 */
    version: string | null;
    /** アプリの版（エンジンの版が取れないときの代用に使う）。 */
    appVersion: string;
}

const normalize = (value: string | undefined): string | null => {
    const trimmed = value?.trim();
    return trimmed ? trimmed : null;
};

export const resolveBuiltinEngineIdentity = (
    env: Pick<ImportMetaEnv, "VITE_RSHOGI_CORE_VERSION" | "VITE_APP_VERSION"> = import.meta.env,
): BuiltinEngineIdentity => ({
    kind: "wasm",
    name: "rshogi",
    version: normalize(env.VITE_RSHOGI_CORE_VERSION),
    appVersion: normalize(env.VITE_APP_VERSION) ?? "0.0.0",
});
