/**
 * ライセンス・アプリ情報表示ダイアログ
 *
 * GPL-3.0ライセンス表示とNNUEファイルに関する注意書きを表示
 */

import type { ReactElement } from "react";
import { Dialog, DialogClose, DialogContent, DialogHeader, DialogTitle } from "./dialog";

interface AboutDialogProps {
    /** ダイアログを開くかどうか */
    open: boolean;
    /** 開閉状態変更時のコールバック */
    onOpenChange: (open: boolean) => void;
}

const GITHUB_URL = "https://github.com/SH11235/ramu-shogi";
const GPL_URL = "https://www.gnu.org/licenses/gpl-3.0.html";
const SHOGI_IMAGES_URL = "https://sunfish-shogi.github.io/shogi-images";
const SHOGI_IMAGES_AUTHOR_URL = "https://github.com/sunfish-shogi";

/**
 * このアプリについて / ライセンス情報ダイアログ
 */
export function AboutDialog({ open, onOpenChange }: AboutDialogProps): ReactElement {
    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="w-[min(480px,calc(100%-24px))]">
                {/* ヘッダー */}
                <DialogHeader className="flex flex-row items-center justify-between">
                    <DialogTitle>このアプリについて</DialogTitle>
                    <DialogClose asChild>
                        <button
                            type="button"
                            className="p-2 rounded-lg hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
                            aria-label="閉じる"
                        >
                            <svg
                                xmlns="http://www.w3.org/2000/svg"
                                width="20"
                                height="20"
                                viewBox="0 0 24 24"
                                fill="none"
                                stroke="currentColor"
                                strokeWidth="2"
                                strokeLinecap="round"
                                strokeLinejoin="round"
                                aria-hidden="true"
                            >
                                <line x1="18" y1="6" x2="6" y2="18" />
                                <line x1="6" y1="6" x2="18" y2="18" />
                            </svg>
                        </button>
                    </DialogClose>
                </DialogHeader>

                {/* コンテンツ */}
                <div className="flex flex-col gap-6 mt-4">
                    {/* アプリ名 */}
                    <div className="text-center">
                        <h2 className="text-xl font-bold text-foreground">Ramu Shogi</h2>
                    </div>

                    {/* ライセンス情報 */}
                    <section className="space-y-2">
                        <h3 className="font-semibold text-foreground">ライセンス</h3>
                        <p className="text-sm text-muted-foreground">
                            このアプリケーションは GNU General Public License v3.0
                            の下でライセンスされています。
                        </p>
                        <div className="flex flex-col gap-1 text-sm">
                            <a
                                href={GITHUB_URL}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-primary hover:underline"
                            >
                                ソースコード (GitHub)
                            </a>
                            <a
                                href={GPL_URL}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-primary hover:underline"
                            >
                                ライセンス全文 (GPL-3.0)
                            </a>
                        </div>
                    </section>

                    {/* NNUEファイルに関する注意 */}
                    <section className="space-y-2">
                        <h3 className="font-semibold text-foreground">NNUEファイルについて</h3>
                        <p className="text-sm text-muted-foreground">
                            アップロードされたNNUEファイルはユーザー提供コンテンツです。
                            そのライセンスは本アプリケーションでは管理・検証されません。
                            NNUEファイルの使用権を確認の上、ご利用ください。
                        </p>
                    </section>

                    {/* 駒画像のクレジット */}
                    <section className="space-y-2">
                        <h3 className="font-semibold text-foreground">駒画像</h3>
                        <p className="text-sm text-muted-foreground">
                            駒画像は sunfish-shogi 氏が CC0 1.0
                            Universal（パブリックドメイン）で公開している素材を使用しています。
                        </p>
                        <div className="flex flex-col gap-1 text-sm">
                            <a
                                href={SHOGI_IMAGES_URL}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-primary hover:underline"
                            >
                                Shogi Images
                            </a>
                            <a
                                href={SHOGI_IMAGES_AUTHOR_URL}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-primary hover:underline"
                            >
                                sunfish-shogi (GitHub)
                            </a>
                        </div>
                    </section>

                    {/* 英語版 */}
                    <section className="space-y-2 pt-4 border-t border-border">
                        <h3 className="font-semibold text-foreground">License</h3>
                        <p className="text-sm text-muted-foreground">
                            This application is licensed under the GNU General Public License v3.0.
                        </p>
                        <p className="text-sm text-muted-foreground">
                            Uploaded NNUE files are user-provided content. Their licenses are not
                            managed or verified by this application. Please ensure you have the
                            right to use the NNUE file.
                        </p>
                        <p className="text-sm text-muted-foreground">
                            Piece images are provided by sunfish-shogi under CC0 1.0 Universal
                            (Public Domain).
                        </p>
                    </section>
                </div>
            </DialogContent>
        </Dialog>
    );
}
