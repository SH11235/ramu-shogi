/** rshogi viewer API の Vite 設定値を正規化して返す。 */
export const resolveRshogiApiBaseUrl = (): string | undefined => {
    const raw = import.meta.env.VITE_RSHOGI_API_BASE as string | undefined;
    return raw?.trim() || undefined;
};
