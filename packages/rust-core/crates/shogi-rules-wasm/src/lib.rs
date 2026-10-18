//! 開始局面と棋譜 (USI) を再生し、各手の合法性と最終局面の状態を判定する。
//!
//! サーバーがクライアントの申告 (指し手が合法か・指した後の SFEN・詰み・千日手) を
//! 自前で確かめるための薄い層で、探索や評価関数は含めない。

mod bindings;

use rshogi_core::movegen::{
    ExtMoveBuffer, GenType, MoveList, generate_legal_all_with_pass, generate_with_type,
};
use rshogi_core::position::{Position, SFEN_HIRATE};
use rshogi_core::types::{Color, Hand, Move, Piece, PieceType, Square};

/// rshogi-core はパス権を 1 手番あたり 4 bit で持つため、これを超える初期値は表せない。
pub const MAX_PASS_RIGHTS: u32 = 15;

/// 反則の種類。ログで原因を見分けるためのもので、勝敗の裁定には使わない。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum IllegalReason {
    InvalidUsi,
    NoPassRights,
    PassInCheck,
    NoPieceInHand,
    Nifu,
    DeadPiece,
    Uchifuzume,
    KingInCheck,
    Illegal,
}

impl IllegalReason {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::InvalidUsi => "invalid_usi",
            Self::NoPassRights => "no_pass_rights",
            Self::PassInCheck => "pass_in_check",
            Self::NoPieceInHand => "no_piece_in_hand",
            Self::Nifu => "nifu",
            Self::DeadPiece => "dead_piece",
            Self::Uchifuzume => "uchifuzume",
            Self::KingInCheck => "king_in_check",
            Self::Illegal => "illegal",
        }
    }
}

/// 最終局面の千日手判定。連続王手の千日手は王手を掛け続けた側の負け。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Repetition {
    None,
    Sennichite,
    OuteSennichiteLoseBlack,
    OuteSennichiteLoseWhite,
}

impl Repetition {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::None => "none",
            Self::Sennichite => "sennichite",
            Self::OuteSennichiteLoseBlack => "oute_sennichite_lose_b",
            Self::OuteSennichiteLoseWhite => "oute_sennichite_lose_w",
        }
    }
}

/// 反則手の位置 (0 始まりの手の添字) と種類。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct IllegalMove {
    pub index: usize,
    pub reason: IllegalReason,
}

/// 棋譜を再生した結果。反則手があればその直前の局面で止まる。
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Judgement {
    pub illegal: Option<IllegalMove>,
    pub final_sfen: String,
    pub in_check: bool,
    pub checkmate: bool,
    pub repetition: Repetition,
}

/// 棋譜以前の入力 (開始局面・パス権) が判定できない形のときのエラー。
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum InputError {
    Sfen(String),
    PassRightsOutOfRange(u32),
    KingCount,
}

impl std::fmt::Display for InputError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Sfen(message) => write!(f, "invalid start sfen: {message}"),
            Self::PassRightsOutOfRange(count) => {
                write!(
                    f,
                    "pass rights {count} exceed the supported maximum {MAX_PASS_RIGHTS}"
                )
            }
            Self::KingCount => write!(f, "each side must have exactly one king"),
        }
    }
}

impl std::error::Error for InputError {}

/// `start_sfen` から `moves` を順に適用し、反則手・最終局面・王手・詰み・千日手を判定する。
///
/// 千日手は「盤・持ち駒・手番」が同じ局面の 4 回目で成立とし、パス権の残り回数は区別しない。
/// 判定するのは最終局面だけで、途中で 4 回目に達した後の手も通常どおり再生する。
pub fn judge_game<S: AsRef<str>>(
    start_sfen: &str,
    pass_rights: Option<(u32, u32)>,
    moves: &[S],
) -> Result<Judgement, InputError> {
    let mut pos = setup_position(start_sfen, pass_rights)?;
    let mut history = History::new(&pos);
    let mut illegal = None;
    for (index, usi) in moves.iter().enumerate() {
        match find_legal_move(&pos, usi.as_ref()) {
            Ok(mv) => {
                let gives_check = pos.gives_check(mv);
                pos.do_move(mv, gives_check);
                history.push(&pos);
            }
            Err(reason) => {
                illegal = Some(IllegalMove { index, reason });
                break;
            }
        }
    }
    let in_check = pos.in_check();
    let mut legal = MoveList::new();
    generate_legal_all_with_pass(&pos, &mut legal);
    Ok(Judgement {
        illegal,
        final_sfen: pos.to_sfen(),
        in_check,
        checkmate: in_check && legal.is_empty(),
        repetition: history.repetition(),
    })
}

/// SFEN を読み直して rshogi の表記に揃える。持ち駒の並び順など表記揺れを吸収して比較するため。
pub fn canonical_sfen(sfen: &str) -> Result<String, InputError> {
    parse_sfen(sfen).map(|pos| pos.to_sfen())
}

fn parse_sfen(sfen: &str) -> Result<Position, InputError> {
    let mut pos = Position::new();
    let sfen = if sfen.trim() == "startpos" {
        SFEN_HIRATE
    } else {
        sfen
    };
    pos.set_sfen(sfen)
        .map_err(|e| InputError::Sfen(e.to_string()))?;
    Ok(pos)
}

