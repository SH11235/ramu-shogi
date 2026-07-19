/// <reference types="vite/client" />

interface ImportMetaEnv {
    /** デフォルトの NNUE プリセットキー */
    readonly VITE_DEFAULT_NNUE_PRESET?: string;
    /** WASM エンジンの要求スレッド数。未設定時は4、利用不可時は1へフォールバック */
    readonly VITE_WASM_THREADS?: string;
}

interface ImportMeta {
    readonly env: ImportMetaEnv;
}
