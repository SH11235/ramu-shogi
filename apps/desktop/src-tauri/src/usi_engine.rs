use serde::Serialize;

// ── USI Option Definition ──────────────────────────────────────────

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(tag = "type", rename_all = "lowercase")]
pub enum UsiOptionDef {
    Check {
        name: String,
        default: bool,
    },
    Spin {
        name: String,
        default: i64,
        min: i64,
        max: i64,
    },
    Combo {
        name: String,
        default: String,
        vars: Vec<String>,
    },
    String {
        name: String,
        default: String,
    },
    Filename {
        name: String,
        default: String,
    },
    Button {
        name: String,
    },
}

// ── Probe Result ───────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize)]
pub struct ProbeResult {
    pub name: String,
    pub author: String,
    pub options: Vec<UsiOptionDef>,
}

// ── Engine Event (USI → JSON) ──────────────────────────────────────

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(tag = "type", rename_all = "lowercase")]
pub enum UsiEngineEvent {
    #[serde(rename = "info")]
    Info {
        depth: Option<u32>,
        seldepth: Option<u32>,
        nodes: Option<u64>,
        nps: Option<u64>,
        #[serde(rename = "timeMs")]
        time_ms: Option<u64>,
        #[serde(rename = "scoreCp")]
        score_cp: Option<i32>,
        #[serde(rename = "scoreMate")]
        score_mate: Option<i32>,
        multipv: Option<usize>,
        pv: Option<Vec<String>>,
        hashfull: Option<u32>,
    },
    #[serde(rename = "bestmove")]
    BestMove {
        #[serde(rename = "move")]
        mv: String,
        ponder: Option<String>,
    },
    #[serde(rename = "error")]
    Error { message: String },
}

// ── Parsers ────────────────────────────────────────────────────────

/// Parse "id name ..." line. Returns the name string.
pub fn parse_id_name(line: &str) -> Option<String> {
    let rest = line.strip_prefix("id name ")?;
    let name = rest.trim();
    if name.is_empty() {
        return None;
    }
    Some(name.to_string())
}

/// Parse "id author ..." line. Returns the author string.
pub fn parse_id_author(line: &str) -> Option<String> {
    let rest = line.strip_prefix("id author ")?;
    let author = rest.trim();
    if author.is_empty() {
        return None;
    }
    Some(author.to_string())
}

/// Parse "option name ... type ..." line.
pub fn parse_option(line: &str) -> Option<UsiOptionDef> {
    let rest = line.strip_prefix("option name ")?;

    // Find "type " to split name and the rest
    let type_idx = rest.find(" type ")?;
    let name = rest[..type_idx].trim().to_string();
    let after_name = &rest[type_idx + 6..]; // skip " type "

    // Split into type keyword and remaining tokens
    let mut parts = after_name.splitn(2, ' ');
    let type_str = parts.next()?;
    let remainder = parts.next().unwrap_or("");

    match type_str {
        "check" => {
            let default = parse_kv_bool(remainder, "default").unwrap_or(false);
            Some(UsiOptionDef::Check { name, default })
        }
        "spin" => {
            let default = parse_kv_i64(remainder, "default").unwrap_or(0);
            let min = parse_kv_i64(remainder, "min").unwrap_or(i64::MIN);
            let max = parse_kv_i64(remainder, "max").unwrap_or(i64::MAX);
            Some(UsiOptionDef::Spin {
                name,
                default,
                min,
                max,
            })
        }
        "combo" => {
            let default = parse_kv_default_str(remainder).unwrap_or_default();
            let vars = parse_combo_vars(remainder);
            Some(UsiOptionDef::Combo {
                name,
                default,
                vars,
            })
        }
        "string" => {
            let default = parse_kv_default_str(remainder).unwrap_or_default();
            Some(UsiOptionDef::String { name, default })
        }
        "filename" => {
            let default = parse_kv_default_str(remainder).unwrap_or_default();
            Some(UsiOptionDef::Filename { name, default })
        }
        "button" => Some(UsiOptionDef::Button { name }),
        _ => None,
    }
}

