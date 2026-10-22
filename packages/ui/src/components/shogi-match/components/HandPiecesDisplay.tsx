import type { PieceType, Player, PositionState } from "@shogi/app-core";
import { cn } from "@shogi/design-system";
import type { ReactElement } from "react";
import { getPieceImagePath, PIECE_CAP, PIECE_LABELS } from "../utils/constants";
import { PlayerIcon } from "./PlayerIcon";

const HAND_ORDER: PieceType[] = ["R", "B", "G", "S", "N", "L", "P"];

/** サイズ設定: compact=編集用(小), edit=編集用(中), medium=モバイル対局用, normal=PC用 */
type HandPieceSize = "compact" | "edit" | "medium" | "normal";

/** 個数の文字は盤のマスに合わせて大きくする（小さい盤でも 12px は保つ）。 */
const CELL_BADGE_SIZE = "text-[max(12px,calc(var(--shogi-cell-size,40px)*0.26))]";

const SIZE_CONFIG = {
    compact: {
        imageSize: "h-6 w-6",
        badgeSize: "text-[11px]",
        badgePos: "-top-0.5 -right-0.5",
        badgePosRotated: "-left-0.5 -top-0.5 rotate-180",
    },
    edit: {
        // 7 種の駒と ± を 1 行に並べる。盤のマスに合わせつつ、欄の幅（cqw）から 1 駒ぶんを割って上限にする
        // （欄が狭いときに、駒の画像だけが押しつぶされないように）。狭い欄では ± を駒の下に置く。
        // ± を横に置く広い欄では、± の幅（約 17px）も 1 駒ぶんから引く。
        imageSize:
            "h-[min(calc(var(--shogi-cell-size,40px)*0.8),calc((100cqw-32px)/7-8px))] w-[min(calc(var(--shogi-cell-size,40px)*0.8),calc((100cqw-32px)/7-8px))] @min-[27rem]:h-[min(calc(var(--shogi-cell-size,40px)*0.8),calc((100cqw-32px)/7-25px))] @min-[27rem]:w-[min(calc(var(--shogi-cell-size,40px)*0.8),calc((100cqw-32px)/7-25px))] shrink-0",
        // 狭い欄では駒が 25px 前後まで小さくなるので、札は小さめにして駒を隠しすぎない。
        badgeSize: "text-[10px]",
        badgePos: "-top-1 -right-1.5",
        badgePosRotated: "-left-1.5 -top-1 rotate-180",
    },
    medium: {
        // 盤のマスに合わせる（マスが大きい画面で、持ち駒だけ小さく見えないように）。
        // 既定のマス 40px で、これまでと同じ 32px 相当になる。
        imageSize:
            "h-[calc(var(--shogi-cell-size,40px)*0.8)] w-[calc(var(--shogi-cell-size,40px)*0.8)]",
        badgeSize: CELL_BADGE_SIZE,
        badgePos: "-top-1 -right-1.5",
        badgePosRotated: "-left-1.5 -top-1 rotate-180",
    },
    normal: {
        imageSize: "h-10 w-10",
        badgeSize: "text-[13px]",
        badgePos: "-top-1 -right-1",
        badgePosRotated: "-left-1 -top-1 rotate-180",
    },
} as const;

