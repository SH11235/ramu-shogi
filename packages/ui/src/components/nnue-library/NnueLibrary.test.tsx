import type { NnueMeta, PresetWithStatus } from "@shogi/app-core";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NnueLibrary } from "./NnueLibrary";
import type { NnueAccountFile, NnueAccountStore } from "./types";

const storage = {
    nnueList: [] as NnueMeta[],
    deleteNnue: vi.fn(async () => {}),
    loadBlob: vi.fn(async () => new Blob([new Uint8Array([1, 2, 3])])) as
        | ((id: string) => Promise<Blob>)
        | null,
};
const presetState = {
    presets: [] as PresetWithStatus[],
    isLoading: false,
    hasFetched: true,
    refresh: vi.fn(async () => {}),
};

vi.mock("../../hooks/useNnueStorage", () => ({
    useNnueStorage: () => ({
        nnueList: storage.nnueList,
        error: null,
        importFromFile: vi.fn(),
        importFromBlob: vi.fn(),
        importFromPath: vi.fn(),
        deleteNnue: storage.deleteNnue,
        updateDisplayName: vi.fn(),
        updateFvScale: vi.fn(),
        updateLayerStacks: vi.fn(),
        clearError: vi.fn(),
        refreshList: vi.fn(async () => {}),
        storageUsage: null,
        capabilities: { supportsFileImport: true, supportsPathImport: false, supportsLoad: true },
        loadBlob: storage.loadBlob,
    }),
}));
vi.mock("../../hooks/usePresetManager", () => ({
    usePresetManager: () => ({
        presets: presetState.presets,
        isLoading: presetState.isLoading,
        downloadingKey: null,
        downloadProgress: null,
        error: null,
        download: vi.fn(),
        clearError: vi.fn(),
        refresh: presetState.refresh,
        isConfigured: true,
        hasFetchedPresets: presetState.hasFetched,
    }),
}));

const meta = (overrides: Partial<NnueMeta>): NnueMeta => ({
    id: "local-1",
    displayName: "my-net",
    originalFileName: "my-net.bin",
    size: 1024 * 1024,
    contentHashSha256: "aaa",
    source: "user-uploaded",
    createdAt: 0,
    verified: false,
    fvScale: 16,
    ...overrides,
});

const accountFile = (overrides: Partial<NnueAccountFile>): NnueAccountFile => ({
    id: "remote-1",
    originalFilename: "remote-net.bin",
    sizeBytes: 2048,
    sha256Hex: "bbb",
    createdAt: "2026-01-01T00:00:00Z",
    status: "completed",
    ...overrides,
});

const account = (files: NnueAccountFile[]): NnueAccountStore => ({
    isAuthenticated: true,
    isLoading: false,
    files,
    error: null,
    busyKey: null,
    uploadProgress: null,
    loginHref: "/auth",
    upload: vi.fn(async () => {}),
    download: vi.fn(async () => new Blob()),
    remove: vi.fn(async () => {}),
    clearError: vi.fn(),
});

const preset = (overrides: Partial<PresetWithStatus>): PresetWithStatus => ({
    config: {
        presetKey: "coco",
        displayName: "COCO",
        description: "",
        url: "https://example.invalid/coco.bin",
        size: 1,
        sha256: "ccc",
        license: "MIT",
        releasedAt: "2026-01-01",
        recommendedFvScale: 14,
    },
    status: "latest",
    localMetas: [],
    ...overrides,
});

beforeEach(() => {
    storage.nnueList = [];
    storage.loadBlob = vi.fn(async () => new Blob([new Uint8Array([1, 2, 3])]));
    presetState.presets = [];
    presetState.isLoading = false;
    presetState.hasFetched = true;
    vi.clearAllMocks();
});
afterEach(cleanup);