/// Parse "info ..." line into UsiEngineEvent::Info.
pub fn parse_info(line: &str) -> Option<UsiEngineEvent> {
    let rest = line.strip_prefix("info ")?;
    let tokens: Vec<&str> = rest.split_whitespace().collect();

    let mut depth = None;
    let mut seldepth = None;
    let mut nodes = None;
    let mut nps = None;
    let mut time_ms = None;
    let mut score_cp = None;
    let mut score_mate = None;
    let mut multipv = None;
    let mut pv = None;
    let mut hashfull = None;

    let mut i = 0;
    while i < tokens.len() {
        match tokens[i] {
            "depth" => {
                i += 1;
                depth = tokens.get(i).and_then(|v| v.parse().ok());
            }
            "seldepth" => {
                i += 1;
                seldepth = tokens.get(i).and_then(|v| v.parse().ok());
            }
            "nodes" => {
                i += 1;
                nodes = tokens.get(i).and_then(|v| v.parse().ok());
            }
            "nps" => {
                i += 1;
                nps = tokens.get(i).and_then(|v| v.parse().ok());
            }
            "time" => {
                i += 1;
                time_ms = tokens.get(i).and_then(|v| v.parse().ok());
            }
            "hashfull" => {
                i += 1;
                hashfull = tokens.get(i).and_then(|v| v.parse().ok());
            }
            "multipv" => {
                i += 1;
                multipv = tokens.get(i).and_then(|v| v.parse().ok());
            }
            "score" => {
                i += 1;
                if let Some(&kind) = tokens.get(i) {
                    i += 1;
                    match kind {
                        "cp" => score_cp = tokens.get(i).and_then(|v| v.parse().ok()),
                        "mate" => score_mate = tokens.get(i).and_then(|v| v.parse().ok()),
                        _ => {
                            i -= 1; // rewind if unknown score kind
                        }
                    }
                }
            }
            "pv" => {
                // pv is always last, collect remaining tokens
                let moves: Vec<String> = tokens[i + 1..].iter().map(|s| (*s).to_string()).collect();
                if !moves.is_empty() {
                    pv = Some(moves);
                }
                break;
            }
            "string" => {
                // "info string ..." — skip, not structured
                break;
            }
            _ => {}
        }
        i += 1;
    }

    Some(UsiEngineEvent::Info {
        depth,
        seldepth,
        nodes,
        nps,
        time_ms,
        score_cp,
        score_mate,
        multipv,
        pv,
        hashfull,
    })
}

/// Parse "bestmove ..." line into UsiEngineEvent::BestMove.
pub fn parse_bestmove(line: &str) -> Option<UsiEngineEvent> {
    let rest = line.strip_prefix("bestmove ")?;
    let mut tokens = rest.split_whitespace();
    let mv = tokens.next()?.to_string();

    let ponder = if tokens.next() == Some("ponder") {
        tokens.next().map(|s| s.to_string())
    } else {
        None
    };

    Some(UsiEngineEvent::BestMove { mv, ponder })
}

/// Dispatch a single USI output line to the appropriate parser.
/// Returns None for lines that don't produce events (usiok, readyok, id, option, etc.)
pub fn parse_engine_line(line: &str) -> Option<UsiEngineEvent> {
    let line = line.trim();
    if line.starts_with("info ") {
        parse_info(line)
    } else if line.starts_with("bestmove ") {
        parse_bestmove(line)
    } else {
        None
    }
}

// ── Helper functions ───────────────────────────────────────────────

