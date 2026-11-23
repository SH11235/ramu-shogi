# Rust Core for Shogi

WASM バインディング用のワークスペースです。
エンジンコア実装は [rshogi](https://github.com/SH11235/rshogi) (crates.io: `rshogi-core`) を使用しています。

`rshogi-core` を Desktop と同じ Git revision で固定し、`edition-universal` と、
配布の RAMU の構成 (LayerStacks 1536x16x64、HalfKA_hm) の静的な実装を明示してビルドします。
対応する NNUE モデルと設定は [NNUE モデルの読み込み](../../docs/nnue-models.md) を参照してください。
`shared/` の Rust モジュールは Web/WASM と Desktop の両方から参照します。

## License

GPL-3.0-or-later
