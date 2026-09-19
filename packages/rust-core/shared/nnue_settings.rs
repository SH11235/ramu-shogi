//! Web / Desktop 共通の NNUE routing 検証。呼び出し元は探索を停止してから適用する。

use std::io::{Read, Seek, SeekFrom};

use base64::Engine;
use rshogi_core::nnue::net_bin_layout::LayerStacksBinLayout;
use rshogi_core::nnue::{
    LayerStackBucketMode, configure_layer_stack_routing, detect_format,
    load_progress_coeff_kpabs_from_bytes, parse_layer_stack_bucket_mode,
    reset_layer_stack_progress_buckets, reset_layer_stack_progress_kpabs_weights,
    set_layer_stack_progress_kpabs_weights, validate_layer_stack_routing_configuration,
};
use serde::Deserialize;

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct LayerStacksOptions {
    pub bucket_mode: String,
    pub progress_buckets: Option<usize>,
    pub progress_coeff_base64: Option<String>,
}

pub struct PreparedRouting {
    mode: LayerStackBucketMode,
    stored_buckets: usize,
    progress_buckets: Option<usize>,
    weights: Option<Box<[f32]>>,
}

pub fn decode_progress_coefficients(encoded: &str) -> Result<Vec<u8>, String> {
    let expected_bytes = rshogi_core::nnue::SHOGI_PROGRESS_KP_ABS_NUM_WEIGHTS * 8;
    if encoded.len() != expected_bytes.div_ceil(3) * 4 {
        return Err("Invalid progress coefficient file size".into());
    }
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(encoded)
        .map_err(|e| format!("Invalid progress coefficient Base64: {e}"))?;
    let weights = load_progress_coeff_kpabs_from_bytes(&bytes)?;
    if weights.iter().any(|v| !v.is_finite()) {
        return Err("Progress coefficients must be finite f32 values".to_string());
    }
    Ok(bytes)
}

impl LayerStacksOptions {
    fn prepare(&self, stored_buckets: usize) -> Result<PreparedRouting, String> {
        let mode = parse_layer_stack_bucket_mode(&self.bucket_mode)
            .ok_or_else(|| format!("Unknown LayerStacks bucket mode: {}", self.bucket_mode))?;
        validate_layer_stack_routing_configuration(mode, stored_buckets, self.progress_buckets)?;
        let weights = match (mode, &self.progress_coeff_base64) {
            (LayerStackBucketMode::KingRank9, Some(_)) => {
                return Err("KingRank9 does not use progress coefficients".to_string());
            }
            (LayerStackBucketMode::ProgressKPAbs, Some(encoded)) => {
                let bytes = decode_progress_coefficients(encoded)?;
                let weights = load_progress_coeff_kpabs_from_bytes(&bytes)?;
                if weights.iter().any(|v| !v.is_finite()) {
                    return Err("Progress coefficients must be finite f32 values".to_string());
                }
                Some(weights)
            }
            (LayerStackBucketMode::ProgressKPAbs, None) if self.progress_buckets != Some(1) => {
                return Err("progresskpabs requires a progress coefficient file".to_string());
            }
            _ => None,
        };
        Ok(PreparedRouting {
            mode,
            stored_buckets,
            progress_buckets: self.progress_buckets,
            weights,
        })
    }
}

pub fn require_yo_kingrank9(options: Option<&LayerStacksOptions>) -> Result<(), String> {
    if options.is_none_or(|options| options.bucket_mode != "kingrank9") {
        return Err("YaneuraOu SFNN requires KingRank9 in the model settings".into());
    }
    Ok(())
}

/// 重みを公開する前にモデルの格納数とユーザー設定を検証する。
pub fn prepare_routing<R: Read + Seek>(
    reader: &mut R,
    options: Option<&LayerStacksOptions>,
) -> Result<Option<PreparedRouting>, String> {
    let file_size = reader.seek(SeekFrom::End(0)).map_err(|e| e.to_string())?;
    reader.rewind().map_err(|e| e.to_string())?;
    let mut header = vec![0; file_size.min(1024) as usize];
    reader.read_exact(&mut header).map_err(|e| e.to_string())?;
    let info = detect_format(&header, file_size).map_err(|e| e.to_string())?;
    reader.rewind().map_err(|e| e.to_string())?;
    if info.architecture != "LayerStacks" {
        if options.is_some() {
            return Err("LayerStacks settings cannot be used with this model".to_string());
        }
        return Ok(None);
    }
    let options =
        options.ok_or("LayerStacks requires an explicit bucket mode in the model settings")?;
    let layout = LayerStacksBinLayout::from_reader(reader).map_err(|e| e.to_string())?;
    options.prepare(layout.num_buckets).map(Some)
}

