# Requirements Document

## Introduction
デスクトップアプリ（Tauri）にCSAプロトコル対局機能を追加する。rshogi-oss の既存CSAクライアント実装をRust側に統合し、Tauri IPC経由でフロントエンドからCSAサーバー（floodgate等）へGUIを介さず直接TCP接続して自動対局を行えるようにする。内蔵エンジン（rshogi-core）またはユーザー登録済みの外部USIエンジンを使用して対局する。

## Requirements

### Requirement 1: CSAサーバー接続・認証
**Objective:** ユーザーとして、CSAサーバーの接続情報を設定してログインできるようにしたい。サーバーへの接続を確立し対局待ちの状態に入れるようにするため。

#### Acceptance Criteria
1. When ユーザーがCSA接続設定（ホスト名、ポート、ユーザーID、パスワード）を入力して接続ボタンを押した場合, the CSA Client shall 指定サーバーへTCP接続を確立し、LOGIN コマンドを送信する
2. When サーバーから `LOGIN:... OK` レスポンスを受信した場合, the CSA Client shall ログイン成功をUIに通知し、対局待ち状態に遷移する
3. If ログインが失敗した場合（`LOGIN:incorrect`）, the CSA Client shall エラーメッセージをUIに表示し、接続を切断する
4. If TCP接続がタイムアウトまたは拒否された場合, the CSA Client shall 接続失敗の理由をUIに表示する
5. The CSA Client shall TCP_NODELAY および SO_KEEPALIVE オプションを設定する
6. While CSAサーバーに接続中, the CSA Client shall 設定された間隔で keep-alive ping（空行送信）を行い、接続を維持する

### Requirement 2: 対局マッチング・開始
**Objective:** ユーザーとして、CSAサーバーからの対局割り当てを受け付けて対局を開始できるようにしたい。floodgate等のマッチングシステムで自動的に対局が始まるようにするため。

#### Acceptance Criteria
1. When サーバーから GAME_SUMMARY を受信した場合, the CSA Client shall 対局情報（対局ID、手番、持ち時間、対戦相手名、初期局面）をパースしUIに表示する
2. When GAME_SUMMARY の受信が完了した場合, the CSA Client shall AGREE を送信して対局受諾する
3. When サーバーから START を受信した場合, the CSA Client shall エンジンを初期化し対局を開始する
4. If GAME_SUMMARY のパースに失敗した場合, the CSA Client shall REJECT を送信しエラーをUIに通知する

### Requirement 3: 対局進行（指し手の送受信）
**Objective:** ユーザーとして、エンジンの指し手をCSAサーバーに送信し、相手の指し手を受信して対局を進行させたい。CSAプロトコルに準拠した自動対局を実現するため。

#### Acceptance Criteria
1. When 自分の手番でエンジンが通常の bestmove を返した場合, the CSA Client shall USI形式をCSA形式に変換してサーバーに送信する
2. When エンジンが `bestmove resign` を返した場合, the CSA Client shall `%TORYO` をサーバーに送信する
3. When エンジンが `bestmove win`（入玉宣言勝ち）を返した場合, the CSA Client shall `%KACHI` をサーバーに送信する
4. When サーバーから相手の指し手を受信した場合, the CSA Client shall CSA形式をUSI形式に変換し、エンジンに局面を更新して次の探索を開始する
5. When 自分が先手（黒番）で対局開始した場合, the CSA Client shall 初期局面からエンジンの探索を開始する
6. When 自分が後手（白番）で対局開始した場合, the CSA Client shall 相手の初手を待ってからエンジンの探索を開始する
7. While 対局進行中, the CSA Client shall 各指し手をUIの盤面に反映する
8. The CSA Client shall 送信した指し手のサーバーエコーを検証し、不一致時はエラーとする

### Requirement 4: 時間管理
**Objective:** ユーザーとして、CSAサーバーの持ち時間制に従った時間管理を行いたい。対局中の残り時間を正確に追跡し、エンジンに適切な時間パラメータを渡すため。

