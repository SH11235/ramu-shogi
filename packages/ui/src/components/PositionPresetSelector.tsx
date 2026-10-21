// 開始局面セレクター
// ローカル対局・オンライン対局で共通使用

import type { ReactElement } from "react";
import { useState } from "react";
import { Input } from "./input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./select";

// ─── プリセット定義 ────────────────────────────────────────────────────────────

export interface PositionPreset {
    /** API に送信する startSfen 値（"startpos" または "handicap:xxx" または SFEN 文字列） */
    value: string;
    label: string;
    /** 選択時に表示する補助説明 */
    description?: string;
}

/** v0.1 プリセット一覧（仕様書 §5.2 準拠） */
export const POSITION_PRESETS: PositionPreset[] = [
    { value: "startpos", label: "平手" },
    {
        value: "handicap:bishop",
        label: "角落ち",
        description: "後手（上手）の角行なし。先手（下手）が先に指します。",
    },
    {
        value: "handicap:rook",
        label: "飛車落ち",
        description: "後手（上手）の飛車なし。先手（下手）が先に指します。",
    },
    {
        value: "handicap:rook-bishop",
        label: "飛車角落ち",
        description: "後手（上手）の飛車・角なし。先手（下手）が先に指します。",
    },
    { value: "custom", label: "SFEN 直接入力" },
];

const CUSTOM_VALUE = "custom";

const ONLINE_FORMAT_MESSAGE =
    "オンライン対局では読み取れない局面です。SFEN の書き方を確認してください";
const ONLINE_FIELD_COUNT_MESSAGE =
    "SFEN は「盤面 手番 持ち駒 手数」の 4 つだけにしてください。先頭の sfen や後ろの moves は外してください";
const ONLINE_KING_COUNT_MESSAGE =
    "オンライン対局では、先手と後手の玉が 1 枚ずつある局面だけ使えます";
const ONLINE_PIECE_COUNT_MESSAGE =
    "駒が多すぎます。盤と持ち駒を合わせて、歩は 18 枚、香・桂・銀・金は 4 枚、角・飛は 2 枚までです";
const ONLINE_MAX_START_PLY = 1_000_000;
const ONLINE_PLY_MESSAGE = `SFEN の最後の数字 (手数) は 1 から ${ONLINE_MAX_START_PLY.toLocaleString("ja-JP")} までにしてください`;
const ONLINE_MAX_SFEN_LENGTH = 512;

// 盤上と両者の持ち駒を合わせた枚数の上限。サーバーの合法手判定はこれを超える局面を読めない
const PIECE_LIMITS = { P: 18, L: 4, N: 4, S: 4, G: 4, B: 2, R: 2 } as const;

/**
 * オンライン対局で使えない開始局面なら、そのわけを返す。サーバーは使えない局面で部屋を作らず、
 * 待機中の設定変更は黙って捨てるので、送る前に画面で止める。"" はまだ入力されていない印なので対象外
 */
export function onlineStartSfenProblem(value: string): string | null {
    if (value === "" || POSITION_PRESETS.some((p) => p.value !== CUSTOM_VALUE && p.value === value))
        return null;
    const fields = value.trim().split(/\s+/);
    // 手数を省いた「盤面 手番 持ち駒」は、サーバーが 1 手目として受け付ける
    if (fields.length === 3) fields.push("1");
    if (fields.length > 4) return ONLINE_FIELD_COUNT_MESSAGE;
    if (fields.length < 4) return ONLINE_FORMAT_MESSAGE;
    const [board = "", turn, hands = "", ply = ""] = fields;
    const counts =
        value.length <= ONLINE_MAX_SFEN_LENGTH && (turn === "b" || turn === "w")
            ? countPieces(board, hands)
            : null;
    if (!counts) return ONLINE_FORMAT_MESSAGE;
    if (counts.get("K") !== 1 || counts.get("k") !== 1) return ONLINE_KING_COUNT_MESSAGE;
    const tooMany = Object.entries(PIECE_LIMITS).some(
        ([piece, max]) => (counts.get(piece) ?? 0) + (counts.get(piece.toLowerCase()) ?? 0) > max,
    );
    if (tooMany) return ONLINE_PIECE_COUNT_MESSAGE;
    // サーバーは先頭に 0 の付いた手数や数字以外を書式の誤りとして断る
    if (!/^(0|-?[1-9]\d*)$/.test(ply)) return ONLINE_FORMAT_MESSAGE;
    if (Number(ply) < 1 || Number(ply) > ONLINE_MAX_START_PLY) return ONLINE_PLY_MESSAGE;
    return null;
}