/// ロード成功後、探索再開前に検証済み設定を反映する。
pub fn apply_routing(routing: Option<PreparedRouting>) -> Result<(), String> {
    if let Some(routing) = routing {
        configure_layer_stack_routing(
            routing.mode,
            routing.stored_buckets,
            routing.progress_buckets,
        )?;
        if let Some(weights) = routing.weights {
            set_layer_stack_progress_kpabs_weights(weights)?;
        } else {
            reset_layer_stack_progress_kpabs_weights();
        }
    } else {
        reset_layer_stack_progress_buckets();
        reset_layer_stack_progress_kpabs_weights();
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn options(mode: &str, buckets: Option<usize>) -> LayerStacksOptions {
        LayerStacksOptions {
            bucket_mode: mode.into(),
            progress_buckets: buckets,
            progress_coeff_base64: None,
        }
    }

    #[test]
    fn routing_requires_explicit_matching_settings() {
        assert!(options("kingrank9", None).prepare(9).is_ok());
        assert!(options("kingrank9", None).prepare(8).is_err());
        assert!(options("kingrank9", Some(9)).prepare(9).is_err());
        assert!(options("progresskpabs", None).prepare(9).is_err());
        assert!(options("progresskpabs", Some(0)).prepare(9).is_err());
        assert!(options("progresskpabs", Some(10)).prepare(9).is_err());
        assert!(options("progresskpabs", Some(8)).prepare(9).is_err());
        assert!(options("progresskpabs", Some(1)).prepare(1).is_ok());
        assert!(options("progress8kpabs", Some(8)).prepare(9).is_err());
    }

    #[test]
    fn coefficients_must_have_valid_size_and_finite_values() {
        let mut settings = options("progresskpabs", Some(8));
        settings.progress_coeff_base64 = Some("!invalid".into());
        assert!(settings.prepare(9).is_err());
        settings.progress_coeff_base64 =
            Some(base64::engine::general_purpose::STANDARD.encode([0; 8]));
        assert!(settings.prepare(9).is_err());
        let mut bytes = vec![0; rshogi_core::nnue::SHOGI_PROGRESS_KP_ABS_NUM_WEIGHTS * 8];
        settings.progress_coeff_base64 =
            Some(base64::engine::general_purpose::STANDARD.encode(&bytes));
        assert!(settings.prepare(9).is_ok());
        bytes[..8].copy_from_slice(&f64::NAN.to_le_bytes());
        settings.progress_coeff_base64 =
            Some(base64::engine::general_purpose::STANDARD.encode(&bytes));
        assert!(settings.prepare(9).is_err());
    }

    #[test]
    #[ignore = "NNUE_TEST_FILE and optional NNUE_TEST_ROUTING JSON are required"]
    fn real_model_load_and_search() {
        std::thread::Builder::new()
            .stack_size(64 * 1024 * 1024)
            .spawn(|| {
                let path = std::env::var("NNUE_TEST_FILE").expect("NNUE_TEST_FILE");
                let mut settings: Option<LayerStacksOptions> = std::env::var("NNUE_TEST_ROUTING")
                    .ok()
                    .map(|json| serde_json::from_str(&json).expect("NNUE_TEST_ROUTING JSON"));
                if let Ok(path) = std::env::var("NNUE_TEST_PROGRESS_FILE") {
                    settings
                        .as_mut()
                        .expect("progress routing settings")
                        .progress_coeff_base64 = Some(
                        base64::engine::general_purpose::STANDARD
                            .encode(std::fs::read(path).unwrap()),
                    );
                }
                let bytes = std::fs::read(&path).unwrap();
                if crate::yo_sfnn::is_yo_sfnn(&bytes) {
                    require_yo_kingrank9(settings.as_ref()).unwrap();
                }
                let normalized = crate::yo_sfnn::normalize_model(&bytes).unwrap();
                let routing = prepare_routing(
                    &mut std::io::Cursor::new(normalized.as_ref()),
                    settings.as_ref(),
                )
                .unwrap();
                rshogi_core::nnue::init_nnue_from_bytes(&normalized).unwrap();
                apply_routing(routing).unwrap();
                rshogi_core::eval::disable_material();
                let mut position = rshogi_core::position::Position::new();
                position
                    .set_sfen(rshogi_core::position::SFEN_HIRATE)
                    .unwrap();
                let mut search = rshogi_core::search::Search::new(16);
                let mut limits = rshogi_core::search::LimitsType::default();
                limits.depth = 2;
                let result = search.go(
                    &mut position,
                    limits,
                    None::<fn(&rshogi_core::search::SearchInfo)>,
                );
                assert_ne!(result.best_move, rshogi_core::types::Move::NONE);
            })
            .unwrap()
            .join()
            .unwrap();
    }
}
