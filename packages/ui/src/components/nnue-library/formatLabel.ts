import type { NnueFormat } from "@shogi/app-core";

/**
 * 形式を YaneuraOu・BulletOu と同じ数え方で「HalfKP 256x2-32-32」「LayerStacks 1536-15-64」のように書く。
 *
 * `x2` は両視点の出力をそのまま連結して次の層に渡す形だけに付ける。LayerStacks と Pairwise は
 * 視点ごとに半分同士を掛けてから連結するので、次の層への入力は L1 のままで `x2` を付けない。
 * LayerStacks の l2Dimension は出力に足す近道 1 本を含む fc_0 の出力幅 (rshogi・YaneuraOu の
 * 読み込みとも) なので、近道を除いた本数で書く。
 * 名前の末尾に L1 の次元が付いている形式（HalfKP256 など）は、次元の並びと重なるので名前から外す。
 */
export function formatLabel(format: Partial<NnueFormat> | undefined): string | null {
    const architecture = format?.architecture?.trim();
    if (!architecture || architecture.toLowerCase() === "unknown") return null;
    const [l1, l2, l3] = [format?.l1Dimension, format?.l2Dimension, format?.l3Dimension];
    if (!isDimension(l1) || !isDimension(l2) || !isDimension(l3)) return architecture;
    const name = architecture.endsWith(String(l1))
        ? architecture.slice(0, -String(l1).length)
        : architecture;
    if (isLayerStacks(architecture)) {
        return `${name} ${l1}-${l2 - 1}-${l3}`;
    }
    const concatenated = !format?.activation?.includes("Pairwise");
    return `${name} ${l1}${concatenated ? "x2" : ""}-${l2}-${l3}`;
}

/** rshogi は利きバケット付きの LayerStacks を `HalfKaHmMergedEffectBucket<FT>` という名前で返す。 */
function isLayerStacks(architecture: string): boolean {
    return (
        architecture.includes("LayerStacks") ||
        architecture.startsWith("HalfKaHmMergedEffectBucket")
    );
}

function isDimension(value: number | undefined): value is number {
    return typeof value === "number" && value > 0;
}
