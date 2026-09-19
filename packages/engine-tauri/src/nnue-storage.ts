/**
 * Tauri 向け NNUE ストレージ実装
 *
 * ファイルシステムベースの NNUE 管理
 * - NNUE ファイルは app_data_dir/nnue/ に保存
 * - メタデータは localStorage に保存（軽量なため）
 */

import type { NnueMeta, NnueStorage } from "@shogi/app-core";
import { generateNnueId } from "@shogi/app-core";
import { invoke as tauriInvoke } from "@tauri-apps/api/core";

/**
 * チャンクサイズ（1MB）
 * base64 変換後は約 1.33MB
 */
const CHUNK_SIZE = 1 * 1024 * 1024;
const BINARY_STRING_CHUNK_SIZE = 0x8000;

// バイナリ文字列はバイトをそのまま保持できる方法で生成する
function bytesToBinaryString(bytes: Uint8Array): string {
    let result = "";
    for (let i = 0; i < bytes.length; i += BINARY_STRING_CHUNK_SIZE) {
        const slice = bytes.subarray(i, i + BINARY_STRING_CHUNK_SIZE);
        result += String.fromCharCode(...slice);
    }
    return result;
}

/**
 * Uint8Array の一部を base64 文字列に変換
 * チャンク単位で変換することでメモリ効率を改善
 */
function chunkToBase64(bytes: Uint8Array, offset: number, length: number): string {
    const chunk = bytes.subarray(offset, offset + length);
    return btoa(bytesToBinaryString(chunk));
}

type InvokeFn = typeof tauriInvoke;

export interface TauriNnueStorageOptions {
    /**
     * IPC 実装を差し替える場合に指定 (テスト用)
     */
    invoke?: InvokeFn;
}

interface NnueImportResult {
    format?: NnueMeta["format"];
    id: string;
    size: number;
    path: string;
}

type StoredNnueMeta = NnueMeta & { progressCoefficientsStored?: boolean };

const META_STORAGE_KEY = "shogi-nnue-meta";

/**
 * localStorage からメタデータを読み込む
 */
function loadMetaFromStorage(): Map<string, StoredNnueMeta> {
    try {
        const data = localStorage.getItem(META_STORAGE_KEY);
        if (!data) return new Map();
        const arr = JSON.parse(data) as StoredNnueMeta[];
        return new Map(arr.map((m) => [m.id, m]));
    } catch {
        return new Map();
    }
}

/**
 * localStorage にメタデータを保存
 */
function saveMetaToStorage(meta: Map<string, StoredNnueMeta>): void {
    const arr = Array.from(meta.values(), (value) => {
        if (!value.layerStacks?.progressCoeffBase64) return value;
        const { progressCoeffBase64: _coefficients, ...layerStacks } = value.layerStacks;
        return { ...value, layerStacks, progressCoefficientsStored: true };
    });
    localStorage.setItem(META_STORAGE_KEY, JSON.stringify(arr));
}

/**
 * Tauri 向け NnueStorage を作成
 */
