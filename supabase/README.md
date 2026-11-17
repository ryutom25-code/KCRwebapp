# DBの適用手順

管理画面は `/admin/index.html` を開くとログインなしで利用できます。管理者アカウントの登録は不要です。

現行の本番DBには第3・第4・第5移行を適用済みです。現行と同じ既存テーブルがある環境へ不足機能だけを追加する場合は、第4移行と第5移行をこの順で使用してください。第1・第2移行は以前の権限設計の履歴であり、現行環境へ後から適用しないでください。

この構成では、サイトにアクセスできる人が氏名・学校名・履歴を閲覧し、商品・イベント・クイズ等を管理できます。
**SQL未適用のDBでは、新しいポイント処理・プロフィール保存・管理画面は動作しません。**

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

1. 既存スキーマ・RLS・権限とデータをバックアップする。
2. Supabase SQL EditorからDB所有者として移行SQLを実行する。既存データは削除しないが、対象アプリテーブルの既存RLSポリシーとクライアント権限を置き換える。
3. `202611170001_secure_operations.sql` を適用済みの場合は、`202611170002_login_free_management.sql` のみ追加適用する。管理者ユーザーの登録は不要。
4. ログアウト状態で `/admin/index.html` を開き、履歴の閲覧、商品・イベント・クイズの登録、画像アップロードを確認する。
5. 新しい画面コードを配信する。利用者のポイント獲得・クイズ正解・交換と、それぞれの履歴を確認する。

`Could not find the function public.is_admin ...` は旧画面が未作成の権限確認関数を呼んでいたエラーです。現在の画面はこの関数を呼びません。`create_quiz_set` 等の関数や `qr_codes` テーブルが見つからない場合は、上記のDB移行が未適用です。

## 交換履歴が本人の分しか表示されない場合

実際の `exchange_logs_view` は `security_invoker = on` で、`point_history` と `profiles` を結合し、`category = 'exchange'` または `points < 0` の履歴を表示する。
`point_history` に本人のみのSELECTポリシーがある場合、管理画面もその制限を引き継ぐ。実DBでは6件中、ログイン中の利用者の2件だけが表示される状態を確認した。

`migrations/202611170003_exchange_history_read.sql` は、この既存ビューに対する単独適用用の修正。交換に該当する履歴だけを匿名・認証済みアクセスの両方に公開する。既存の本人向けポリシーと書き込み制限は維持する。第1・第2移行の適用は前提としない。

このSQLを適用すると、全利用者の氏名・学校名・学年を含む交換履歴がログイン不要で閲覧可能になる。全利用者の氏名・学校名・交換履歴を匿名公開することについてユーザーの明示承認を受け、Supabase SQL Editorで本番に適用済み。実際の管理画面を再読み込みして履歴6件、ランキングはネコ3件・fesfes2件・小1件と表示されることを確認した。

再現テストは空の使い捨てDBで実行する。

```sh
python3 tests/exchange_view_regression.py 'postgresql://ユーザー@localhost/使い捨てDB'
```

本人の2件だけ見える状態を再現後、修正によって匿名・ログイン済みの両方で6件取得でき、景品ランキングが3件・2件・1件となることを検証する。

## 変更後の仕様

- ポイントの直接更新と履歴の直接追加を禁止し、認証ユーザーをDB側で特定するRPCに統一。
- 同一ユーザーの残高を行ロックし、ポイントと履歴を1トランザクションで保存。
- 交換・チェックインはリクエストUUIDで再送を識別。交換の応答が失われた場合は、同じタブで同じ景品を再度スキャンすると保留中のUUIDを再利用する。
- 同じ学科への繰り返し来校は前回の成功から60分後に許可。`PT`, `OT`, `Ns`, `CW`, `IS`、各 `welcome:` 形式、`event:main` は登録済みコードとして初期登録。
- その他の既存カスタムQRは移行前に `qr_codes` に登録するか、管理画面でイベントQRを発行し直す。任意文字列・URLへの自動加算は廃止。
- 景品交換QRは既存の `EXCHANGE_BOOTH` を継続利用。この固定コードは現地にいることの証明にはならない。
- クイズ正解判定をサーバーへ移し、正解列の読み出しと利用者による正解記録の作成を禁止。同じ問題の正解による加算は1回。
- 管理画面はログイン不要。匿名アクセスとログイン済みアクセスの両方で管理操作を許可。利用者自身のポイント獲得・交換・プロフィール保存には従来どおりログインが必要。
- ブラウザから `.env` を取得する処理は廃止。接続先は `js/env.js` の公開URL・anonキーを設定する。service-roleキーは配置しない。

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
