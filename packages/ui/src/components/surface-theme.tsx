import { createContext, type ReactElement, type ReactNode, useContext } from "react";

// 局所サーフェステーマ(検討室の墨地など)を Portal 脱出組へ伝えるための context。
// theme.css の `.dark` 変数スコープは DOM の祖先にしか効かないため、Radix Portal で
// body 直下へ脱出する Dialog/Popover には届かない。React ツリーは Portal を跨いで
// 繋がっているので、context 経由でテーマ名を渡し、Portal 先のルート要素に同じ
// クラスを付け直すことで配下の CSS 変数を揃える。

export type SurfaceTheme = "dark";

const SurfaceThemeContext = createContext<SurfaceTheme | undefined>(undefined);

interface SurfaceThemeProviderProps {
    /** 局所テーマ。undefined ならページ既定のまま(何も上書きしない) */
    theme: SurfaceTheme | undefined;
    children: ReactNode;
}

export function SurfaceThemeProvider({ theme, children }: SurfaceThemeProviderProps): ReactElement {
    return <SurfaceThemeContext.Provider value={theme}>{children}</SurfaceThemeContext.Provider>;
}

/** Portal で body 直下へ出る UI が、開かれた場所の局所テーマを引き継ぐための hook */
export function useSurfaceTheme(): SurfaceTheme | undefined {
    return useContext(SurfaceThemeContext);
}