// 盤上と持ち駒の駒を、成りを外した駒の文字 (先手は大文字、後手は小文字) ごとに数える。
// 書式がサーバーの受け付けない形なら null
function countPieces(board: string, hands: string): Map<string, number> | null {
    const counts = new Map<string, number>();
    const add = (piece: string, n: number) => counts.set(piece, (counts.get(piece) ?? 0) + n);
    const ranks = board.split("/");
    if (ranks.length !== 9) return null;
    for (const rank of ranks) {
        let squares = 0;
        for (const token of rank.match(/\+?./g) ?? []) {
            if (/^[1-9]$/.test(token)) squares += Number(token);
            else if (/^(\+[PLNSBRplnsbr]|[PLNSGBRKplnsgbrk])$/.test(token)) {
                squares += 1;
                add(token.slice(-1), 1);
            } else return null;
        }
        if (squares !== 9) return null;
    }
    if (hands === "-") return counts;
    // サーバーは同じ駒を 2 度書いた持ち駒を受け付けない
    const seen = new Set<string>();
    let consumed = "";
    for (const [token, n, piece] of hands.matchAll(/([1-9]\d*)?([RBGSNLPrbgsnlp])/g)) {
        if (seen.has(piece)) return null;
        seen.add(piece);
        add(piece, n ? Number(n) : 1);
        consumed += token;
    }
    return consumed === hands ? counts : null;
}

// ─── バリデーション ────────────────────────────────────────────────────────────

function validateCustomSfen(sfen: string): string | null {
    if (!sfen.trim()) return "局面（SFEN）を入力してください";

    // SFEN形式: 「盤面 手番 持駒 手数」をスペース区切りで
    const parts = sfen.trim().split(/\s+/);
    if (parts.length < 3)
        return "有効な局面ではありません（例: lnsgkgsnl/1r5b1/ppppppppp/9/9/9/PPPPPPPPP/1B5R1/LNSGKGSNL b - 1）";

    const [board, turn] = parts;

    // 盤面: スラッシュで9段に分かれていること
    const rows = board.split("/");
    if (rows.length !== 9) return "盤面の形式が正しくありません（スラッシュ区切りで9段必要）";

    // 手番: b（先手）または w（後手）
    if (turn !== "b" && turn !== "w") return "手番の指定が正しくありません（b = 先手 / w = 後手）";

    return null;
}

// サーバーには前後の空白を除き、フィールドの間を 1 つの空白にそろえて渡す。
// クライアントは空白 1 つ区切りの開始局面でないと、対局開始時の局面を自分で組み立てられない
function normalizeSfenSpacing(sfen: string): string {
    return sfen.trim().replace(/\s+/g, " ");
}

// ─── コンポーネント ────────────────────────────────────────────────────────────

export interface PositionPresetSelectorProps {
    /** 現在選択されている startSfen 値 */
    value: string;
    /** 変更時コールバック（startSfen 文字列を渡す） */
    onChange: (sfen: string) => void;
}

/**
 * 開始局面セレクター。
 * プリセット選択 + SFEN 直接入力に対応。
 * ローカル対局・オンライン対局ルーム作成ダイアログで共用する。
 */
