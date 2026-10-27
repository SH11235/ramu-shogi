/**
 * 評価値のスタイルクラスを決定する。
 *
 * 色は評価値の符号ではなく「その手を指した側」で決める (先手 = 朱、後手 = 藍)。評価値グラフの
 * 線と同じ対応にして、どちらが出した評価値かを色で読めるようにする。
 */
export function getEvalClassName(row: {
    ply: number;
    mover?: "sente" | "gote";
    evalCp?: number;
    evalMate?: number;
}): string {
    const baseClass = "text-[11px] text-right min-w-12 font-mono tabular-nums";
    const hasEval =
        (row.evalMate !== undefined && row.evalMate !== null) ||
        (row.evalCp !== undefined && row.evalCp !== null);
    if (!hasEval) return `${baseClass} text-muted-foreground`;
    const mover = row.mover ?? (row.ply % 2 === 1 ? "sente" : "gote");
    return mover === "sente" ? `${baseClass} text-wafuu-shu` : `${baseClass} text-wafuu-ai`;
}