/// Extract a single-token value for a key from USI option remainder.
/// e.g. for "default 1 min 1 max 512", key="default" → "1"
fn parse_kv_token(s: &str, key: &str) -> Option<String> {
    let prefix = format!("{key} ");
    let start = s.find(&prefix)? + prefix.len();
    let rest = &s[start..];
    let end = rest.find(' ').unwrap_or(rest.len());
    let val = rest[..end].trim();
    if val.is_empty() {
        None
    } else {
        Some(val.to_string())
    }
}

/// Extract value for "default" key that may span until "var" or end of string.
/// Used for combo/string/filename types where default value may contain spaces.
fn parse_kv_default_str(s: &str) -> Option<String> {
    let prefix = "default ";
    let start = s.find(prefix)? + prefix.len();
    let rest = &s[start..];
    if let Some(var_idx) = rest.find(" var ") {
        Some(rest[..var_idx].trim().to_string())
    } else {
        Some(rest.trim().to_string())
    }
}

fn parse_kv_bool(s: &str, key: &str) -> Option<bool> {
    let val = parse_kv_token(s, key)?;
    match val.as_str() {
        "true" => Some(true),
        "false" => Some(false),
        _ => None,
    }
}

fn parse_kv_i64(s: &str, key: &str) -> Option<i64> {
    let val = parse_kv_token(s, key)?;
    val.parse().ok()
}

/// Parse "var" entries from combo option remainder.
/// e.g. "default Normal var Normal var Suicide var ..." → ["Normal", "Suicide", ...]
fn parse_combo_vars(s: &str) -> Vec<String> {
    let mut vars = Vec::new();
    // Split on " var " boundaries
    for part in s.split(" var ") {
        let trimmed = part.trim();
        // Skip the part before first "var" (which contains "default ...")
        if trimmed.starts_with("default ") || trimmed.is_empty() {
            continue;
        }
        vars.push(trimmed.to_string());
    }
    vars
}

#[cfg(test)]
mod tests {
    use super::*;

    // ── id name / id author ────────────────────────────────────────

    #[test]
    fn test_parse_id_name() {
        assert_eq!(
            parse_id_name("id name YaneuraOu NNUE 7.63"),
            Some("YaneuraOu NNUE 7.63".to_string())
        );
    }

    #[test]
    fn test_parse_id_name_with_spaces() {
        assert_eq!(
            parse_id_name("id name Suisho 7 kai"),
            Some("Suisho 7 kai".to_string())
        );
    }

    #[test]
    fn test_parse_id_name_empty() {
        assert_eq!(parse_id_name("id name "), None);
    }

    #[test]
    fn test_parse_id_name_not_matching() {
        assert_eq!(parse_id_name("id author someone"), None);
    }

    #[test]
    fn test_parse_id_author() {
        assert_eq!(
            parse_id_author("id author yaneurao"),
            Some("yaneurao".to_string())
        );
    }

    // ── option parsing ─────────────────────────────────────────────

    #[test]
    fn test_parse_option_check() {
        let opt = parse_option("option name USI_Ponder type check default false").unwrap();
        assert_eq!(
            opt,
            UsiOptionDef::Check {
                name: "USI_Ponder".to_string(),
                default: false,
            }
        );
    }

    #[test]
    fn test_parse_option_spin() {
        let opt = parse_option("option name Threads type spin default 1 min 1 max 512").unwrap();
        assert_eq!(
            opt,
            UsiOptionDef::Spin {
                name: "Threads".to_string(),
                default: 1,
                min: 1,
                max: 512,
            }
        );
    }

    #[test]
    fn test_parse_option_combo() {
        let opt = parse_option(
            "option name BookEvalBlackLimit type combo default 0 var -99999 var -200 var 0 var 200",
        )
        .unwrap();
        assert_eq!(
            opt,
            UsiOptionDef::Combo {
                name: "BookEvalBlackLimit".to_string(),
                default: "0".to_string(),
                vars: vec![
                    "-99999".to_string(),
                    "-200".to_string(),
                    "0".to_string(),
                    "200".to_string(),
                ],
            }
        );
    }

