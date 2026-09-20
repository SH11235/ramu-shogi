//! YaneuraOu の 8bit SFNN を rshogi LayerStacks へ移送する。
//!
//! 対応するのは 5 種の HalfK 系特徴量、shortcut あり、k3k3 または単独 progressN。
//! NN16、common+shard、複合 bucket routing、形状を特定できない export は拒否する。
//! 重みの整数値と順序を保持し、header と hash のみ正規化する。

use std::borrow::Cow;

use rshogi_core::nnue::NnueFormatInfo;

const VERSION: u32 = 0x7af3_2f16;
const TOP_HASH: u32 = 0x3c20_3b32;
const FT_HASH: u32 = 0x5f13_4ab8;
const NETWORK_HASH: u32 = 0x6333_718a;
const MAGIC: &[u8] = b"COMPRESSED_LEB128";
const PREFIX: &str = "ModelType=SFNNWithoutPsqt;Features=";

struct Feature {
    yo: &'static str,
    key: &'static str,
    native: &'static str,
    inputs: usize,
    hash: u32,
}

const FEATURES: [Feature; 5] = [
    Feature {
        yo: "HalfKP",
        key: "HALFKP",
        native: "HalfKP",
        inputs: 125388,
        hash: 0x5d69_d5b8,
    },
    Feature {
        yo: "HalfKA1",
        key: "HALFKA1",
        native: "HalfKaSplit",
        inputs: 138510,
        hash: 0x5f13_4cb8,
    },
    Feature {
        yo: "HalfKA2",
        key: "HALFKA2",
        native: "HalfKaMerged",
        inputs: 131949,
        hash: fnv("halfka-merged"),
    },
    Feature {
        yo: "HalfKA_hm1",
        key: "HALFKAHM1",
        native: "HalfKaHmSplit",
        inputs: 76950,
        hash: fnv("halfka-hm-split"),
    },
    Feature {
        yo: "HalfKA_hm2",
        key: "HALFKAHM2",
        native: "HalfKaHmMerged",
        inputs: 73305,
        hash: 0x7f13_4cb8,
    },
];

const fn fnv(s: &str) -> u32 {
    let mut hash = 0x811c_9dc5u32;
    let mut i = 0;
    while i < s.len() {
        hash = (hash ^ s.as_bytes()[i] as u32).wrapping_mul(0x0100_0193);
        i += 1;
    }
    hash
}

struct Arch<'a> {
    raw: &'a str,
    feature: &'static Feature,
    ft: usize,
    l1: usize,
    l2: usize,
    buckets: usize,
    end: usize,
}

fn error(reason: impl std::fmt::Display) -> String {
    format!("YaneuraOu SFNN: {reason}")
}

/// YO SFNN 系 header を識別する。対応可否・破損検証は別途行う。
pub fn is_yo_sfnn(header: &[u8]) -> bool {
    header.get(4..8) == Some(TOP_HASH.to_le_bytes().as_slice())
        || header.get(..4) == Some(0x7af3_2f17u32.to_le_bytes().as_slice())
        || header
            .get(12..)
            .is_some_and(|arch| arch.starts_with(b"ModelType=SFNN"))
}

fn number(value: &str) -> Result<usize, String> {
    value
        .parse()
        .map_err(|_| error(format!("invalid dimension `{value}`")))
}

