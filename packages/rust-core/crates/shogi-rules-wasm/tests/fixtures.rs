use serde_json::Value;
use shogi_rules_wasm::{InputError, Judgement, MAX_MOVES, judge_game};

fn load_cases() -> Vec<Value> {
    let path = concat!(env!("CARGO_MANIFEST_DIR"), "/fixtures/rules-fixtures.json");
    let text = std::fs::read_to_string(path).expect("fixture file should be readable");
    let root: Value = serde_json::from_str(&text).expect("fixture file should be valid JSON");
    root["cases"]
        .as_array()
        .expect("cases should be an array")
        .clone()
}

fn pass_rights(case: &Value) -> Option<(u32, u32)> {
    let rights = case.get("passRights").filter(|v| !v.is_null())?;
    let count = |key: &str| {
        rights[key]
            .as_u64()
            .expect("pass rights should be integers") as u32
    };
    Some((count("b"), count("w")))
}

fn as_json(judgement: &Judgement) -> Value {
    let mut out = serde_json::json!({
        "ok": judgement.illegal.is_none(),
        "finalSfen": judgement.final_sfen,
        "inCheck": judgement.in_check,
        "checkmate": judgement.checkmate,
        "repetition": judgement.repetition.as_str(),
    });
    if let Some(illegal) = judgement.illegal {
        out["illegalIndex"] = illegal.index.into();
        out["reason"] = illegal.reason.as_str().into();
    }
    out
}

#[test]
fn fixture_cases_match_expected_judgement() {
    let cases = load_cases();
    assert!(!cases.is_empty());
    for case in &cases {
        let name = case["name"].as_str().expect("case should have a name");
        let start_sfen = case["startSfen"]
            .as_str()
            .expect("startSfen should be a string");
        let moves: Vec<&str> = case["moves"]
            .as_array()
            .expect("moves should be an array")
            .iter()
            .map(|mv| mv.as_str().expect("moves should be strings"))
            .collect();
        let result = judge_game(start_sfen, pass_rights(case), &moves);
        if case.get("expectedError").and_then(Value::as_bool) == Some(true) {
            assert!(
                result.is_err(),
                "{name}: expected an input error, got {result:?}"
            );
            continue;
        }
        let actual = as_json(&result.unwrap_or_else(|e| panic!("{name}: unexpected error {e}")));
        let expected = case["expected"]
            .as_object()
            .expect("expected should be an object");
        for (key, value) in expected {
            assert_eq!(
                &actual[key], value,
                "{name}: {key} differs (actual {actual})"
            );
        }
        if expected["ok"] == Value::Bool(true) {
            assert!(
                actual.get("illegalIndex").is_none(),
                "{name}: unexpected illegal move {actual}"
            );
        }
    }
}

#[test]
fn too_many_moves_is_an_input_error_without_replaying() {
    let moves = vec!["7g7f"; MAX_MOVES + 1];
    assert_eq!(
        judge_game("startpos", None, &moves).unwrap_err(),
        InputError::TooManyMoves(MAX_MOVES + 1)
    );
}
