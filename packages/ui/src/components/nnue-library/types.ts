import type { EngineSpeedEnvironment } from "@shogi/app-controller";
import type { EngineClient } from "@shogi/engine-client";

/** アカウントに保存してある評価関数のファイル。FV_SCALE などの設定は持たない。 */
export interface NnueAccountFile {
    id: string;
    originalFilename: string;
    sizeBytes: number;
    sha256Hex: string;
    createdAt: string;
    /**
     * アップロードの状態。pending（途中）は中断の手続きが要るため、この一覧からは消せない。
     * failed は削除でき、同じファイルを保存し直すとサーバーが片付ける。
     */
    status: "completed" | "pending" | "failed";
}

/** ログインしたアカウントへの保存先。Web だけが渡す（Desktop はアカウントを持たない）。 */
export interface NnueAccountStore {
    isAuthenticated: boolean;
    isLoading: boolean;
    files: NnueAccountFile[];
    error: string | null;
    /** アップロード・ダウンロード・削除の途中にある対象（端末の id かアカウントの id） */
    busyKey: string | null;
    uploadProgress: number | null;
    loginHref: string;
    /** sha256Hex を渡すと、アップロード前にファイル全体を読み直してハッシュを取らない */
    upload: (file: File, busyKey: string, sha256Hex?: string) => Promise<void>;
    download: (fileId: string) => Promise<Blob>;
    remove: (fileId: string) => Promise<void>;
    clearError: () => void;
}

/** AI の行に、この端末での速さ（NPS）を出すときに渡す。 */
export interface NnueSpeedSupport {
    environment: EngineSpeedEnvironment;
    /**
     * 計測用のエンジン（`withNpsRecording` で `record: false` にしたもの）。省くと測らず、
     * 対局での実測だけを出す（Desktop は全画面で 1 つのエンジンを共有し、評価関数を起動中に
     * 1 回しか読み込めないので、計測で別の評価関数を読むと対局・解析に使えなくなる）。
     */
    createBenchmarkClient?: () => EngineClient;
    /** エンジンが使えるスレッド数の上限（Web の wasm は端末のメモリなどで決まる） */
    maxThreads?: number;
}
