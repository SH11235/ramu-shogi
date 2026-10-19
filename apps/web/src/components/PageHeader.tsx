import { cn } from "@shogi/design-system";
import { Link } from "@tanstack/react-router";
import type { ReactElement, ReactNode } from "react";
import { NavDrawer } from "./NavDrawer";

interface BreadcrumbItem {
    label: string;
    to?: string;
}

interface PageHeaderProps {
    items: BreadcrumbItem[];
    right?: ReactNode;
}

export function PageHeader({ items, right }: PageHeaderProps): ReactElement {
    return (
        // 横向きの iPhone では body が左右のノッチを避けているので、帯の背景だけは画面の端まで伸ばす。
        <header className="-ml-[env(safe-area-inset-left)] -mr-[env(safe-area-inset-right)] border-b border-wafuu-border bg-wafuu-washi-warm pr-[calc(1rem+env(safe-area-inset-right))] pl-[calc(1rem+env(safe-area-inset-left))]">
            <div className="flex h-10 items-center justify-between gap-2 text-sm">
                <div className="flex min-w-0 items-center gap-2">
                    <NavDrawer />
                    <nav aria-label="パンくずリスト" className="flex min-w-0 items-center gap-1">
                        {items.map((item, i) => {
                            // スマホの幅では 3 段以上を並べると全部が「ラ…」のように切れるので、
                            // 1 つ上と現在地だけを出す（それより上へはメニューから行ける）。
                            const hiddenOnMobile = i < items.length - 2;
                            const firstOnMobile = i === Math.max(items.length - 2, 0);
                            return (
                                <span
                                    // 表示名は重なりうる（表題が上の階層と同じ名前のノートなど）ので、リンク先を鍵にする。
                                    key={item.to ?? item.label}
                                    className={cn(
                                        "items-center gap-1",
                                        hiddenOnMobile ? "hidden sm:flex" : "flex",
                                        // 幅が足りないときは現在地から切り詰め、上の階層は、現在地が区切りを含めて
                                        // 4 文字分まで縮んでから縮める（名前の長い利用者がログインしているときなど）。
                                        // 縮み方は flex-shrink の比で決まるので、現在地の比をずっと大きくしておく
                                        // （上の階層を 0 にすると、現在地が縮みきったあと誰も縮まず、右の欄に重なる）。
                                        i === items.length - 1
                                            ? "min-w-[4em] shrink-[10000]"
                                            : "min-w-0",
                                    )}
                                >
                                    {i > 0 && (
                                        <span
                                            className={cn(
                                                "mx-0.5 shrink-0 select-none text-wafuu-border",
                                                firstOnMobile && "hidden sm:inline",
                                            )}
                                        >
                                            ›
                                        </span>
                                    )}
                                    {item.to ? (
                                        <Link
                                            to={item.to}
                                            // 行の高さをヘッダーの高さに合わせ、帯のどこを押しても届くようにする。
                                            className="block truncate leading-10 text-wafuu-sumi-light transition-colors hover:text-wafuu-sumi"
                                        >
                                            {item.label}
                                        </Link>
                                    ) : (
                                        <span className="truncate font-medium text-wafuu-sumi">
                                            {item.label}
                                        </span>
                                    )}
                                </span>
                            );
                        })}
                    </nav>
                </div>
                {right}
            </div>
        </header>
    );
}