fn parse(header: &[u8]) -> Result<Arch<'_>, String> {
    let mut cursor = Cursor::new(header);
    cursor.expect(VERSION, "version (only 8bit SFNN is supported)")?;
    cursor.expect(TOP_HASH, "model hash")?;
    let len = cursor.u32()? as usize;
    if len == 0 || len > 16384 {
        return Err(error("invalid architecture length"));
    }
    let raw = std::str::from_utf8(cursor.take(len)?).map_err(|_| error("invalid UTF-8 header"))?;
    let body = raw
        .strip_prefix(PREFIX)
        .ok_or_else(|| error("unsupported model type"))?;
    let (features, network) = body
        .split_once(",Network=")
        .ok_or_else(|| error("missing Network"))?;
    let (name, dims) = features
        .split_once("(Friend)[")
        .ok_or_else(|| error("invalid Features"))?;
    let feature = FEATURES
        .iter()
        .find(|f| f.yo == name)
        .ok_or_else(|| error(format!("unsupported feature `{name}`")))?;
    let dims = dims
        .strip_suffix("x2]")
        .ok_or_else(|| error("invalid feature dimensions"))?;
    let (inputs, ft) = dims
        .split_once("->")
        .ok_or_else(|| error("invalid feature dimensions"))?;
    let ft = number(ft)?;
    if number(inputs)? != feature.inputs || ft == 0 || ft > 8192 || !ft.is_multiple_of(32) {
        return Err(error("inconsistent or unsupported FT dimensions"));
    }
    let (network, count) = network
        .split_once("{LayerStack=")
        .ok_or_else(|| error("missing LayerStack count"))?;
    let buckets = number(
        count
            .strip_suffix('}')
            .ok_or_else(|| error("invalid LayerStack count"))?,
    )?;
    if !matches!(buckets, 2 | 4 | 8 | 9 | 16) {
        return Err(error(
            "only k3k3 or standalone progress2/4/8/16 is supported",
        ));
    }
    let network = network.to_ascii_uppercase();
    let (l1, l2) = if network == "SFNN-1536" || network == "SFNN-1536-V2" {
        if feature.key != "HALFKAHM2" || ft != 1536 {
            return Err(error(
                "SFNN-1536 requires HalfKA_hm2 / 1536; ambiguous BulletOu exports need a complete architecture name",
            ));
        }
        (16, 32)
    } else {
        let (body, routing) = network
            .strip_prefix("SFNN_")
            .and_then(|s| s.rsplit_once('_'))
            .ok_or_else(|| error("unsupported or ambiguous Network name"))?;
        let routing_matches = if buckets == 9 {
            routing == "K3K3"
        } else {
            routing == format!("PROGRESS{buckets}")
        };
        if !routing_matches {
            return Err(error("Network routing disagrees with LayerStack count"));
        }
        let parts: Vec<_> = body.split('_').collect();
        if parts.len() != 4 || parts[0] != feature.key || number(parts[1])? != ft {
            return Err(error(
                "Network dimensions/feature disagree with Features, or unsupported common+shard architecture",
            ));
        }
        let h1 = number(parts[2])?;
        let h2 = number(parts[3])?;
        if h1 == 0 || h1 > 2047 || h1 % 8 != 7 || h2 == 0 || h2 > 4096 {
            return Err(error(
                "unsupported hidden dimensions; H1 must be 8n-1 (shortcut enabled)",
            ));
        }
        (h1 + 1, h2)
    };
    Ok(Arch {
        raw,
        feature,
        ft,
        l1,
        l2,
        buckets,
        end: cursor.pos,
    })
}

/// Header からモデル情報を返す。本体の検証は normalize_model が行う。
pub fn detect_format(header: &[u8], file_size: u64) -> Result<NnueFormatInfo, String> {
    if !is_yo_sfnn(header) {
        return rshogi_core::nnue::detect_format(header, file_size).map_err(|e| e.to_string());
    }
    let arch = parse(header)?;
    let minimum = arch.end as u64
        + 4
        + 2 * (MAGIC.len() as u64 + 4)
        + (arch.ft * (arch.feature.inputs + 1)) as u64
        + arch.buckets as u64
            * (4 + affine_len(arch.ft, arch.l1)
                + affine_len(2 * (arch.l1 - 1), arch.l2)
                + affine_len(arch.l2, 1)) as u64;
    if file_size < minimum {
        return Err(error("file is too short for the declared architecture"));
    }
    Ok(NnueFormatInfo {
        architecture: "LayerStacks".into(),
        l1_dimension: arch.ft as u32,
        l2_dimension: arch.l1 as u32,
        l3_dimension: arch.l2 as u32,
        activation: "CReLU".into(),
        version: VERSION,
        arch_string: arch.raw.into(),
    })
}

fn affine_len(input: usize, output: usize) -> usize {
    output * (4 + input.div_ceil(32) * 32)
}

