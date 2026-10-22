# HTTP / WebSocket 契約の確認

HTTP 契約は `packages/api-contract/src/generated/openapi.json` と `schema.ts`、WebSocket 契約は `packages/match-protocol/src/` の型宣言です。backend の変更と合わせて更新し、Web・Desktop のクライアントが同じ契約を参照する状態を保ちます。

## リリース前の必須確認

frontend と backend のリリース対象 checkout を用意し、それぞれの固定された依存関係をインストールしてください。backend の生成スクリプトを実行するため、信頼できる checkout を指定します。両方のローカル検証を済ませた後、frontend のルートで次を実行します。

```sh
pnpm check:contracts:backend --backend-dir ../backend-checkout
```

別の frontend checkout を検査する場合は、`--frontend-dir ../frontend-checkout` も指定できます。空白を含むパスは引用符で囲みます。Windows でも Node.js から直接起動でき、Bash は不要です。

このチェックは backend の `scripts/generate-api-contract.ts --output-dir <一時ディレクトリ>` を、backend にインストールされた `tsx` で実行します。生成物は OS の一時ディレクトリにのみ保存し、成功・失敗のどちらでも削除します。契約ファイルの更新、依存関係のインストール、fetch、配備は実行しません。

次のすべてが一致した場合に `Cross-repository HTTP / WS contracts PASS` を表示します。

- OpenAPI の JSON 構造。空白・オブジェクトのキー順は無視し、配列順や、型に表れない値の制約も比較します。
- backend で再生成した TypeScript と frontend の保存済み TypeScript。
- 両方の `match-protocol/src/` にある `.ts` ファイルの一覧と型宣言。テストファイルは対象外です。
- frontend の保存済み OpenAPI から再生成した TypeScript と保存済み TypeScript の自己整合性。

TypeScript は構文木を比較し、コメント・改行・引用符・セミコロンの違いを無視します。宣言の順番や構造は保つため、同じ型を表す別の書き方でも差になる場合があります。型の代入可能性を判定するチェックではありません。通常のパッケージ型検査とテストも必要です。

`--backend-dir` 未指定、必要ファイルや依存関係の欠落、生成失敗、契約の差はすべて終了コード `1` になります。差が出た場合は backend の定義と生成物を確認し、HTTP の生成ファイルと WS の型を同期して、利用側の型検査・テストとこのチェックを再実行してください。確認した両 checkout の commit SHA と結果をリリース記録に残し、どちらかの契約を変更したら再確認します。frontend / backend のリリース前には、このローカルチェックの成功が必須です。

## 公開 CI が確認する範囲

```sh
pnpm test:contracts
pnpm check:contracts:frontend
pnpm --filter @shogi/api-contract --filter @shogi/match-protocol typecheck
```

`Frontend contract self-consistency` workflow は保存済み OpenAPI と TypeScript の自己整合性、型検査、契約差分を検出する回帰テストを実行します。OpenAPI は外部 `$ref` を持たない単一文書にします。再帰的な `JsonValue` の構造を変更した場合は、生成用の型エイリアスも確認が必要です。

この CI には backend checkout を取得する権限や契約 artifact の供給元がありません。`Frontend contract self-consistency PASS (backend synchronization not checked)` は frontend 内の整合性だけを示します。backend との HTTP / WS 同期を保証する結果として扱わず、前述のローカル確認を行ってください。