/** 盤上の駒と同じスタイルの駒表示 */
function PieceToken({
    pieceType,
    owner,
    count,
    flipBoard = false,
    size = "normal",
    showCount = true,
    inlineCount = false,
}: {
    pieceType: PieceType;
    owner: Player;
    count: number;
    flipBoard?: boolean;
    size?: HandPieceSize;
    /** 個数の札を出すか（1 枚・0 枚を出すかは呼び出し側が決める） */
    showCount?: boolean;
    /**
     * 個数を駒に重ねる札ではなく、駒の右に小さな数字で添える。小さい駒（スマホの盤の上下の段）では
     * 札が駒と同じくらいの大きさになり、駒を隠してしまうため。
     */
    inlineCount?: boolean;
}): ReactElement {
    // 盤面と同じ回転ロジック: 反転時は先手が逆さ、通常時は後手が逆さ
    const shouldRotate = flipBoard ? owner === "sente" : owner === "gote";
    const config = SIZE_CONFIG[size];
    const imagePath = getPieceImagePath(owner, pieceType);

    if (inlineCount) {
        return (
            // 行の中で先手・後手の印と高さをそろえるため、inline にしない（inline だと行の下に余白が
            // できて、駒だけが上にずれる）。
            <span className="flex items-end">
                <img
                    src={imagePath}
                    alt={`${owner === "sente" ? "先手" : "後手"}の${PIECE_LABELS[pieceType]}`}
                    className={cn(
                        config.imageSize,
                        "object-contain drop-shadow-[0_2px_4px_rgba(0,0,0,0.15)]",
                        shouldRotate && "-rotate-180",
                    )}
                    draggable={false}
                />
                {showCount && (
                    <span
                        // 個数は駒ボタンの名前で読み上げる（数字は見た目だけ）。
                        aria-hidden="true"
                        className="text-[max(10px,calc(var(--shogi-cell-size,40px)*0.3))] font-bold leading-none tabular-nums text-wafuu-sumi"
                    >
                        {count}
                    </span>
                )}
            </span>
        );
    }

    return (
        <span
            className={cn(
                "relative inline-flex items-center justify-center",
                shouldRotate && "-rotate-180",
            )}
        >
            <img
                src={imagePath}
                alt={`${owner === "sente" ? "先手" : "後手"}の${PIECE_LABELS[pieceType]}`}
                className={cn(
                    config.imageSize,
                    "object-contain drop-shadow-[0_2px_4px_rgba(0,0,0,0.15)]",
                )}
                draggable={false}
            />
            {/* 個数は読める大きさの丸い札にして、駒の先（細い側）の脇に置く。駒は先が細い五角形なので、
                広い側に置くと駒の体に重なる。正立の駒は右上、逆さの駒は見た目で右下。札の数字は常に正立。 */}
            {showCount && (
                <span
                    // 個数は駒ボタンの名前で読み上げる（札は見た目だけ）。
                    aria-hidden="true"
                    className={cn(
                        "absolute flex h-[1.4em] min-w-[1.4em] items-center justify-center rounded-full px-[0.3em] font-bold tabular-nums shadow-sm ring-1 ring-background",
                        config.badgeSize,
                        // 文字の大きさの後に置く（前に置くと cn が文字の大きさとの衝突として消す）。
                        "leading-none",
                        shouldRotate ? config.badgePosRotated : config.badgePos,
                        count > 0
                            ? "bg-wafuu-sumi text-background"
                            : "bg-muted text-muted-foreground",
                    )}
                >
                    {count}
                </span>
            )}
        </span>
    );
}

// コンテナ用のサイズ設定
const CONTAINER_SIZE_CONFIG = {
    compact: {
        piecesContainer: "flex-nowrap gap-0",
        marker: "text-sm w-4",
        buttonPadding: "p-0.5",
        adjusterButton: "h-4 w-5",
        rowMinHeight: "min-h-[28px]",
    },
    edit: {
        piecesContainer: "min-w-0 flex-1 flex-nowrap justify-around gap-0",
        marker: "text-base w-5",
        buttonPadding: "p-0.5",
        adjusterButton: "h-4 w-4",
        rowMinHeight: "min-h-[32px]",
    },
    medium: {
        piecesContainer: "flex-nowrap gap-0.5",
        marker: "text-base w-5",
        buttonPadding: "p-0.5",
        adjusterButton: "h-4 w-5",
        rowMinHeight: "min-h-[34px]",
    },
    normal: {
        piecesContainer: "flex-wrap gap-0.5",
        marker: "text-xl w-7",
        buttonPadding: "p-0.5",
        adjusterButton: "h-4 w-5",
        rowMinHeight: "",
    },
} as const;

