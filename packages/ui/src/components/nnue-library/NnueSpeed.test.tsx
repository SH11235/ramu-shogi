import { nnueSpeedStore } from "@shogi/app-controller";
import type { NnueMeta } from "@shogi/app-core";
import type { EngineClient, EngineEventHandler } from "@shogi/engine-client";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ENGINE_THREADS_STORAGE_KEY } from "../shogi-match/constants";
import {
    benchmarkRemainingSeconds,
    NnueSpeedTable,
    speedTableThreads,
    useNnueSpeedBenchmark,
} from "./NnueSpeed";
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

describe("benchmarkRemainingSeconds", () => {
    it("局面を読んでいる間も 1 秒ごとに減り、局面が替わるまでは次の局面の分を下回らない", () => {
        expect(benchmarkRemainingSeconds(0, 0)).toBe(9);
        expect(benchmarkRemainingSeconds(0, 1_000)).toBe(8);
        expect(benchmarkRemainingSeconds(0, 2_500)).toBe(7);
        expect(benchmarkRemainingSeconds(0, 5_000)).toBe(6);
        expect(benchmarkRemainingSeconds(2, 2_000)).toBe(1);
        expect(benchmarkRemainingSeconds(2, 9_000)).toBe(0);
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

    it("測れない環境（Desktop）では測る欄を出さず、記録のある行だけを出す", () => {
        const observedOnly: NnueSpeedSupport = { environment, maxThreads: 8 };
        function ObservedOnly({ hash }: { hash: string }) {
            const benchmark = useNnueSpeedBenchmark(observedOnly);
            return (
                <NnueSpeedTable
                    contentHash={hash}
                    prepare={async () => meta}
                    downloadNote="測るときに 1 KB をダウンロードします。"
                    support={observedOnly}
                    benchmark={benchmark}
                />
            );
        }
        const { container } = render(<ObservedOnly hash="desktop-empty" />);
        expect(container.innerHTML).toBe("");
        cleanup();
        nnueSpeedStore.addObserved({ ...key, contentHash: "desktop", threads: 6 }, 900_000);
        render(<ObservedOnly hash="desktop" />);
        expect(rowTexts()).toEqual(["6 | — | 約 90万・1 回"]);
        expect(screen.queryByRole("button")).toBeNull();
        expect(screen.queryByText(/ダウンロードします/)).toBeNull();
    });

    it("1 スレッド版に切り替わって測った値も、開き直したあとも表に出す", async () => {
        const fallbackSupport: NnueSpeedSupport = {
            environment,
            maxThreads: 8,
            createBenchmarkClient: () => {
                const client = createBenchmarkClient();
                return {
                    ...client,
                    getThreadInfo: () => ({
                        activeThreads: 1,
                        maxThreads: 1,
                        threadedAvailable: false,
                        hardwareConcurrency: 8,
                    }),
                };
            },
        };
        function Fallback() {
            const benchmark = useNnueSpeedBenchmark(fallbackSupport);
            return (
                <NnueSpeedTable
                    contentHash="fallback"
                    prepare={async () => ({ ...meta, contentHashSha256: "fallback" })}
                    support={fallbackSupport}
                    benchmark={benchmark}
                />
            );
        }
        render(<Fallback />);
        fireEvent.click(screen.getByRole("button", { name: "測る" }));
        await waitFor(() => expect(rowTexts()).toContain("1 | 約 100万 | —"));
        // 画面を開き直しても出す
        cleanup();
        render(<Fallback />);
        expect(rowTexts()).toContain("1 | 約 100万 | —");
    });

    it("測れなかったときは、操作の行に一言だけ出す（理由は title）", async () => {
        const failing: NnueSpeedSupport = {
            environment,
            maxThreads: 8,
            createBenchmarkClient: () => ({
                ...createBenchmarkClient(),
                search: async () => {
                    throw new Error("failed");
                },
            }),
        };
        function Failing() {
            const benchmark = useNnueSpeedBenchmark(failing);
            return (
                <NnueSpeedTable
                    contentHash="failing"
                    prepare={async () => meta}
                    support={failing}
                    benchmark={benchmark}
                />
            );
        }
        render(<Failing />);
        fireEvent.click(screen.getByRole("button", { name: "測る" }));
        const label = await screen.findByText("測れませんでした");
        expect(label.title).toBe("測れませんでした。もう一度お試しください。");
        expect(label.closest("div")?.querySelector("select")).not.toBeNull();
    });

    it("測る途中でダウンロードが済んでも、注記の行を残してカードの高さを変えない", async () => {
        function Downloading() {
            const benchmark = useNnueSpeedBenchmark(support);
            const [downloaded, setDownloaded] = useState(false);
            return (
                <NnueSpeedTable
                    contentHash="downloading"
                    prepare={async () => {
                        setDownloaded(true);
                        return meta;
                    }}
                    downloadNote={downloaded ? undefined : "測るときに 1 KB をダウンロードします。"}
                    support={support}
                    benchmark={benchmark}
                />
            );
        }
        render(<Downloading />);
        fireEvent.click(screen.getByRole("button", { name: "測る" }));
        await screen.findByRole("button", { name: /あと約/ });
        expect(screen.getByText("測るときに 1 KB をダウンロードします。")).toBeTruthy();
        // 測り終えたら見えなくするが、行は残してカードの高さを変えない
        const note = screen.getByText("測るときに 1 KB をダウンロードします。");
        expect(note.className).not.toContain("invisible");
        await waitFor(() => expect(note.className).toContain("invisible"));
        // ダウンロード済みのあとに測り直しても、注記は見えないまま
        fireEvent.click(screen.getByRole("button", { name: "測る" }));
        await screen.findByRole("button", { name: /あと約/ });
        expect(note.className).toContain("invisible");
    });

    it("対局・解析中などで測れないときは押せない", () => {
        render(<Harness hash="other" reason="対局中は変更できません" />);
        const button = screen.getByRole("button", { name: "測る" }) as HTMLButtonElement;
        expect(button.disabled).toBe(true);
        expect(button.title).toBe("対局中は変更できません");
    });
});
