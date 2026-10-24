import { createIndexedDBNnueStorage } from "@shogi/engine-wasm";

// Web版のストレージも同期的に初期化可能
export const nnueStorage = createIndexedDBNnueStorage();
