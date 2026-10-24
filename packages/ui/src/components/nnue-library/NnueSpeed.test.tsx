import { nnueSpeedStore } from "@shogi/app-controller";
import type { NnueMeta } from "@shogi/app-core";
import type { EngineClient, EngineEventHandler } from "@shogi/engine-client";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ReactElement } from "react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ENGINE_THREADS_STORAGE_KEY } from "../shogi-match/constants";
import { NnueSpeedLine, useNnueSpeedBenchmark } from "./NnueSpeed";
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

/** 括弧の部分が別の要素に分かれていても、1 行の文として探す */
const findLine = (text: string) =>
    screen.findByText((_, element) => element?.tagName === "SPAN" && element.textContent === text);

const support: NnueSpeedSupport = { environment, createBenchmarkClient, maxThreads: 8 };

function Harness(): ReactElement {
    const benchmark = useNnueSpeedBenchmark(support);
    return <NnueSpeedLine meta={meta} support={support} benchmark={benchmark} />;
}

describe("NnueSpeedLine", () => {
    beforeEach(() => {
        localStorage.setItem(ENGINE_THREADS_STORAGE_KEY, JSON.stringify({ sente: 4, gote: 2 }));
    });
    afterEach(() => {
        cleanup();
        localStorage.clear();
    });

    it("値が無ければ「まだ測っていません」と「測る」を出し、測ると計測の値を出す", async () => {
        render(<Harness />);
        expect(await findLine("この端末での速さ: まだ測っていません（4 スレッド）")).toBeTruthy();
        fireEvent.click(screen.getByRole("button", { name: "測る" }));
        expect(await screen.findByText(/速さを測っています/)).toBeTruthy();
        expect(await findLine("この端末で 約 100万局面/秒（4 スレッド・計測）")).toBeTruthy();
    });

    it("実測があれば実測を出し、詳しくの表に回数を添える", async () => {
        for (const nps of [1_100_000, 1_200_000, 1_300_000]) {
            nnueSpeedStore.addObserved({ ...key, threads: 4 }, nps);
        }
        nnueSpeedStore.setBenchmark({ ...key, threads: 1 }, 300_000, 1);
        render(<Harness />);
        expect(
            await findLine("この端末で 約 120万局面/秒（4 スレッド・対局での実測）"),
        ).toBeTruthy();
        expect(screen.queryByText("約 120万・3 回")).toBeNull();
        fireEvent.click(screen.getByRole("button", { name: "詳しく" }));
        expect(screen.getByText("約 120万・3 回")).toBeTruthy();
        expect(screen.getByText("約 30万")).toBeTruthy();
    });

    it("対局・解析中などで測れないときは押せない", () => {
        render(<NnueSpeedLineWithReason reason="対局中は変更できません" />);
        const button = screen.getByRole("button", { name: "測る" }) as HTMLButtonElement;
        expect(button.disabled).toBe(true);
        expect(button.title).toBe("対局中は変更できません");
    });
});

function NnueSpeedLineWithReason({ reason }: { reason: string }): ReactElement {
    const benchmark = useNnueSpeedBenchmark(support);
    return (
        <NnueSpeedLine
            meta={{ ...meta, contentHashSha256: "other" }}
            support={support}
            benchmark={benchmark}
            disabledReason={reason}
        />
    );
}
