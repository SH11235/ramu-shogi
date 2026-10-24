import { STUDY_HIRATE_SFEN } from "@shogi/app-core";

/**
 * 選べる開始局面。駒落ちは後手（上手）の駒を落とし、上手から指す
 * （オンライン対局の開始局面と同じ SFEN）。
 */
export const START_POSITIONS: Array<{ id: string; label: string; sfen: string }> = [
    {
        id: "bishop",
        label: "角落ち",
        sfen: "lnsgkgsnl/1r7/ppppppppp/9/9/9/PPPPPPPPP/1B5R1/LNSGKGSNL w - 1",
    },
    {
        id: "rook",
        label: "飛車落ち",
        sfen: "lnsgkgsnl/7b1/ppppppppp/9/9/9/PPPPPPPPP/1B5R1/LNSGKGSNL w - 1",
    },
    {
        id: "rook-bishop",
        label: "飛車角落ち（二枚落ち）",
        sfen: "lnsgkgsnl/9/ppppppppp/9/9/9/PPPPPPPPP/1B5R1/LNSGKGSNL w - 1",
    },
];

/** `sfen` の前置きと余分な空白を除いた SFEN。 */
const normalizeSfen = (sfen: string): string =>
    sfen
        .trim()
        .replace(/^sfen\s+/, "")
        .replace(/\s+/g, " ");

/**
 * 開始局面が平手か（`startpos` と、`sfen` の前置き付き・無しの平手の SFEN）。手数まで含めて比べる
 * （手数が違う SFEN を `startpos` として書き出すと、開始の手数が失われる）。
 */
export const isHirateStart = (startSfen: string): boolean =>
    startSfen === "startpos" || normalizeSfen(startSfen) === STUDY_HIRATE_SFEN;

/** 選べる駒落ちの局面のうち、`startSfen` と同じもの（手数まで含めて比べる）。 */
export const findStartPosition = (startSfen: string) => {
    const sfen = normalizeSfen(startSfen);
    return START_POSITIONS.find((position) => position.sfen === sfen);
};

/** 開始局面の名前（平手・駒落ち）。選べる局面のどれでもなければ「カスタム」（局面を編集して始めたとき）。 */
export function startPositionLabel(startSfen: string): string {
    if (isHirateStart(startSfen)) return "平手";
    return findStartPosition(startSfen)?.label ?? "カスタム";
}
