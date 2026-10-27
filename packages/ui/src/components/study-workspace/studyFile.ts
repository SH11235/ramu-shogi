/** 棋譜をファイルに保存するときの、ファイル名と保存のしかた。 */

import type { StudyKifuFormat } from "./StudyMoreMenu";

/** 保存する棋譜のファイル（中身は UTF-8 の文字列）。 */
export interface StudyKifuFile {
    fileName: string;
    text: string;
}

/** 研究ノートの表題から、棋譜のファイル名を作る（Windows などで使えない文字は「_」にする）。 */
export function studyKifuFileName(title: string, format: StudyKifuFormat): string {
    const base =
        title
            .replace(/[\\/:*?"<>|]/g, "_")
            .replace(/\s+/g, " ")
            .trim()
            .slice(0, 100) || "研究ノート";
    // KIF は中身が UTF-8 でも `.kif` にする（先頭の `#KIF version=2.0 encoding=UTF-8` で文字コードを示す。
    // 対局の棋譜のダウンロードと同じ）。
    return `${base}.${format}`;
}

/** 文字列をファイルとしてブラウザに保存させる（ダウンロード）。 */
export function downloadTextFile({ fileName, text }: StudyKifuFile): void {
    const url = URL.createObjectURL(new Blob([text], { type: "text/plain;charset=utf-8" }));
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = fileName;
    // 文書に付けていない a 要素の click ではダウンロードしないブラウザがある。
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    // クリック直後に URL を消すと、ダウンロードが始まらないブラウザがある。
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
}
