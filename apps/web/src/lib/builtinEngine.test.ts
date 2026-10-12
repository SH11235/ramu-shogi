import { buildStudyLayerSpec } from "@shogi/app-core";
import { describe, expect, it } from "vitest";
import { resolveBuiltinEngineIdentity } from "./builtinEngine";

describe("resolveBuiltinEngineIdentity", () => {
    it("build 時に埋め込まれた rshogi-core の版を返す", () => {
        expect(
            resolveBuiltinEngineIdentity({
                VITE_RSHOGI_CORE_VERSION: "0.8.1+05d89777",
                VITE_APP_VERSION: "1.2.3",
            }),
        ).toEqual({ kind: "wasm", name: "rshogi", version: "0.8.1+05d89777", appVersion: "1.2.3" });
    });

    it("版が取れない環境では null を返し、レイヤーの spec はアプリの版で代用される", () => {
        const identity = resolveBuiltinEngineIdentity({
            VITE_RSHOGI_CORE_VERSION: " ",
            VITE_APP_VERSION: "1.2.3",
        });
        expect(identity.version).toBeNull();
        const spec = buildStudyLayerSpec({
            engine: identity,
            appVersion: identity.appVersion,
            nnue: null,
            limits: { timeMs: 1000 },
            multiPv: 1,
        });
        expect(spec.engine).toEqual({ kind: "wasm", name: "rshogi", version: "app-1.2.3" });
    });

    it("環境変数を渡さなければ import.meta.env から読む", () => {
        const identity = resolveBuiltinEngineIdentity();
        expect(identity.kind).toBe("wasm");
        expect(identity.name).toBe("rshogi");
    });
});
