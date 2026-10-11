/// <reference types="vite/client" />

interface ImportMetaEnv {
    /** デフォルトの NNUE プリセットキー */
    readonly VITE_DEFAULT_NNUE_PRESET?: string;
    /** アプリの版（build 時に package.json の version を埋め込む） */
    readonly VITE_APP_VERSION?: string;
    /** 内蔵エンジン（rshogi-core）の版（build 時に Cargo.lock から埋め込む。例: `0.8.1+05d89777`） */
    readonly VITE_RSHOGI_CORE_VERSION?: string;
}

interface ImportMeta {
    readonly env: ImportMetaEnv;
}