#### Acceptance Criteria
1. When GAME_SUMMARY から持ち時間情報を受信した場合, the CSA Client shall Time_Unit（秒/ミリ秒）、持ち時間（Total_Time）、秒読み（Byoyomi）、加算（Increment）、および先後別の残り時間（Time+/Time-）を正しくパースする
2. When 秒読み制の対局でエンジンに探索を指示する場合, the CSA Client shall `go btime <残ms> wtime <残ms> byoyomi <秒読みms>` 形式でエンジンに渡す
3. When フィッシャー制（increment）の対局でエンジンに探索を指示する場合, the CSA Client shall `go btime <残ms> wtime <残ms> binc <加算ms> winc <加算ms>` 形式でエンジンに渡す
4. When 秒読み・加算のいずれもない対局でエンジンに探索を指示する場合, the CSA Client shall `go btime <残ms> wtime <残ms>` 形式でエンジンに渡す
5. When 指し手が送受信された場合, the CSA Client shall 消費時間を該当手番側の残り時間から差し引く
6. The CSA Client shall ネットワーク遅延を考慮したマージン時間（デフォルト2500ms）を秒読みから差し引いてエンジンに渡す
7. While 対局進行中, the CSA Client shall 双方の残り時間をUIに表示する

### Requirement 5: Ponder対応
**Objective:** ユーザーとして、相手の思考中にエンジンが先読み（ponder）を行えるようにしたい。エンジンの棋力を最大限に発揮するため。

#### Acceptance Criteria
1. Where ponderが有効な場合, When エンジンが bestmove と ponder move を返した場合, the CSA Client shall 指し手送信後に予測局面で `go ponder` を開始する
2. Where ponderが有効な場合, When 相手の指し手が ponder 予測と一致した場合, the CSA Client shall `ponderhit` をエンジンに送信して探索を継続する
3. Where ponderが有効な場合, When 相手の指し手が ponder 予測と不一致の場合, the CSA Client shall `stop` をエンジンに送信し、エンジンから古い bestmove が返るのを待って破棄した後、正しい局面で探索を再開する
4. Where ponderが無効な場合, the CSA Client shall bestmove 受信後に ponder を開始しない

### Requirement 6: 対局終了・結果処理
**Objective:** ユーザーとして、対局が正常に終了し結果が記録されるようにしたい。勝敗を把握し棋譜を保存するため。

#### Acceptance Criteria
1. When サーバーから `#WIN` を受信した場合, the CSA Client shall 勝利結果をUIに表示し、エンジンに `gameover win` を送信する
2. When サーバーから `#LOSE` を受信した場合, the CSA Client shall 敗北結果をUIに表示し、エンジンに `gameover lose` を送信する
3. When サーバーから `#DRAW` を受信した場合, the CSA Client shall 引き分け結果をUIに表示し、エンジンに `gameover draw` を送信する
4. When サーバーから `#CENSORED` を受信した場合, the CSA Client shall 検閲終了結果をUIに通知しエンジンの探索を停止する
5. When サーバーから `#CHUDAN`（中断）を受信した場合, the CSA Client shall 中断をUIに通知しエンジンの探索を停止する
6. The CSA Client shall 終局理由行（`#TIME_UP`, `#ILLEGAL_MOVE`, `#MAX_MOVES`, `#SENNICHITE`, `#JISHOGI` 等）を結果メタデータとして保持し、UI表示および棋譜記録に反映する
7. When 対局が終了した場合, the CSA Client shall エンジンに `gameover` を通知し、次の対局待ちまたは切断処理を行う

### Requirement 7: 棋譜記録
**Objective:** ユーザーとして、対局の棋譜を保存したい。後から対局内容を振り返れるようにするため。

#### Acceptance Criteria
1. When 対局が終了した場合, the CSA Client shall CSA形式の棋譜ファイルを保存する
2. The CSA Client shall 棋譜に対局ID、対戦者名、持ち時間設定、各手の消費時間を含める
3. Where Floodgateモードが有効な場合, the CSA Client shall 各手にエンジンの評価値とPV（読み筋）をコメントとして付与する
4. The CSA Client shall 棋譜の保存先ディレクトリをユーザーが設定できる
5. When 対局が終了した場合, the CSA Client shall 棋譜をアプリの棋譜リストにも追加する

### Requirement 8: Floodgate拡張対応
**Objective:** ユーザーとして、floodgate サーバー固有の機能に対応したい。floodgate の評価値コメント形式等に準拠した対局を行うため。