export function PositionPresetSelector({
    value,
    onChange,
}: PositionPresetSelectorProps): ReactElement {
    // プリセットの中に一致するものがあるかチェック
    const isPreset = POSITION_PRESETS.some((p) => p.value !== CUSTOM_VALUE && p.value === value);
    const selectValue = isPreset ? value : CUSTOM_VALUE;
    const [customSfen, setCustomSfen] = useState(isPreset ? "" : value);
    const [sfenError, setSfenError] = useState<string | null>(null);
    // 待機中の部屋では、相手が設定した別の局面が value に届く。ただし自分が前に送った局面の
    // 返信も遅れて届くので、打っている間は置き換えず、入力欄を離れたときに今の value へ合わせる。
    // 離れたときの value が、入力欄を最後にそろえた (通知した・合わせた) ものなら、打ちかけの
    // 不正な文字列を残す
    const [editing, setEditing] = useState(false);
    const [prevValue, setPrevValue] = useState(value);
    const [syncedValue, setSyncedValue] = useState(value);

    function notify(next: string): void {
        setSyncedValue(next);
        onChange(next);
    }

    // 自分の入力を通知した結果 (空白をそろえたもの) と、入力途中を表す "" では打った文字列を残す
    function syncCustomSfen(next: string): void {
        setSyncedValue(next);
        if (isPreset || next === "" || next === normalizeSfenSpacing(customSfen)) return;
        setCustomSfen(next);
        setSfenError(null);
    }

    if (value !== prevValue) {
        setPrevValue(value);
        // プリセットに切り替わると入力欄は blur を出さずに消えるので、編集中の印もここで外す
        if (isPreset) setEditing(false);
        else if (!editing) syncCustomSfen(value);
    }
    const selectedPreset = POSITION_PRESETS.find((p) => p.value === selectValue);

    function handleSelectChange(selected: string): void {
        // 戻ったときに入力欄に残っている不正な文字列は通知しないので、その理由を出し直す
        setSfenError(
            selected === CUSTOM_VALUE && customSfen !== "" ? validateCustomSfen(customSfen) : null,
        );
        if (selected === CUSTOM_VALUE) {
            // カスタム入力モードへ切り替え（現在のカスタム SFEN を維持）
            // 入力欄が空や入力途中のままなら、局面としては通知しない
            notify(validateCustomSfen(customSfen) ? "" : normalizeSfenSpacing(customSfen));
        } else {
            notify(selected);
        }
    }

    function handleCustomInput(input: string): void {
        setCustomSfen(input);
        const error = validateCustomSfen(input);
        setSfenError(error);
        if (!error) {
            notify(normalizeSfenSpacing(input));
        }
    }

    return (
        <div className="flex flex-col gap-2">
            <Select value={selectValue} onValueChange={handleSelectChange}>
                <SelectTrigger aria-label="開始局面を選択">
                    <SelectValue placeholder="開始局面を選択..." />
                </SelectTrigger>
                <SelectContent>
                    {POSITION_PRESETS.map((preset) => (
                        <SelectItem key={preset.value} value={preset.value}>
                            {preset.label}
                        </SelectItem>
                    ))}
                </SelectContent>
            </Select>
            {selectedPreset?.description && (
                <p className="text-xs text-muted-foreground">{selectedPreset.description}</p>
            )}
            {selectValue === CUSTOM_VALUE && (
                <>
                    <Input
                        placeholder="例: lnsgkgsnl/1r5b1/ppppppppp/9/9/9/PPPPPPPPP/1B5R1/LNSGKGSNL b - 1"
                        value={customSfen}
                        onChange={(e) => handleCustomInput(e.target.value)}
                        onFocus={() => setEditing(true)}
                        onBlur={() => {
                            setEditing(false);
                            if (value !== syncedValue) syncCustomSfen(value);
                        }}
                        className={`font-mono text-xs ${sfenError ? "border-destructive focus-visible:ring-destructive" : ""}`}
                        aria-invalid={sfenError !== null}
                    />
                    {sfenError && <p className="text-xs text-destructive">{sfenError}</p>}
                </>
            )}
        </div>
    );
}