describe("NnueLibrary", () => {
    it("ブラウザとアカウントの両方にある AI は 1 行にまとめ、保存先を両方示す", () => {
        storage.nnueList = [meta({ contentHashSha256: "bbb" })];
        render(<NnueLibrary account={account([accountFile({ sha256Hex: "bbb" })])} />);
        expect(screen.getAllByRole("listitem")).toHaveLength(1);
        expect(screen.getByText("保存先: このブラウザ・アカウント")).toBeDefined();
        expect(screen.queryByRole("button", { name: "アカウントに保存" })).toBeNull();
    });

    it("アップロードが途中のファイルは取り込めず、削除だけできる", () => {
        render(<NnueLibrary account={account([accountFile({ status: "failed" })])} />);
        expect(screen.queryByRole("button", { name: "このブラウザで使う" })).toBeNull();
        expect(
            screen.getByRole("button", { name: "「remote-net.bin」をアカウントから削除" }),
        ).toBeDefined();
    });

    it("アップロードの途中のファイルは、消せない（中断が要る）ので操作を出さない", () => {
        render(<NnueLibrary account={account([accountFile({ status: "pending" })])} />);
        expect(screen.queryByRole("button", { name: /remote-net\.bin/ })).toBeNull();
        expect(screen.queryByRole("button", { name: "このブラウザで使う" })).toBeNull();
    });

    it("両方にある AI は、アカウントの分だけを消せる", async () => {
        storage.nnueList = [meta({ contentHashSha256: "bbb" })];
        const store = account([accountFile({ sha256Hex: "bbb" })]);
        render(<NnueLibrary account={store} />);
        fireEvent.click(screen.getByRole("button", { name: "「my-net」を削除" }));
        fireEvent.click(screen.getByRole("button", { name: "アカウントだけ削除" }));
        await waitFor(() => expect(store.remove).toHaveBeenCalledWith("remote-1"));
        expect(storage.deleteNnue).not.toHaveBeenCalled();
    });

    it("設定ダイアログの中へのドロップは、AI の追加として受け取らない", () => {
        storage.nnueList = [meta({})];
        render(<NnueLibrary />);
        fireEvent.click(screen.getByRole("button", { name: "「my-net」の設定" }));
        const dialog = screen.getByRole("alertdialog");
        const file = new File([new Uint8Array([1])], "progress.bin");
        fireEvent.dragOver(dialog, { dataTransfer: { files: [file] } });
        fireEvent.drop(dialog, { dataTransfer: { files: [file] } });
        expect(screen.queryByText("AI を追加")).toBeNull();
    });

    it("ページの中へのドロップは、AI の追加として受け取る", () => {
        render(<NnueLibrary />);
        const file = new File([new Uint8Array([1])], "my-net.bin");
        const area = screen.getByRole("region", { name: "AI の一覧" });
        fireEvent.dragOver(area, { dataTransfer: { files: [file] } });
        fireEvent.drop(area, { dataTransfer: { files: [file] } });
        expect(screen.getByText("AI を追加")).toBeDefined();
    });

    it("配布 AI と同じ中身のアカウントのファイルも隠さない", () => {
        storage.nnueList = [
            meta({ source: "preset", presetKey: "coco", contentHashSha256: "ccc" }),
        ];
        presetState.presets = [preset({ localMetas: storage.nnueList })];
        render(<NnueLibrary account={account([accountFile({ sha256Hex: "ccc" })])} />);
        expect(screen.getByText("remote-net")).toBeDefined();
    });

    it("配布 AI と同じ中身のアカウントのファイルは、取り込ませず削除だけにする", () => {
        storage.nnueList = [
            meta({
                source: "preset",
                presetKey: "coco",
                contentHashSha256: "ccc",
                displayName: "COCO",
            }),
        ];
        presetState.presets = [preset({ localMetas: storage.nnueList })];
        render(<NnueLibrary account={account([accountFile({ sha256Hex: "ccc" })])} />);
        expect(screen.getByText("配布 AI「COCO」と同じファイルです")).toBeDefined();
        expect(screen.queryByRole("button", { name: "このブラウザで使う" })).toBeNull();
    });

    it("配布一覧を取り終えるまでは、配布 AI を追加した AI に並べない", () => {
        storage.nnueList = [meta({ source: "preset", presetKey: "coco", displayName: "COCO" })];
        presetState.hasFetched = false;
        render(<NnueLibrary />);
        expect(screen.queryByRole("button", { name: "「COCO」を削除" })).toBeNull();
    });

    it("配布一覧に無い配布 AI は追加した AI として並べ、消せるようにする", () => {
        storage.nnueList = [meta({ source: "preset", presetKey: "old", displayName: "OLD" })];
        render(<NnueLibrary />);
        expect(screen.getByRole("button", { name: "「OLD」を削除" })).toBeDefined();
    });

    it("更新のある配布 AI も、旧版を消せる。消したら配布 AI の状態を取り直す", async () => {
        const local = meta({ id: "old-coco", source: "preset", presetKey: "coco" });
        storage.nnueList = [local];
        presetState.presets = [preset({ status: "update-available", localMetas: [local] })];
        render(<NnueLibrary />);
        fireEvent.click(screen.getByRole("button", { name: "「COCO」を削除" }));
        fireEvent.click(screen.getByRole("button", { name: "削除" }));
        await waitFor(() => expect(presetState.refresh).toHaveBeenCalled());
        expect(storage.deleteNnue).toHaveBeenCalledWith("old-coco");
    });

    it("対局中は設定と削除を止める", () => {
        storage.nnueList = [meta({})];
        render(<NnueLibrary lockedReason="対局中は変更できません" />);
        const settings = screen.getByRole("button", { name: "「my-net」の設定" });
        const remove = screen.getByRole("button", { name: "「my-net」を削除" });
        expect((settings as HTMLButtonElement).disabled).toBe(true);
        expect((remove as HTMLButtonElement).disabled).toBe(true);
    });

    it("アカウントへの保存は読み出し中から二重に押せず、読み出せなければ知らせる", async () => {
        storage.nnueList = [meta({})];
        let finishRead: (value: Blob) => void = () => {};
        storage.loadBlob = vi.fn(
            () =>
                new Promise<Blob>((resolve) => {
                    finishRead = resolve;
                }),
        );
        const store = account([]);
        render(<NnueLibrary account={store} />);
        const upload = screen.getByRole("button", { name: "アカウントに保存" });
        fireEvent.click(upload);
        await waitFor(() => expect((upload as HTMLButtonElement).disabled).toBe(true));
        finishRead(new Blob([new Uint8Array([1])]));
        await waitFor(() => expect(store.upload).toHaveBeenCalledTimes(1));
        // 端末に保存してあるハッシュを渡し、アップロード前にファイル全体を読み直させない。
        expect(store.upload).toHaveBeenCalledWith(expect.any(File), "local-1", "aaa");

        storage.loadBlob = vi.fn(async () => {
            throw new Error("read failed");
        });
        cleanup();
        render(<NnueLibrary account={account([])} />);
        fireEvent.click(screen.getByRole("button", { name: "アカウントに保存" }));
        expect(await screen.findByText("「my-net」を読み出せませんでした。")).toBeDefined();
    });
});
