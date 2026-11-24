# DBの適用手順

Node.js版の管理画面は `/admin/` から開き、スタッフ共通のユーザー名とパスワードでログインします。

現行の本番DBには第3・第4・第5移行と、交換履歴を匿名化する `202611240001_mask_public_exchange_history.sql` を適用済みです。氏名付き交換履歴の `202611240002_staff_exchange_view.sql` も本番に適用済みです。管理操作全体のNode.js版への切り替えには `202611240003_staff_backend.sql` を使用します。第1・第2移行は以前の権限設計の履歴です。

## 現行DBの不足機能を追加するSQL（適用済み）

`migrations/202611170004_runtime_and_quiz_management.sql` は、既存テーブルのポリシーを一括変更せずに不足機能を追加する単独適用用SQLです。実DBの列型・制約・トリガーを確認し、本番に適用しました。過去の第1・第2移行が未適用でも使用できます。

- `qr_codes` とリクエスト再送識別用 `operation_requests` を作成し、学科QRを初期登録。
- `record_checkin`、`exchange_product`、`answer_quiz`、`save_profile`、`create_quiz_set` を追加。
- ログイン不要のクイズ一覧・問題編集・問題削除・セット編集・セット削除のRPCを追加。
- 来校の繰り返し記録を可能にするため、既存の `checkins_user_id_booth_id_key` 一意制約を解除。
- 既存の不正解記録がある問題は、正解時に同じ回答記録を更新。獲得済みポイントと履歴は問題削除後も保持。
- 学科表示を「情報システム学科」に統一。既存履歴の表示タイトル・イベント・クイズ文等の旧名称も置換。履歴行とポイント値は削除・変更しない。

現行環境で不足機能だけを導入する場合は、古い第1・第2移行を後から実行せず、第4移行を使用してください。古い移行は以前の権限設計を含みます。

## 前提

既存DBの定義がリポジトリにないため、移行SQLは画面から確認できる既存テーブルを前提としています。

- `profiles`: `id` はAuthユーザーのUUID。`name`, `school_name`, `grade` は文字列、`points` は整数。
- `checkins`: `id`, `user_id`, `booth_id`, `created_at`。
- `point_history`（Supabase画面で型を確認済み）: `id` は `bigint`、`user_id` は `uuid`、`title`・`category`・`department_name` は `text`、`points` は `integer`、`created_at` は `timestamptz`、`is_delivered` は `boolean`。SQL Editorで、IDのシーケンス自動採番、日時の初期値、Authユーザーへの外部キー、`is_delivered` がNULL可・初期値falseであることも確認済み。`is_delivered` は現在のコードでは変更しない。
- `products`: `id`, `name`, `points`, `image_url`, `created_at`, `updated_at`。
- `events`: `id`, `title`, `event_date`, `is_new`, `created_at`, `updated_at`。
- `quiz_sets`: `id`, `department`, `title`, `created_at`。
- `quizzes`: `id`, `set_id`, `question`, `options`, `correct_index`, `points`。`options` は `text[]` / `json` / `jsonb`。
- `quiz_answers`: `id`, `user_id`, `set_id`, `quiz_id`, `is_correct`。
- 各テーブルの `id` と日時には既存のデフォルト値があること。
- 画像アップロードには既存の公開Storageバケット `product-images` を使用。

ステージングで既存の型・制約・トリガーを確認してから適用してください。特に、既存トリガーがポイントを加算している場合はRPCとの二重加算を防ぐ調整が必要です。`tests/database_fixture.sql` は検証用の仮定であり、本番スキーマを作成するためのSQLではありません。

## 適用

1. 既存スキーマとデータをバックアップし、ステージングで移行を確認する。
2. Node.js版とホスティングの環境変数を準備する。Supabase Authのメール確認リダイレクト先を新しいURLに合わせる。
3. Supabase SQL Editorでスタッフ用ビューの移行 `202611240002_staff_exchange_view.sql` を適用する。管理操作をNode.js版に切り替える際に `202611240003_staff_backend.sql` を適用する。この移行後はNode.js版のURLから管理操作を行う。
4. スタッフログイン後に氏名付き交換履歴、一覧の検索・CSV、QR発行、景品画像アップロード、クイズ編集を確認する。ログアウト後の管理画面へのアクセスがログイン画面に戻ることを確認する。
5. 利用者としてプロフィールの登録・更新、ポイント獲得・交換・履歴を確認する。

## 交換履歴の公開範囲

`202611240001_mask_public_exchange_history.sql` を本番に適用済みです。公開の `exchange_logs_view` では景品名・交換日時・消費ポイント・履歴IDを取得できます。利用者ID・氏名・学校名・学年は、既存画面との互換性のためNULLを返します。このビューへの書き込み権限は公開していません。

