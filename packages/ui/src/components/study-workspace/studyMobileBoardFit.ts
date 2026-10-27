// スマートフォンの盤の寸法（マスを c px とする）。持ち駒は盤の左右に縦に置き、盤は幅 9c + 33px・
// 高さ 9c + 44px（枠と段ラベル）、左右の駒台は幅 0.8c + 20px で間が 8px ずつ（全体の幅 10.6c + 89px）。
// 駒台は 7 種類の駒（1 つ 0.8c + 8px、間 4px）と先後の印・余白（70px）で 5.6c + 126px あり、小さい
// マスでは盤より高い。持ち駒が増えても移動の行が動かないよう、高い方を常に確保する。
// 盤はその下に MOBILE_LOWER_MIN_HEIGHT を残して、幅に収まるいちばん大きいマスで描く。
const MOBILE_MAX_CELL_SIZE = 52;
const MOBILE_MIN_CELL_SIZE = 20;
// 盤の下（移動の行のさらに下）に残す高さ。盤の表示では棋譜の帯とグラフ、一覧の表示では一覧を置く。
const MOBILE_LOWER_MIN_HEIGHT = 150;
const MOBILE_LOWER_SHORT_HEIGHT = 48;
// コメント欄の高さの下限（入力欄と、別の画面の変更との突き合わせの操作が収まる高さ）。
const MOBILE_COMMENT_MIN_HEIGHT = 200;
// 局面の移動の行の高さと、行どうしの間。
const MOBILE_NAV_HEIGHT = 40;
const MOBILE_ROW_GAP = 6;
// 下限のマスでも入らないときの縮小の下限。これより縮めると駒が読めないので、下の欄を削って盤を残す。
const MOBILE_MIN_SCALE = 0.6;

const mobileBoardBlockHeight = (cell: number): number =>
    Math.max(cell * 9 + 44, Math.ceil(cell * 5.6 + 126));

/**
 * 幅 `width`・高さ `height` の表示の場所に置く、盤のマスの大きさ・縮小率・盤の高さ。下限のマスでも
 * 入らない低い画面では、下限のマスで描いて見た目だけ縮める（はみ出して切れるより、小さくても全体が
 * 見える方がよい）。縮小の下限でも入らないときは、表示の場所を縦に送って見せる。
 */
export const fitMobileBoard = (
    width: number,
    height: number,
): { cellSize: number; scale: number; boardHeight: number } => {
    const widthCell = Math.min(MOBILE_MAX_CELL_SIZE, Math.floor((width - 89) / 10.6));
    // 低い画面では、盤を縮める前に下の欄を棋譜の帯 1 行ぶんまで削る。
    for (const lower of [MOBILE_LOWER_MIN_HEIGHT, MOBILE_LOWER_SHORT_HEIGHT]) {
        const space = height - MOBILE_NAV_HEIGHT - 2 * MOBILE_ROW_GAP - lower;
        for (let cell = widthCell; cell >= MOBILE_MIN_CELL_SIZE; cell--) {
            const boardHeight = mobileBoardBlockHeight(cell);
            if (boardHeight <= space) return { cellSize: cell, scale: 1, boardHeight };
        }
    }
    const boardSpace = height - MOBILE_NAV_HEIGHT - 2 * MOBILE_ROW_GAP - MOBILE_LOWER_SHORT_HEIGHT;
    const fullHeight = mobileBoardBlockHeight(MOBILE_MIN_CELL_SIZE);
    const scale = Math.max(
        MOBILE_MIN_SCALE,
        Math.min(1, boardSpace / fullHeight, width / (MOBILE_MIN_CELL_SIZE * 10.6 + 89)),
    );
    return { cellSize: MOBILE_MIN_CELL_SIZE, scale, boardHeight: fullHeight * scale };
};

/**
 * 移動の行の下に重ねるコメント欄の高さの上限。盤の下の場所の高さまでにするが、低すぎるときは
 * 下限の高さで出す（表示の場所ごと縦に送る）。
 */
export const mobileCommentMaxHeight = (panelHeight: number, boardHeight: number): number =>
    Math.max(
        MOBILE_COMMENT_MIN_HEIGHT,
        panelHeight - boardHeight - MOBILE_NAV_HEIGHT - 2 * MOBILE_ROW_GAP,
    );