/// YO は tatara と進行度量子化が異なるため、明示設定と header の整合性を検証する。
pub fn validate_routing(
    header: &[u8],
    mode: &str,
    progress_buckets: Option<usize>,
) -> Result<(), String> {
    let arch = parse(header)?;
    if arch.buckets == 9 {
        if mode != "kingrank9" || progress_buckets.is_some() {
            return Err(error(
                "k3k3 requires KingRank9 without a progress bucket count",
            ));
        }
    } else if mode != "progresskpabsq16" || progress_buckets != Some(arch.buckets) {
        return Err(error(format!(
            "progress{} requires YaneuraOu/BulletOu Q16 routing with the matching bucket count",
            arch.buckets
        )));
    }
    Ok(())
}

fn fc_hash(ft: usize, l2: usize) -> u32 {
    let mut prev = 0xec42_e90d ^ (ft * 2) as u32;
    for (out, relu) in [(ft, true), (l2, true), (1, false)] {
        let mut hash = 0xcc03_dae4u32.wrapping_add(out as u32) ^ (prev >> 1) ^ (prev << 31);
        if relu {
            hash = hash.wrapping_add(0x538d_24c7);
        }
        prev = hash;
    }
    prev
}

fn native_arch(a: &Arch<'_>) -> String {
    let (ft2, l1, dual, l2) = (a.ft * 2, a.l1, 2 * (a.l1 - 1), a.l2);
    format!(
        "Features={}(Friend)[{}->{}x2],Network=AffineTransform[1<-{l2}](ClippedReLU[{l2}](AffineTransform[{l2}<-{dual}](SqrClippedReLU[{dual}](AffineTransform[{l1}<-{ft2}](InputSlice[{ft2}(0:{ft2})]))))),fv_scale=28",
        a.feature.native, a.feature.inputs, a.ft
    )
}

/// 対応 YO モデルを検証して変換する。非 YO モデルはコピーせず返す。
pub fn normalize_model(bytes: &[u8]) -> Result<Cow<'_, [u8]>, String> {
    if !is_yo_sfnn(bytes) {
        return Ok(Cow::Borrowed(bytes));
    }
    let a = parse(bytes)?;
    detect_format(bytes, bytes.len() as u64)?;
    let mut cursor = Cursor { bytes, pos: a.end };
    cursor.expect(FT_HASH, "feature transformer hash")?;
    if cursor.bytes.get(cursor.pos) == Some(&b'_') {
        cursor.pos += 1;
    }
    let ft_start = cursor.pos;
    cursor.leb(a.ft)?;
    cursor.leb(a.feature.inputs * a.ft)?;
    let ft_end = cursor.pos;
    let mut buckets = Vec::with_capacity(a.buckets);
    for _ in 0..a.buckets {
        cursor.expect(NETWORK_HASH, "LayerStack hash")?;
        let start = cursor.pos;
        cursor.affine(a.ft, a.l1)?;
        cursor.affine(2 * (a.l1 - 1), a.l2)?;
        cursor.affine(a.l2, 1)?;
        buckets.push(start..cursor.pos);
    }
    if cursor.pos != bytes.len() {
        return Err(error("unexpected trailing data or mismatched architecture"));
    }

    let arch = native_arch(&a);
    let fc = fc_hash(a.ft, a.l2);
    let ft_hash = a.feature.hash ^ (a.ft * 2) as u32;
    let mut out = Vec::new();
    let capacity = bytes
        .len()
        .checked_add(arch.len())
        .ok_or_else(|| error("model size overflow"))?;
    out.try_reserve_exact(capacity)
        .map_err(|_| error("model allocation failed"))?;
    for value in [0x7af3_2f21, ft_hash ^ fc, arch.len() as u32] {
        out.extend_from_slice(&value.to_le_bytes());
    }
    out.extend_from_slice(arch.as_bytes());
    out.extend_from_slice(&(a.buckets as u32).to_le_bytes());
    out.extend_from_slice(&ft_hash.to_le_bytes());
    out.extend_from_slice(&bytes[ft_start..ft_end]);
    for range in buckets {
        out.extend_from_slice(&fc.to_le_bytes());
        out.extend_from_slice(&bytes[range]);
    }
    Ok(Cow::Owned(out))
}

