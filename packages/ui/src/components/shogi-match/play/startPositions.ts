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

/** 開始局面の名前（平手・駒落ち）。選べる局面のどれでもなければ「カスタム」（局面を編集して始めたとき）。 */
export function startPositionLabel(startSfen: string): string {
    if (startSfen === "startpos" || startSfen.includes(STUDY_HIRATE_SFEN)) return "平手";
    return (
        START_POSITIONS.find((position) => startSfen.includes(position.sfen))?.label ?? "カスタム"
    );
}