    #[test]
    fn test_parse_option_string() {
        let opt = parse_option("option name BookFile type string default book.db").unwrap();
        assert_eq!(
            opt,
            UsiOptionDef::String {
                name: "BookFile".to_string(),
                default: "book.db".to_string(),
            }
        );
    }

    #[test]
    fn test_parse_option_string_empty_default() {
        let opt = parse_option("option name EvalDir type string default ").unwrap();
        assert_eq!(
            opt,
            UsiOptionDef::String {
                name: "EvalDir".to_string(),
                default: "".to_string(),
            }
        );
    }

    #[test]
    fn test_parse_option_filename() {
        let opt = parse_option("option name EvalFile type filename default nn.bin").unwrap();
        assert_eq!(
            opt,
            UsiOptionDef::Filename {
                name: "EvalFile".to_string(),
                default: "nn.bin".to_string(),
            }
        );
    }

    #[test]
    fn test_parse_option_button() {
        let opt = parse_option("option name ClearHash type button").unwrap();
        assert_eq!(
            opt,
            UsiOptionDef::Button {
                name: "ClearHash".to_string(),
            }
        );
    }

    #[test]
    fn test_parse_option_name_with_spaces() {
        let opt =
            parse_option("option name USI_Hash type spin default 256 min 1 max 33554432").unwrap();
        assert_eq!(
            opt,
            UsiOptionDef::Spin {
                name: "USI_Hash".to_string(),
                default: 256,
                min: 1,
                max: 33554432,
            }
        );
    }

    // ── info parsing ───────────────────────────────────────────────

    #[test]
    fn test_parse_info_full() {
        let event = parse_info(
            "info depth 20 seldepth 30 score cp 123 nodes 1000000 nps 500000 time 2000 multipv 1 hashfull 500 pv 7g7f 3c3d 2g2f",
        )
        .unwrap();
        assert_eq!(
            event,
            UsiEngineEvent::Info {
                depth: Some(20),
                seldepth: Some(30),
                nodes: Some(1000000),
                nps: Some(500000),
                time_ms: Some(2000),
                score_cp: Some(123),
                score_mate: None,
                multipv: Some(1),
                pv: Some(vec![
                    "7g7f".to_string(),
                    "3c3d".to_string(),
                    "2g2f".to_string()
                ]),
                hashfull: Some(500),
            }
        );
    }

    #[test]
    fn test_parse_info_mate() {
        let event = parse_info("info depth 15 score mate 5 pv 7g7f").unwrap();
        assert_eq!(
            event,
            UsiEngineEvent::Info {
                depth: Some(15),
                seldepth: None,
                nodes: None,
                nps: None,
                time_ms: None,
                score_cp: None,
                score_mate: Some(5),
                multipv: None,
                pv: Some(vec!["7g7f".to_string()]),
                hashfull: None,
            }
        );
    }

    #[test]
    fn test_parse_info_negative_mate() {
        let event = parse_info("info depth 10 score mate -3").unwrap();
        assert_eq!(
            event,
            UsiEngineEvent::Info {
                depth: Some(10),
                seldepth: None,
                nodes: None,
                nps: None,
                time_ms: None,
                score_cp: None,
                score_mate: Some(-3),
                multipv: None,
                pv: None,
                hashfull: None,
            }
        );
    }

    #[test]
    fn test_parse_info_string() {
        // "info string ..." should return Info with all None
        let event = parse_info("info string evaluating...").unwrap();
        assert_eq!(
            event,
            UsiEngineEvent::Info {
                depth: None,
                seldepth: None,
                nodes: None,
                nps: None,
                time_ms: None,
                score_cp: None,
                score_mate: None,
                multipv: None,
                pv: None,
                hashfull: None,
            }
        );
    }