struct Cursor<'a> {
    bytes: &'a [u8],
    pos: usize,
}
impl<'a> Cursor<'a> {
    fn new(bytes: &'a [u8]) -> Self {
        Self { bytes, pos: 0 }
    }
    fn take(&mut self, n: usize) -> Result<&'a [u8], String> {
        let end = self
            .pos
            .checked_add(n)
            .ok_or_else(|| error("length overflow"))?;
        let bytes = self
            .bytes
            .get(self.pos..end)
            .ok_or_else(|| error("truncated model"))?;
        self.pos = end;
        Ok(bytes)
    }
    fn u32(&mut self) -> Result<u32, String> {
        Ok(u32::from_le_bytes(
            self.take(4)?
                .try_into()
                .map_err(|_| error("truncated u32"))?,
        ))
    }
    fn expect(&mut self, expected: u32, field: &str) -> Result<(), String> {
        if self.u32()? != expected {
            return Err(error(format!("invalid {field}")));
        }
        Ok(())
    }
    fn leb(&mut self, count: usize) -> Result<(), String> {
        if self.take(MAGIC.len())? != MAGIC {
            return Err(error("invalid LEB128 magic"));
        }
        let len = self.u32()? as usize;
        if len < count || len > count * 3 {
            return Err(error("invalid LEB128 payload length"));
        }
        let mut block = Cursor::new(self.take(len)?);
        for _ in 0..count {
            let mut value = 0i32;
            let mut shift = 0;
            loop {
                let byte = block.take(1)?[0];
                value |= i32::from(byte & 127) << shift;
                shift += 7;
                if byte & 128 == 0 {
                    if byte & 64 != 0 {
                        value |= !0i32 << shift;
                    }
                    if i16::try_from(value).is_err() {
                        return Err(error("LEB128 value exceeds i16"));
                    }
                    break;
                }
                if shift >= 21 {
                    return Err(error("overlong LEB128 value"));
                }
            }
        }
        if block.pos != len {
            return Err(error("LEB128 element count mismatch"));
        }
        Ok(())
    }
    fn affine(&mut self, input: usize, output: usize) -> Result<(), String> {
        self.take(output * 4)?;
        let padded = input.div_ceil(32) * 32;
        for _ in 0..output {
            let row = self.take(padded)?;
            if row[input..].iter().any(|&v| v != 0) {
                return Err(error("nonzero affine padding"));
            }
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn fixture(feature: &Feature) -> Vec<u8> {
        fixture_routing(feature, "K3K3", 9)
    }

    fn fixture_routing(feature: &Feature, routing: &str, buckets: usize) -> Vec<u8> {
        let arch = format!(
            "{PREFIX}{}(Friend)[{}->32x2],Network=SFNN_{}_32_7_8_{routing}{{LayerStack={buckets}}}",
            feature.yo, feature.inputs, feature.key
        );
        let mut bytes = Vec::new();
        for v in [VERSION, TOP_HASH, arch.len() as u32] {
            bytes.extend_from_slice(&v.to_le_bytes());
        }
        bytes.extend_from_slice(arch.as_bytes());
        bytes.extend_from_slice(&FT_HASH.to_le_bytes());
        bytes.push(b'_');
        for n in [32, feature.inputs * 32] {
            bytes.extend_from_slice(MAGIC);
            bytes.extend_from_slice(&(n as u32).to_le_bytes());
            bytes.resize(bytes.len() + n, 0);
        }
        for _ in 0..buckets {
            bytes.extend_from_slice(&NETWORK_HASH.to_le_bytes());
            bytes.resize(
                bytes.len() + affine_len(32, 8) + affine_len(14, 8) + affine_len(8, 1),
                0,
            );
        }
        bytes
    }

    #[test]
    fn progress_preserves_stack_count_and_requires_q16_routing() {
        for buckets in [2, 4, 8, 16] {
            let input = fixture_routing(&FEATURES[4], &format!("PROGRESS{buckets}"), buckets);
            let output = normalize_model(&input).unwrap();
            let network = rshogi_core::nnue::NNUENetwork::from_bytes(&output).unwrap();
            assert_eq!(network.layer_stack_num_buckets(), Some(buckets));
            validate_routing(&input, "progresskpabsq16", Some(buckets)).unwrap();
            assert!(validate_routing(&input, "progresskpabs", Some(buckets)).is_err());
            assert!(validate_routing(&input, "kingrank9", None).is_err());
            assert!(validate_routing(&input, "progresskpabsq16", Some(1)).is_err());
        }
        assert!(normalize_model(&fixture_routing(&FEATURES[4], "K3K3_PROGRESS8", 8)).is_err());
        assert!(normalize_model(&fixture_routing(&FEATURES[4], "PROGRESS4", 8)).is_err());
        let king = fixture(&FEATURES[4]);
        validate_routing(&king, "kingrank9", None).unwrap();
        assert!(validate_routing(&king, "progresskpabsq16", Some(8)).is_err());
    }

    #[test]
    fn normalizes_all_feature_sets_and_preserves_non_yo() {
        for feature in &FEATURES {
            let input = fixture(feature);
            let info = detect_format(&input, input.len() as u64).unwrap();
            assert_eq!(
                (info.l1_dimension, info.l2_dimension, info.l3_dimension),
                (32, 8, 8)
            );
            let output = normalize_model(&input).unwrap();
            let info = rshogi_core::nnue::detect_format(&output, output.len() as u64).unwrap();
            assert_eq!(info.architecture, "LayerStacks");
            let network = rshogi_core::nnue::NNUENetwork::from_bytes(&output).unwrap();
            assert!(network.is_layer_stacks());
            assert_eq!(network.layer_stack_num_buckets(), Some(9));
            assert!(matches!(
                normalize_model(&output).unwrap(),
                Cow::Borrowed(_)
            ));
        }
    }

    #[test]
    fn rejects_truncation_hash_corruption_and_extra_data() {
        let input = fixture(&FEATURES[4]);
        assert!(normalize_model(&input[..input.len() - 1]).is_err());
        let mut bad = input.clone();
        bad.push(0);
        assert!(normalize_model(&bad).is_err());
        let end = parse(&input).unwrap().end;
        let mut bad = input.clone();
        bad[end] ^= 1;
        assert!(normalize_model(&bad).is_err());
        let mut bad = input;
        let last_hash = bad.len() - 4 - affine_len(32, 8) - affine_len(14, 8) - affine_len(8, 1);
        bad[last_hash] ^= 1;
        assert!(normalize_model(&bad).is_err());
    }

    #[test]
    fn rejects_unsupported_architectures_and_nn16() {
        let input = fixture(&FEATURES[4]);
        let end = parse(&input).unwrap().end;
        let arch = std::str::from_utf8(&input[12..end]).unwrap();
        for replacement in [
            arch.replace("_7_8_", "_8_8_"),
            arch.replace("_K3K3", "_K9K9"),
            arch.replace("LayerStack=9", "LayerStack=1"),
            arch.replace("SFNN_HALFKAHM2_32_7_8_K3K3", "SFNN-32"),
        ] {
            let mut header = Vec::new();
            for v in [VERSION, TOP_HASH, replacement.len() as u32] {
                header.extend_from_slice(&v.to_le_bytes());
            }
            header.extend_from_slice(replacement.as_bytes());
            assert!(normalize_model(&header).is_err());
        }
        let mut input = input;
        input[..4].copy_from_slice(&0x7af3_2f17u32.to_le_bytes());
        assert!(normalize_model(&input).is_err());
    }

    #[test]
    fn validates_signed_leb128_without_requantizing() {
        let values = [0u8, 127, 128, 127, 255, 255, 1, 128, 128, 126];
        let mut bytes = MAGIC.to_vec();
        bytes.extend_from_slice(&(values.len() as u32).to_le_bytes());
        bytes.extend_from_slice(&values);
        Cursor::new(&bytes).leb(5).unwrap();
        *bytes.last_mut().unwrap() = 2;
        assert!(Cursor::new(&bytes).leb(5).is_err());
    }
}