interface HandPiecesDisplayProps {
    /** 持ち駒を持つプレイヤー */
    owner: Player;
    /** 持ち駒の状態 */
    hand: PositionState["hands"][Player];
    /** 選択中の持ち駒 */
    selectedPiece: PieceType | null;
    /** クリック可能かどうか */
    isActive: boolean;
    /** 持ち駒クリック時のコールバック */
    onHandSelect: (piece: PieceType) => void;
    /** DnD 用 PointerDown ハンドラ（編集モード時） */
    onPiecePointerDown?: (owner: Player, pieceType: PieceType, e: React.PointerEvent) => void;
    /** 編集モードかどうか */
    isEditMode?: boolean;
    /** 対局中かどうか（対局中のみ持ち駒がない駒を非表示にする） */
    isMatchRunning?: boolean;
    /** 0枚の駒を非表示にするか（編集モード時は常に表示） */
    hideEmptyPieces?: boolean;
    /** 持ち駒を増やす（編集モード用） */
    onIncrement?: (piece: PieceType) => void;
    /** 持ち駒を減らす（編集モード用） */
    onDecrement?: (piece: PieceType) => void;
    /** 盤面反転状態 */
    flipBoard?: boolean;
    /** サイズ: compact=編集用(小), edit=編集用(中), medium=モバイル対局用, normal=PC用 */
    size?: HandPieceSize;
    /** AIプレイヤーかどうか */
    isAI?: boolean;
    /** 駒を縦に並べる（盤の横に置く駒台）。compact 系のサイズで使う */
    vertical?: boolean;
    /** 縦の駒台で、駒を上（start）と下（end）のどちらに寄せるか。`vertical` のときだけ効く */
    verticalAlign?: "start" | "end";
}

