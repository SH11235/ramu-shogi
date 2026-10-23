/** アカウントに保存してある評価関数のファイル。FV_SCALE などの設定は持たない。 */
export interface NnueAccountFile {
    id: string;
    originalFilename: string;
    sizeBytes: number;
    sha256Hex: string;
    createdAt: string;
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
    upload: (file: File, busyKey: string) => Promise<void>;
    download: (fileId: string) => Promise<Blob>;
    remove: (fileId: string) => Promise<void>;
    clearError: () => void;
}
