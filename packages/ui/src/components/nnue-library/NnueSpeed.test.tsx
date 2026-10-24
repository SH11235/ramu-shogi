import { nnueSpeedStore } from "@shogi/app-controller";
import type { NnueMeta } from "@shogi/app-core";
import type { EngineClient, EngineEventHandler } from "@shogi/engine-client";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ENGINE_THREADS_STORAGE_KEY } from "../shogi-match/constants";
import { NnueSpeedTable, speedTableThreads, useNnueSpeedBenchmark } from "./NnueSpeed";
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

function Harness({
    hash = meta.contentHashSha256,
    reason,
    prepare = async () => ({ ...meta, contentHashSha256: hash }),
}: {
    hash?: string;
    reason?: string;
    prepare?: () => Promise<NnueMeta | undefined>;
}) {
    const benchmark = useNnueSpeedBenchmark(support);
    return (
        <NnueSpeedTable
            contentHash={hash}
            prepare={prepare}
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

describe("speedTableThreads", () => {
    it("1・上限の半分・上限に、いまの設定と記録のある数を足す", () => {
        expect(speedTableThreads(8, 4, [])).toEqual([1, 4, 8]);
        expect(speedTableThreads(8, 3, [6])).toEqual([1, 3, 4, 6, 8]);
        expect(speedTableThreads(2, 2, [])).toEqual([1, 2]);
        expect(speedTableThreads(1, 1, [])).toEqual([1]);
    });
});

describe("NnueSpeedTable", () => {
    beforeEach(() => {
        localStorage.setItem(ENGINE_THREADS_STORAGE_KEY, JSON.stringify({ sente: 4, gote: 2 }));
    });
    afterEach(() => {
        cleanup();
        localStorage.clear();
    });

    it("選んだスレッド数で測り、表のその行に計測の値を出す", async () => {
        render(<Harness />);
        expect(rowTexts()).toEqual(["1 | — | —", "4 | — | —", "8 | — | —"]);
        const select = screen.getByRole("combobox", {
            name: "測るスレッド数",
        }) as HTMLSelectElement;
        expect(select.value).toBe("4");
        fireEvent.change(select, { target: { value: "8" } });
        fireEvent.click(screen.getByRole("button", { name: "測る" }));
        expect(await screen.findByRole("button", { name: /あと約 9 秒|準備中/ })).toBeTruthy();
        await waitFor(() =>
            expect(rowTexts()).toEqual(["1 | — | —", "4 | — | —", "8 | 約 100万 | —"]),
        );
    });

    it("実測は中央値と回数を出し、記録のあるスレッド数の行を足す", () => {
        for (const nps of [1_100_000, 1_200_000, 1_300_000]) {
            nnueSpeedStore.addObserved({ ...key, contentHash: "several", threads: 3 }, nps);
        }
        render(<Harness hash="several" />);
        expect(rowTexts()).toEqual([
            "1 | — | —",
            "3 | — | 約 120万・3 回",
            "4 | — | —",
            "8 | — | —",
        ]);
    });

    it("用意できなかったとき（ダウンロードの失敗など）は測らない", async () => {
        render(<Harness hash="missing" prepare={async () => undefined} />);
        fireEvent.click(screen.getByRole("button", { name: "測る" }));
        await waitFor(() => expect(screen.getByRole("button", { name: "測る" })).toBeTruthy());
        expect(rowTexts()).toEqual(["1 | — | —", "4 | — | —", "8 | — | —"]);
    });

    it("対局・解析中などで測れないときは押せない", () => {
        render(<Harness hash="other" reason="対局中は変更できません" />);
        const button = screen.getByRole("button", { name: "測る" }) as HTMLButtonElement;
        expect(button.disabled).toBe(true);
        expect(button.title).toBe("対局中は変更できません");
    });
});