#### Acceptance Criteria
1. Where Floodgateモードが有効な場合, When 指し手を送信する場合, the CSA Client shall 指し手コメントに `'* <評価値> <PV(CSA形式)>` を付与する
2. Where Floodgateモードが有効な場合, the CSA Client shall 評価値を先手視点の符号で正規化する（後手の場合は符号反転）
3. Where Floodgateモードが有効な場合, the CSA Client shall 詰み評価を ±100000 cp に変換する

### Requirement 9: 接続設定UI
**Objective:** ユーザーとして、CSA接続設定をGUIから管理したい。設定ファイルを手動で編集せずに対局を開始できるようにするため。

#### Acceptance Criteria
1. The Desktop App shall CSA接続設定画面を提供し、以下の項目を設定可能にする：サーバーホスト名、ポート番号、ユーザーID、パスワード、Floodgateモードの有無
2. The Desktop App shall サーバー接続プリセットを提供し、floodgate（wdoor.c.u-tokyo.ac.jp:4081）をデフォルト選択肢として含める
3. When ユーザーがプリセットを選択した場合, the Desktop App shall ホスト名・ポート・Floodgateモードを自動入力する（ユーザーID・パスワードは手動入力）
4. The Desktop App shall 使用エンジン（内蔵 or 登録済み外部USIエンジン）を選択できるUIを提供する
5. The Desktop App shall エンジンオプション（Hash、Threads等）およびponder有無を設定できるUIを提供する
6. The Desktop App shall 時間マージン（ネットワーク遅延対策）を設定できるUIを提供する
7. When ユーザーが接続設定を保存した場合, the Desktop App shall 設定を永続化し次回起動時に復元する
8. The Desktop App shall 連続対局数（0で無制限）を設定できるUIを提供する

### Requirement 10: 対局中UI
**Objective:** ユーザーとして、CSA対局の進行状況をリアルタイムで確認したい。対局の状態を視覚的に把握するため。

#### Acceptance Criteria
1. While CSA対局進行中, the Desktop App shall 現在の盤面、指し手履歴、双方の残り時間を表示する
2. While CSA対局進行中, the Desktop App shall エンジンの探索情報（深さ、評価値、読み筋、NPS）を表示する
3. While CSA対局進行中, the Desktop App shall 接続状態（接続中、対局中、切断等）をステータスとして表示する
4. The Desktop App shall CSA対局の開始・停止を制御するボタンを提供する
5. While 対局待ち中, When ユーザーが切断ボタンを押した場合, the Desktop App shall サーバーから LOGOUT してTCP接続を閉じる
6. While 対局進行中, When ユーザーが停止ボタンを押した場合, the Desktop App shall エンジンを停止し、`%TORYO`（投了）をサーバーに送信してから結果を待つ

### Requirement 11: エラーハンドリング・再接続
**Objective:** ユーザーとして、ネットワーク障害時に適切にリカバリしたい。長時間の自動対局でも安定して動作するため。

#### Acceptance Criteria
1. If 対局中にサーバーとの接続が切断された場合, the CSA Client shall エンジンの探索を停止し、切断をUIに通知する
2. If エンジンプロセスが異常終了した場合, the CSA Client shall 対局を中断しエラーをUIに通知する
3. Where 連続対局モードの場合, When 対局間でエラーが発生した場合, the CSA Client shall 指数バックオフで再接続を試みる
4. When ユーザーが手動で切断を要求した場合, the CSA Client shall 対局中であれば `%TORYO` を送信して結果確定を待ち、その後 LOGOUT してTCP接続を閉じる。対局待ち中であれば即座に LOGOUT して切断する

### Requirement 12: エンジンライフサイクル管理
**Objective:** ユーザーとして、CSA対局で使用するエンジンが適切に管理されるようにしたい。リソースリークや不安定な動作を防ぐため。

#### Acceptance Criteria
1. When CSA対局セッションが開始された場合, the CSA Client shall 選択されたエンジンを初期化し `usi` → `isready` ハンドシェイクを完了する
2. When 各対局が開始される場合, the CSA Client shall `usinewgame` をエンジンに送信する
3. When CSA対局セッションが終了した場合, the CSA Client shall エンジンに `quit` を送信しプロセスを終了する
4. The CSA Client shall エンジンの初期化タイムアウト（デフォルト30秒）を設定可能にする
