# Rust Core for Shogi

WASM バインディング用のワークスペースです。
エンジンコア実装は [rshogi](https://github.com/SH11235/rshogi) (crates.io: `rshogi-core`) を使用しています。

Q16 routing 対応の `rshogi-core`（0.7.0 ベース）を Desktop と同じ Git revision で固定し、
`edition-universal` を明示してビルドします。
対応する NNUE モデルと設定は [NNUE モデルの読み込み](../../docs/nnue-models.md) を参照してください。
`shared/` の Rust モジュールは Web/WASM と Desktop の両方から参照します。

## License

GPL-3.0-or-later
