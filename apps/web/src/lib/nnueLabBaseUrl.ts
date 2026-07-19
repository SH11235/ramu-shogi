const DEFAULT_NNUE_LAB_BASE_URL = "https://nnue-lab.sh11235.com";

/** nnue-lab の Vite 設定値を正規化し、未設定時は本番 URL を返す。 */
export const resolveNnueLabBaseUrl = (): string => {
    const raw = import.meta.env.VITE_NNUE_LAB_BASE as string | undefined;
    return (raw?.trim() || DEFAULT_NNUE_LAB_BASE_URL).replace(/\/+$/, "");
};