    #[test]
    fn test_parse_info_minimal() {
        let event = parse_info("info depth 1").unwrap();
        assert_eq!(
            event,
            UsiEngineEvent::Info {
                depth: Some(1),
                seldepth: None,
                nodes: None,
                nps: None,
                time_ms: None,
                score_cp: None,
                score_mate: None,
                multipv: None,
                pv: None,
                hashfull: None,
            }
        );
    }

    #[test]
    fn test_parse_info_not_info() {
        assert!(parse_info("bestmove 7g7f").is_none());
    }

    // ── bestmove parsing ───────────────────────────────────────────

    #[test]
    fn test_parse_bestmove_normal() {
        let event = parse_bestmove("bestmove 7g7f").unwrap();
        assert_eq!(
            event,
            UsiEngineEvent::BestMove {
                mv: "7g7f".to_string(),
                ponder: None,
            }
        );
    }

    #[test]
    fn test_parse_bestmove_with_ponder() {
        let event = parse_bestmove("bestmove 7g7f ponder 3c3d").unwrap();
        assert_eq!(
            event,
            UsiEngineEvent::BestMove {
                mv: "7g7f".to_string(),
                ponder: Some("3c3d".to_string()),
            }
        );
    }

    #[test]
    fn test_parse_bestmove_resign() {
        let event = parse_bestmove("bestmove resign").unwrap();
        assert_eq!(
            event,
            UsiEngineEvent::BestMove {
                mv: "resign".to_string(),
                ponder: None,
            }
        );
    }

    #[test]
    fn test_parse_bestmove_win() {
        let event = parse_bestmove("bestmove win").unwrap();
        assert_eq!(
            event,
            UsiEngineEvent::BestMove {
                mv: "win".to_string(),
                ponder: None,
            }
        );
    }

    // ── parse_engine_line dispatch ─────────────────────────────────

    #[test]
    fn test_parse_engine_line_info() {
        let event = parse_engine_line("info depth 5 score cp 30").unwrap();
        assert!(matches!(event, UsiEngineEvent::Info { .. }));
    }

    #[test]
    fn test_parse_engine_line_bestmove() {
        let event = parse_engine_line("bestmove 2g2f").unwrap();
        assert!(matches!(event, UsiEngineEvent::BestMove { .. }));
    }

    #[test]
    fn test_parse_engine_line_usiok() {
        assert!(parse_engine_line("usiok").is_none());
    }

    #[test]
    fn test_parse_engine_line_readyok() {
        assert!(parse_engine_line("readyok").is_none());
    }

    // ── JSON serialization ─────────────────────────────────────────

    #[test]
    fn test_engine_event_info_json() {
        let event = UsiEngineEvent::Info {
            depth: Some(10),
            seldepth: None,
            nodes: Some(50000),
            nps: None,
            time_ms: None,
            score_cp: Some(42),
            score_mate: None,
            multipv: None,
            pv: Some(vec!["7g7f".to_string()]),
            hashfull: None,
        };
        let json = serde_json::to_value(&event).unwrap();
        assert_eq!(json["type"], "info");
        assert_eq!(json["depth"], 10);
        assert_eq!(json["scoreCp"], 42);
        assert_eq!(json["pv"], serde_json::json!(["7g7f"]));
        assert!(json["scoreMate"].is_null());
    }

    #[test]
    fn test_engine_event_bestmove_json() {
        let event = UsiEngineEvent::BestMove {
            mv: "2g2f".to_string(),
            ponder: Some("8c8d".to_string()),
        };
        let json = serde_json::to_value(&event).unwrap();
        assert_eq!(json["type"], "bestmove");
        assert_eq!(json["move"], "2g2f");
        assert_eq!(json["ponder"], "8c8d");
    }

    #[test]
    fn test_engine_event_error_json() {
        let event = UsiEngineEvent::Error {
            message: "process died".to_string(),
        };
        let json = serde_json::to_value(&event).unwrap();
        assert_eq!(json["type"], "error");
        assert_eq!(json["message"], "process died");
    }
}