export function HandPiecesDisplay({
    owner,
    hand,
    selectedPiece,
    isActive,
    onHandSelect,
    onPiecePointerDown,
    isEditMode = false,
    isMatchRunning = false,
    hideEmptyPieces,
    onIncrement,
    onDecrement,
    flipBoard = false,
    size = "normal",
    isAI = false,
    vertical = false,
    verticalAlign = "start",
}: HandPiecesDisplayProps): ReactElement | null {
    const containerConfig = CONTAINER_SIZE_CONFIG[size];
    const isCompactLayout = vertical || size === "compact" || size === "edit" || size === "medium";
    // 局面編集の横長の駒台は、欄が狭いときだけ ± を駒の下に置く（横に置くと 7 種が 1 行に入らず、駒が小さくなる）。
    // 縦の駒台は幅に余裕があるので、± は駒の横に置き、駒は盤のマスに合わせる。
    const isEditLayout = size === "edit" && !vertical;
    // 縦の駒台は、マスに合わせた大きさ（medium）で描く。normal の横並び用の幅確保は縦では使えない。
    const tokenSize = vertical && (size === "edit" || size === "normal") ? "medium" : size;
    // スマホの盤の上下の段（横並びの小さい駒）では、個数を駒の右に添える（札を重ねると駒が隠れる）。
    // 局面編集では 0 と 1 も見分けるので、駒の脇の札のまま。
    const inlineCount =
        !vertical && !isEditMode && (tokenSize === "medium" || tokenSize === "compact");
    // PlayerIcon用のサイズマッピング。盤の横の縦の駒台は幅に余裕があるので、先後の印をはっきり見せる。
    const iconSize = vertical
        ? "lg"
        : size === "compact"
          ? "xs"
          : size === "medium" || size === "edit"
            ? "sm"
            : "lg";
    const shouldHideEmptyPieces = hideEmptyPieces ?? (isMatchRunning && !isEditMode);
    const allPiecesEmpty = HAND_ORDER.every((p) => (hand[p] ?? 0) === 0);

    // compact/medium レイアウトでは全駒0なら行ごと非表示（モバイルはスペースが限られるため）
    // 縦の駒台は枠を固定で見せるので、空でも外さない。
    if (shouldHideEmptyPieces && allPiecesEmpty && isCompactLayout && !vertical) {
        return null;
    }

    return (
        <div
            className={cn(
                "rounded-md border border-border/50 bg-muted/30",
                vertical
                    ? cn(
                          "flex h-full w-full flex-col items-center gap-1 px-0.5 py-1",
                          verticalAlign === "end" ? "justify-end" : "justify-start",
                      )
                    : cn(
                          "flex items-center justify-start w-full px-1",
                          containerConfig.rowMinHeight,
                      ),
                // 駒の大きさを欄の幅から決めるので、欄を幅の基準（container）にする。
                isEditLayout && "[container-type:inline-size]",
            )}
        >
            {/* 先手/後手マーカー - 固定幅で左端に配置 */}
            <PlayerIcon
                side={owner}
                isAI={isAI}
                size={iconSize}
                className="shrink-0"
                enableZoom={isAI}
            />
            {/* 持ち駒コンテナ - 駒だけが詰まる */}
            <div
                className={cn(
                    "relative flex",
                    vertical
                        ? "flex-col items-start gap-1"
                        : cn("items-center", containerConfig.piecesContainer),
                )}
            >
                {/* 横幅/高さ確保用のダミー要素 */}
                {!isCompactLayout ? (
                    // PC版: 全7種の駒＋±ボタンで横幅を確保
                    <div className="invisible flex items-center gap-0.5" aria-hidden="true">
                        {HAND_ORDER.map((piece) => (
                            <div key={piece} className="flex items-center gap-px">
                                <div
                                    className={cn(
                                        "border-2 border-transparent rounded-lg",
                                        containerConfig.buttonPadding,
                                    )}
                                >
                                    <PieceToken
                                        pieceType={piece}
                                        owner={owner}
                                        count={0}
                                        flipBoard={flipBoard}
                                        size={size}
                                    />
                                </div>
                                {/* ±ボタン分のスペース */}
                                <div className="flex flex-col gap-px">
                                    <div className="h-4 w-5" />
                                    <div className="h-4 w-5" />
                                </div>
                            </div>
                        ))}
                    </div>
                ) : null}

                {/* 実際の駒（PC版は absolute で左寄せ、モバイル版は通常フロー） */}
                <div
                    data-testid="hand-pieces-actual"
                    className={
                        !isCompactLayout
                            ? "absolute left-0 top-0 flex items-center gap-0.5 h-full"
                            : "contents"
                    }
                >
                    {HAND_ORDER.map((piece) => {
                        const count = hand[piece] ?? 0;

                        // 選択の枠は、選べる側（手番側）の駒台にだけ出す。両方の駒台に同じ
                        // 選択を渡されても、相手の駒台の同じ種類の駒は光らせない。
                        const selected = isActive && selectedPiece === piece;
                        // 編集モード時は0個でもドラッグ可能（ストックとして機能）
                        const canDrag = (count > 0 || isEditMode) && Boolean(onPiecePointerDown);
                        const canSelect = count > 0 && isActive;
                        const isDisabled = !canDrag && !canSelect && !isEditMode;
                        const maxCount = PIECE_CAP[piece];

                        // 対局中は持っている駒だけ詰めて表示
                        // 対局前（!isMatchRunning）は編集のために全ての駒を表示する
                        if (shouldHideEmptyPieces && count === 0) {
                            return null;
                        }

                        return (
                            <div
                                key={`${owner}-${piece}`}
                                className={cn(
                                    "flex items-center",
                                    isEditLayout
                                        ? // 欄が広い（駒台が盤と同じく広い）ときは、± を駒の横に戻して駒台を低く保つ。
                                          "flex-col gap-0.5 py-0.5 @min-[27rem]:flex-row @min-[27rem]:gap-px @min-[27rem]:py-0"
                                        : vertical
                                          ? "gap-0.5"
                                          : "gap-px",
                                )}
                            >
                                {/* 駒ボタン */}
                                <button
                                    type="button"
                                    aria-label={`${owner === "sente" ? "先手" : "後手"}の${PIECE_LABELS[piece]} ${count}枚`}
                                    onPointerDown={(e) => {
                                        if (canDrag && onPiecePointerDown) {
                                            // タッチ時のテキスト選択・長押しメニューを防止
                                            e.preventDefault();
                                            onPiecePointerDown(owner, piece, e);
                                        }
                                    }}
                                    onClick={(e) => {
                                        if (!canSelect) {
                                            e.preventDefault();
                                            return;
                                        }
                                        onHandSelect(piece);
                                    }}
                                    disabled={isDisabled}
                                    className={cn(
                                        "relative rounded-lg border-2 transition-all",
                                        // タッチ選択・長押しメニュー防止
                                        "select-none [-webkit-touch-callout:none]",
                                        // 編集モード（ドラッグ可能）時はスクロールも防止
                                        canDrag ? "touch-none" : "touch-manipulation",
                                        containerConfig.buttonPadding,
                                        selected
                                            ? "border-wafuu-shu bg-wafuu-kin/20"
                                            : "border-transparent",
                                        count > 0 || isEditMode ? "opacity-100" : "opacity-40",
                                        (canDrag || canSelect) &&
                                            "cursor-pointer hover:bg-wafuu-kin/10",
                                    )}
                                >
                                    <PieceToken
                                        pieceType={piece}
                                        owner={owner}
                                        count={count}
                                        flipBoard={flipBoard}
                                        size={tokenSize}
                                        inlineCount={inlineCount}
                                        // 1 枚なら数は要らない。ただし編集中や、持っていない駒も並べる画面では、
                                        // 0 と 1 を見分けられるよう数を出す。
                                        showCount={
                                            isEditMode || count > 1 || !shouldHideEmptyPieces
                                        }
                                    />
                                </button>

                                {/* ±ボタン（縦並び）- 編集モードでなくてもスペースを確保、compact/mediumモード時は編集モードのみ表示 */}
                                {(!isCompactLayout || isEditMode) && (
                                    <div
                                        className={cn(
                                            // 編集の駒台では横に「− +」の順で並べる（減らすを左に置く）。
                                            isEditLayout
                                                ? "flex flex-row-reverse @min-[27rem]:flex-col @min-[27rem]:gap-px"
                                                : vertical
                                                  ? "flex flex-row-reverse"
                                                  : "flex flex-col gap-px",
                                            isEditMode ? "visible" : "invisible",
                                        )}
                                    >
                                        <button
                                            type="button"
                                            onClick={() => onIncrement?.(piece)}
                                            disabled={!isEditMode || count >= maxCount}
                                            aria-label={`${PIECE_LABELS[piece]}を増やす`}
                                            className={cn(
                                                "flex items-center justify-center border border-border text-xs font-bold leading-none",
                                                isEditLayout
                                                    ? "rounded-r @min-[27rem]:rounded-none @min-[27rem]:rounded-t @min-[27rem]:border-b-0"
                                                    : vertical
                                                      ? "rounded-r"
                                                      : "rounded-t border-b-0",
                                                containerConfig.adjusterButton,
                                                count < maxCount
                                                    ? "cursor-pointer bg-wafuu-washi text-wafuu-sumi opacity-100"
                                                    : "cursor-not-allowed bg-muted text-muted-foreground opacity-40",
                                            )}
                                        >
                                            +
                                        </button>
                                        <button
                                            type="button"
                                            onClick={() => onDecrement?.(piece)}
                                            disabled={!isEditMode || count <= 0}
                                            aria-label={`${PIECE_LABELS[piece]}を減らす`}
                                            className={cn(
                                                "flex items-center justify-center border border-border text-xs font-bold leading-none",
                                                isEditLayout
                                                    ? "rounded-l border-r-0 @min-[27rem]:rounded-none @min-[27rem]:rounded-b @min-[27rem]:border-r"
                                                    : vertical
                                                      ? "rounded-l border-r-0"
                                                      : "rounded-b",
                                                containerConfig.adjusterButton,
                                                count > 0
                                                    ? "cursor-pointer bg-wafuu-washi text-wafuu-sumi opacity-100"
                                                    : "cursor-not-allowed bg-muted text-muted-foreground opacity-40",
                                            )}
                                        >
                                            −
                                        </button>
                                    </div>
                                )}
                            </div>
                        );
                    })}
                </div>
            </div>
        </div>
    );
}