`point_history` の交換記録を直接読める利用者は本人に限定します。以前の全件公開を再有効化しないよう、第3移行は本番へ再適用しないでください。ダッシュボードの交換件数は公開ビューから集計します。

Node.js版はスタッフ専用の `staff_exchange_logs` から氏名・学校名・学年を取得します。利用者の公開キーからこのビューを読む権限は付与しません。来校履歴、プロフィール一覧、クイズ管理、景品・イベント・QRの管理操作もサーバー用キーで処理します。管理操作全体の切り替え後は、利用者自身のプロフィール・ポイント履歴・クイズ回答記録へのアクセスを本人に制限します。

## 変更後の仕様

- ポイントの直接更新と履歴の直接追加を禁止し、認証ユーザーをDB側で特定するRPCに統一。
- 同一ユーザーの残高を行ロックし、ポイントと履歴を1トランザクションで保存。
- 交換・チェックインはリクエストUUIDで再送を識別。交換の応答が失われた場合は、同じタブで同じ景品を再度スキャンすると保留中のUUIDを再利用する。
- 同じ学科への繰り返し来校は前回の成功から60分後に許可。`PT`, `OT`, `Ns`, `CW`, `IS`、各 `welcome:` 形式、`event:main` は登録済みコードとして初期登録。
- その他の既存カスタムQRは移行前に `qr_codes` に登録するか、管理画面でイベントQRを発行し直す。任意文字列・URLへの自動加算は廃止。
- 景品交換QRは既存の `EXCHANGE_BOOTH` を継続利用。この固定コードは現地にいることの証明にはならない。
- クイズ正解判定をサーバーへ移し、正解列の読み出しと利用者による正解記録の作成を禁止。同じ問題の正解による加算は1回。
- スタッフは共通資格情報で管理画面にログインする。利用者自身のポイント獲得・交換・プロフィール保存には従来どおり利用者ログインが必要。
- Supabaseのサーバー用キーはNode.jsの環境変数で管理する。ブラウザにはSupabase URLと公開キーを返す。

## テスト

JavaScript回帰テスト:

```sh
node tests/regression.cjs
```

DB回帰テストは空の使い捨てPostgreSQLに対して実行します。既存テーブルがある場合は停止します。

```sh
python3 -m pip install 'psycopg[binary]'
python3 tests/database_regression.py 'postgresql://ユーザー@localhost/使い捨てDB'
# 別の空DBで配列型も検証
python3 tests/database_regression.py 'postgresql://ユーザー@localhost/別の使い捨てDB' 'text[]'
```

`tests/browser_regression.html` をブラウザで開くと、実DOMでのHTML無害化・引用符を含む商品名・交換ボタン・カメラ終了のテストを実行します。カメラとSupabaseはスタブを使用し、本番に接続しません。

テストはDB所有者によるフィクスチャ作成後、一般ユーザー・管理者・未認証のロールで検証します。第1移行のポイント保護を確認後、第2移行を適用し、ログイン不要の管理操作とポイント保護が両立することも確認します。対象は権限、未知のQRの拒否、同時更新、重複リクエスト、履歴保存失敗時のロールバック、クイズの重複加算防止です。

検証記録: 第4移行は本番へ適用済み。実際のQRライブラリで学科QR（PT）と交換ブースQR（EXCHANGE_BOOTH）の生成→画像復号に成功。匿名での交換RPC呼び出しは未作成エラーではなく権限エラーとなり、正しいシグネチャの関数が存在することを確認。実カメラの許可は実機での確認が必要。

## 学科チェックインの60分制限（第5移行・本番適用済み）

`202611170005_department_checkin_cooldown.sql` は `record_checkin` を更新します。利用者×学科ごとの最終成功時刻を、来校記録とポイント履歴から確認します。`PT` と `welcome:PT` などの別名も同じ学科にまとめます。別学科・別ユーザーには影響せず、イベントと景品交換のルールも維持します。

60分以内はポイント・履歴を追加せず、`cooldown: true` と `nextAllowedAt` を返します。画面は次回可能時刻を表示し、カメラが同じQRを捉え続けても既知の待機期限内はリクエストを繰り返しません。端末再読み込み・複数タブの場合もDB行ロックで加算回数を制限します。リクエスト再送は既存のUUIDで成功結果を返し、二重加算しません。

```sh
python3 tests/checkin_cooldown_regression.py 'postgresql://ユーザー@localhost/空の使い捨てDB'
```

同一学科の60分以内・別名・60分境界・別学科・別ユーザー・同時8要求・履歴保存失敗のロールバックを検証済みです。