fn setup_position(sfen: &str, pass_rights: Option<(u32, u32)>) -> Result<Position, InputError> {
    let mut pos = parse_sfen(sfen)?;
    // 玉が無い・片側に 2 枚ある局面では王手や詰みの判定が意味を持たない
    for color in [Color::Black, Color::White] {
        let king = Piece::new(color, PieceType::King);
        if Square::all().filter(|&sq| pos.piece_on(sq) == king).count() != 1 {
            return Err(InputError::KingCount);
        }
    }
    if let Some((black, white)) = pass_rights {
        let to_u8 = |count: u32| {
            u8::try_from(count)
                .ok()
                .filter(|&c| u32::from(c) <= MAX_PASS_RIGHTS)
                .ok_or(InputError::PassRightsOutOfRange(count))
        };
        pos.enable_pass_rights(to_u8(black)?, to_u8(white)?);
    }
    Ok(pos)
}

fn find_legal_move(pos: &Position, usi: &str) -> Result<Move, IllegalReason> {
    let parsed = Move::from_usi_strict(usi).ok_or(IllegalReason::InvalidUsi)?;
    let mut legal = MoveList::new();
    generate_legal_all_with_pass(pos, &mut legal);
    legal
        .iter()
        .copied()
        .find(|mv| mv.raw() == parsed.raw())
        .ok_or_else(|| classify_illegal(pos, parsed))
}

// 反則と分かった手だけを対象にするので、速さより原因の切り分けやすさを優先する
fn classify_illegal(pos: &Position, mv: Move) -> IllegalReason {
    let us = pos.side_to_move();
    if mv.is_pass() {
        return if pos.is_pass_rights_enabled() && pos.pass_rights(us) > 0 {
            IllegalReason::PassInCheck
        } else {
            IllegalReason::NoPassRights
        };
    }
    if mv.is_drop() {
        let pt = mv.drop_piece_type();
        return if pos.hand(us).count(pt) == 0 {
            IllegalReason::NoPieceInHand
        } else if pt == PieceType::Pawn && file_has_own_pawn(pos, us, mv.to()) {
            IllegalReason::Nifu
        } else if is_dead_square(pt, us, mv.to()) {
            IllegalReason::DeadPiece
        } else if pos.piece_on(mv.to()).is_some() {
            IllegalReason::Illegal
        } else if pt == PieceType::Pawn && !pos.is_legal(mv) {
            IllegalReason::Uchifuzume
        } else {
            IllegalReason::KingInCheck
        };
    }
    if !mv.is_promote() && is_dead_square(pos.piece_on(mv.from()).piece_type(), us, mv.to()) {
        IllegalReason::DeadPiece
    } else if is_pseudo_legal_ignoring_check(pos, mv) {
        IllegalReason::KingInCheck
    } else {
        IllegalReason::Illegal
    }
}

// 王手の有無を無視した指し手生成に含まれるなら、駒の動きとしては正しく自玉の安全だけが欠けている
fn is_pseudo_legal_ignoring_check(pos: &Position, mv: Move) -> bool {
    let mut buffer = ExtMoveBuffer::new();
    generate_with_type(pos, GenType::NonEvasionsAll, &mut buffer, None);
    buffer.iter().any(|ext| ext.mv.raw() == mv.raw())
}

fn file_has_own_pawn(pos: &Position, us: Color, to: Square) -> bool {
    let pawn = Piece::new(us, PieceType::Pawn);
    Square::all().any(|sq| sq.file() == to.file() && pos.piece_on(sq) == pawn)
}

fn is_dead_square(pt: PieceType, us: Color, to: Square) -> bool {
    let rank_from_enemy_side = if us == Color::Black {
        to.rank().index()
    } else {
        8 - to.rank().index()
    };
    match pt {
        PieceType::Pawn | PieceType::Lance => rank_from_enemy_side == 0,
        PieceType::Knight => rank_from_enemy_side <= 1,
        _ => false,
    }
}

// rshogi-core の千日手判定はパス権の残り回数を局面の同一性に含めるため、
// パス権を除いた盤・持ち駒・手番を鍵にして全履歴を数える
#[derive(PartialEq, Eq)]
struct PositionKey {
    board: [Piece; Square::NUM],
    hands: [Hand; 2],
    side_to_move: Color,
}

impl PositionKey {
    fn of(pos: &Position) -> Self {
        let mut board = [Piece::NONE; Square::NUM];
        for sq in Square::all() {
            board[sq.index()] = pos.piece_on(sq);
        }
        Self {
            board,
            hands: [pos.hand(Color::Black), pos.hand(Color::White)],
            side_to_move: pos.side_to_move(),
        }
    }
}

struct History {
    keys: Vec<PositionKey>,
    // checks[i] は局面 i に至る手が王手だったか (i = 0 は開始局面で未使用)
    checks: Vec<bool>,
}

impl History {
    fn new(start: &Position) -> Self {
        Self {
            keys: vec![PositionKey::of(start)],
            checks: vec![false],
        }
    }

    fn push(&mut self, pos: &Position) {
        self.keys.push(PositionKey::of(pos));
        self.checks.push(pos.in_check());
    }

    fn repetition(&self) -> Repetition {
        let last = self.keys.len() - 1;
        let current = &self.keys[last];
        let Some(first_of_four) = (0..=last)
            .rev()
            .filter(|&i| &self.keys[i] == current)
            .nth(3)
        else {
            return Repetition::None;
        };
        let window = first_of_four + 1..=last;
        // 局面 i に至る手を指したのは、局面 i で手番でない側
        let checked_throughout = |color: Color| {
            window
                .clone()
                .filter(|&i| self.keys[i].side_to_move != color)
                .all(|i| self.checks[i])
        };
        if checked_throughout(Color::Black) {
            Repetition::OuteSennichiteLoseBlack
        } else if checked_throughout(Color::White) {
            Repetition::OuteSennichiteLoseWhite
        } else {
            Repetition::Sennichite
        }
    }
}
