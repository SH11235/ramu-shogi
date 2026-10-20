use js_sys::{Array, Object, Reflect};
use wasm_bindgen::prelude::*;

use crate::{InputError, Judgement};

#[wasm_bindgen(typescript_custom_section)]
const TS_TYPES: &str = r#"
export type RulesInput = {
    startSfen: string;
    passRights: { b: number; w: number } | null;
    moves: string[];
};
export type IllegalReason =
    | "invalid_usi"
    | "no_pass_rights"
    | "pass_in_check"
    | "no_piece_in_hand"
    | "nifu"
    | "dead_piece"
    | "uchifuzume"
    | "king_in_check"
    | "illegal";
export type Repetition = "none" | "sennichite" | "oute_sennichite_lose_b" | "oute_sennichite_lose_w";
export type RulesJudgement = {
    ok: boolean;
    illegalIndex?: number;
    reason?: IllegalReason;
    finalSfen: string;
    inCheck: boolean;
    checkmate: boolean;
    repetition: Repetition;
};
"#;

/// 開始局面から棋譜を再生して判定する。入力の形が不正なとき (SFEN・パス権・玉の数) は例外を投げる。
#[wasm_bindgen(js_name = judgeGame, unchecked_return_type = "RulesJudgement")]
pub fn judge_game_js(
    #[wasm_bindgen(unchecked_param_type = "RulesInput")] input: JsValue,
) -> Result<JsValue, JsError> {
    let start_sfen = get(&input, "startSfen")?
        .as_string()
        .ok_or_else(|| JsError::new("startSfen must be a string"))?;
    let pass_rights_value = get(&input, "passRights")?;
    let pass_rights = if pass_rights_value.is_null() || pass_rights_value.is_undefined() {
        None
    } else {
        Some((
            pass_count(&pass_rights_value, "b")?,
            pass_count(&pass_rights_value, "w")?,
        ))
    };
    let moves_value = get(&input, "moves")?;
    if !Array::is_array(&moves_value) {
        return Err(JsError::new("moves must be an array"));
    }
    let moves = Array::from(&moves_value)
        .iter()
        .map(|mv| {
            mv.as_string()
                .ok_or_else(|| JsError::new("moves must be strings"))
        })
        .collect::<Result<Vec<_>, _>>()?;
    let judgement = crate::judge_game(&start_sfen, pass_rights, &moves).map_err(input_error)?;
    to_js(&judgement)
}

/// SFEN を rshogi の表記に揃えて返す。読めない SFEN は例外を投げる。
#[wasm_bindgen(js_name = canonicalSfen)]
pub fn canonical_sfen_js(sfen: &str) -> Result<String, JsError> {
    crate::canonical_sfen(sfen).map_err(input_error)
}

fn input_error(error: InputError) -> JsError {
    JsError::new(&error.to_string())
}

fn get(target: &JsValue, key: &str) -> Result<JsValue, JsError> {
    if !target.is_object() {
        return Err(JsError::new("input must be an object"));
    }
    Reflect::get(target, &JsValue::from_str(key)).map_err(|_| JsError::new("failed to read input"))
}

fn pass_count(pass_rights: &JsValue, key: &str) -> Result<u32, JsError> {
    get(pass_rights, key)?
        .as_f64()
        .filter(|count| count.fract() == 0.0 && (0.0..=f64::from(u32::MAX)).contains(count))
        .map(|count| count as u32)
        .ok_or_else(|| JsError::new("passRights must be non-negative integers"))
}

fn to_js(judgement: &Judgement) -> Result<JsValue, JsError> {
    let out = Object::new();
    let set = |key: &str, value: JsValue| {
        Reflect::set(&out, &JsValue::from_str(key), &value)
            .map(|_| ())
            .map_err(|_| JsError::new("failed to build result"))
    };
    set("ok", JsValue::from_bool(judgement.illegal.is_none()))?;
    if let Some(illegal) = judgement.illegal {
        set("illegalIndex", JsValue::from_f64(illegal.index as f64))?;
        set("reason", JsValue::from_str(illegal.reason.as_str()))?;
    }
    set("finalSfen", JsValue::from_str(&judgement.final_sfen))?;
    set("inCheck", JsValue::from_bool(judgement.in_check))?;
    set("checkmate", JsValue::from_bool(judgement.checkmate))?;
    set(
        "repetition",
        JsValue::from_str(judgement.repetition.as_str()),
    )?;
    Ok(out.into())
}
