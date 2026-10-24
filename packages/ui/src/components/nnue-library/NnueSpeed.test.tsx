import { nnueSpeedStore } from "@shogi/app-controller";
import type { NnueMeta } from "@shogi/app-core";
import type { EngineClient, EngineEventHandler } from "@shogi/engine-client";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ENGINE_THREADS_STORAGE_KEY } from "../shogi-match/constants";
import { NnueSpeedTable, useNnueSpeedBenchmark } from "./NnueSpeed";
import type { NnueSpeedSupport } from "./types";

const meta: NnueMeta = {
    id: "local-1",
    displayName: "my-net",
    originalFileName: "my-net.bin",
    size: 1024,
    contentHashSha256: `hash-${Math.random()}`,
    source: "user-uploaded",
    createdAt: 0,
    verified: true,
    fvScale: 16,
};

const environment = { engineVersion: "wasm:test", threaded: true };
const key = { contentHash: meta.contentHashSha256, engineVersion: "wasm:test", threaded: true };

/** 探索を始めるとすぐ、1 秒で 100 万局面の結果を返すエンジン */
const createBenchmarkClient = (): EngineClient => {
    const listeners = new Set<EngineEventHandler>();
    return {
        init: async () => {},
        loadPosition: async () => {},
        loadNnue: async () => {},
        setOption: async () => {},
        stop: async () => {},
        dispose: async () => {},
        subscribe: (handler) => {
            listeners.add(handler);
            return () => listeners.delete(handler);
        },
        search: async () => {
            setTimeout(() => {
                for (const listener of listeners) {
                    listener({ type: "info", nodes: 1_000_000, timeMs: 1000 });
                    listener({ type: "bestmove", move: "7g7f" });
                }
            }, 0);
            return { cancel: async () => {} };
        },
    };
};

const support: NnueSpeedSupport = { environment, createBenchmarkClient, maxThreads: 8 };

function Harness({ hash = meta.contentHashSha256, reason }: { hash?: string; reason?: string }) {
    const benchmark = useNnueSpeedBenchmark(support);
    return (
        <NnueSpeedTable
            meta={{ ...meta, contentHashSha256: hash }}
            support={support}
            benchmark={benchmark}
            disabledReason={reason}
        />
    );
}

/** 表の 1 行を、セルの文字を「|」でつないだ形で読む */
const rowTexts = () =>
    screen
        .getAllByRole("row")
        .slice(1)
        .map((row) => [...row.querySelectorAll("td")].map((cell) => cell.textContent).join(" | "));

describe("NnueSpeedTable", () => {
    beforeEach(() => {
        localStorage.setItem(ENGINE_THREADS_STORAGE_KEY, JSON.stringify({ sente: 4, gote: 2 }));
    });
    afterEach(() => {
        cleanup();
        localStorage.clear();
    });

    it("いまのスレッド数の行に「測る」を置き、測ると計測の値と「測り直す」を出す", async () => {
        render(<Harness />);
        expect(rowTexts()).toEqual(["4 | 測る | —"]);
        fireEvent.click(screen.getByRole("button", { name: "測る" }));
        expect(await screen.findByText("あと約 9 秒")).toBeTruthy();
        await waitFor(() => expect(rowTexts()).toEqual(["4 | 約 100万測り直す | —"]));
    });

    it("ほかのスレッド数は値のある行だけ出し、「測る」はいまのスレッド数の行にだけ置く", () => {
        for (const nps of [1_100_000, 1_200_000, 1_300_000]) {
            nnueSpeedStore.addObserved({ ...key, contentHash: "several", threads: 8 }, nps);
        }
        nnueSpeedStore.setBenchmark({ ...key, contentHash: "several", threads: 1 }, 300_000, 1);
        render(<Harness hash="several" />);
        expect(screen.getByRole("table").querySelector("caption")?.textContent).toBe(
            "この端末での NPS",
        );
        expect(rowTexts()).toEqual(["1 | 約 30万 | —", "4 | 測る | —", "8 | — | 約 120万・3 回"]);
    });

    it("対局・解析中などで測れないときは押せない", () => {
        render(<Harness hash="other" reason="対局中は変更できません" />);
        const button = screen.getByRole("button", { name: "測る" }) as HTMLButtonElement;
        expect(button.disabled).toBe(true);
        expect(button.title).toBe("対局中は変更できません");
    });
});