export function createTauriNnueStorage(options: TauriNnueStorageOptions = {}): NnueStorage {
    const invoke = options.invoke ?? tauriInvoke;
    const metaCache = loadMetaFromStorage();
    const hydrate = async (meta: StoredNnueMeta): Promise<StoredNnueMeta> => {
        if (
            meta.progressCoefficientsStored &&
            meta.layerStacks &&
            !meta.layerStacks.progressCoeffBase64
        ) {
            const coefficients = await invoke<string | null>("read_nnue_progress", {
                id: meta.id,
            }).catch(() => null);
            if (!coefficients) return meta;
            const hydrated = {
                ...meta,
                layerStacks: { ...meta.layerStacks, progressCoeffBase64: coefficients },
            };
            metaCache.set(meta.id, hydrated);
            return hydrated;
        }
        return meta;
    };
    const saveCoefficients = async (
        meta: StoredNnueMeta,
        existing?: StoredNnueMeta,
    ): Promise<StoredNnueMeta> => {
        const base64 = meta.layerStacks?.progressCoeffBase64;
        if (
            base64 ||
            existing?.progressCoefficientsStored ||
            existing?.layerStacks?.progressCoeffBase64
        ) {
            await invoke("save_nnue_progress", { args: { id: meta.id, base64: base64 ?? null } });
            return { ...meta, progressCoefficientsStored: Boolean(base64) };
        }
        return meta;
    };

    return {
        capabilities: {
            supportsFileImport: false, // 将来 true に変更可能（Tauri drag&drop API対応時）
            supportsPathImport: true, // Tauri ダイアログでパス取得
            supportsLoad: false, // Rust 側でファイルパス直接使用
        },

        async save(id: string, data: Blob | Uint8Array, meta: NnueMeta): Promise<void> {
            const bytes = data instanceof Blob ? new Uint8Array(await data.arrayBuffer()) : data;

            try {
                // チャンク単位で送信（1MB ずつ）
                const totalChunks = Math.ceil(bytes.length / CHUNK_SIZE);
                for (let chunkIndex = 0; chunkIndex < totalChunks; chunkIndex++) {
                    const offset = chunkIndex * CHUNK_SIZE;
                    const length = Math.min(CHUNK_SIZE, bytes.length - offset);
                    const dataBase64 = chunkToBase64(bytes, offset, length);

                    await invoke("save_nnue_chunk", { args: { id, chunkIndex, dataBase64 } });
                }

                // 保存を完了
                await invoke("finalize_nnue_save", { id });

                // メタデータを保存
                metaCache.set(id, await saveCoefficients(meta));
                saveMetaToStorage(metaCache);
            } catch (error) {
                // エラー時は一時ファイルを削除
                await invoke("abort_nnue_save", { id }).catch(() => {
                    // 中止処理のエラーは無視
                });
                throw error;
            }
        },

        // load / loadStream は capabilities.supportsLoad === false のため未定義

        async delete(id: string): Promise<void> {
            await invoke("delete_nnue", { id });
            metaCache.delete(id);
            saveMetaToStorage(metaCache);
        },

        async listMeta(): Promise<NnueMeta[]> {
            // ファイルシステムと localStorage の整合性を確認
            const fileIds = await invoke<string[]>("list_nnue_files");
            const fileIdSet = new Set(fileIds);

            // ファイルが存在しないメタデータを削除
            let changed = false;
            for (const id of metaCache.keys()) {
                if (!fileIdSet.has(id)) {
                    metaCache.delete(id);
                    changed = true;
                }
            }
            if (changed) {
                saveMetaToStorage(metaCache);
            }

            return Promise.all(Array.from(metaCache.values(), hydrate));
        },

        async getMeta(id: string): Promise<NnueMeta | null> {
            const meta = metaCache.get(id);
            return meta ? hydrate(meta) : null;
        },

        async updateMeta(id: string, partial: Partial<NnueMeta>): Promise<void> {
            const existing = metaCache.get(id);
            if (!existing) {
                throw new Error(`NNUE not found: ${id}`);
            }
            let updated = { ...existing, ...partial };
            if ("layerStacks" in partial) updated = await saveCoefficients(updated, existing);
            metaCache.set(id, updated);
            saveMetaToStorage(metaCache);
        },

        async getUsage(): Promise<{ used: number; quota?: number }> {
            // ファイルシステムの使用量を計算
            const metas = await this.listMeta();
            const used = metas.reduce((sum, m) => sum + m.size, 0);
            return { used };
        },

        async listByContentHash(hash: string): Promise<NnueMeta[]> {
            return Promise.all(
                Array.from(metaCache.values())
                    .filter((m) => m.contentHashSha256 === hash)
                    .map(hydrate),
            );
        },

        async listByPresetKey(presetKey: string): Promise<NnueMeta[]> {
            return Promise.all(
                Array.from(metaCache.values())
                    .filter((m) => m.presetKey === presetKey)
                    .map(hydrate),
            );
        },

        async importFromPath(srcPath: string, displayName?: string): Promise<NnueMeta> {
            const id = generateNnueId();

            // ファイルをコピー
            const result = await importNnueFromPath(srcPath, id, { invoke });

            // SHA-256 計算
            const hash = await calculateNnueHash(id, { invoke });

            // ファイル名を抽出
            const fileName = srcPath.split(/[/\\]/).pop() ?? "unknown.nnue";

            // 重複チェック
            const existing = Array.from(metaCache.values()).filter(
                (m) => m.contentHashSha256 === hash,
            );
            if (existing.length > 0) {
                // 重複ファイルを削除して既存のメタを返す
                await invoke("delete_nnue", { id });
                const previous = existing[0];
                const updated = { ...previous, format: result.format ?? previous.format };
                metaCache.set(updated.id, updated);
                saveMetaToStorage(metaCache);
                return hydrate(updated);
            }

            const meta: NnueMeta = {
                id,
                displayName: displayName ?? fileName.replace(/\.nnue$/i, ""),
                originalFileName: fileName,
                size: result.size,
                format: result.format,
                contentHashSha256: hash,
                source: "user-uploaded",
                createdAt: Date.now(),
                verified: false,
            };

            // メタデータを保存
            metaCache.set(id, meta);
            saveMetaToStorage(metaCache);

            return meta;
        },
    };
}

/**
 * NNUE ファイルのハッシュを計算
 */
async function calculateNnueHash(id: string, options: { invoke?: InvokeFn } = {}): Promise<string> {
    const invoke = options.invoke ?? tauriInvoke;
    return invoke<string>("calculate_nnue_hash", { id });
}

/**
 * ファイルパスから NNUE をインポート
 * @param srcPath ソースファイルのパス
 * @param id 識別子（UUID）
 */
async function importNnueFromPath(
    srcPath: string,
    id: string,
    options: { invoke?: InvokeFn } = {},
): Promise<NnueImportResult> {
    const invoke = options.invoke ?? tauriInvoke;
    return invoke<NnueImportResult>("import_nnue_from_path", {
        args: { srcPath, id },
    });
}
