# 資格情報と個人情報の保存に関する調査と改善案

調査日: 2026-10-26。対象はmain (`1f6a44a`) の実装です。
利用者の質問「アクセストークンはサーバーに保存しているか。最悪のケースでも個人情報が流出しない設計にできるか」に答えます。

## 1. 結論

- **公開WebではGitHubアクセストークンをサーバーに保存しています。** `AuthState` Durable Object（SQLite）に、`SESSION_KEY` でAES-256-GCM暗号化して最大8時間置きます（`apps/cloudflare/src/auth.ts`）。
- **MCPのトークンもサーバー（KV）にありますが、サーバーだけでは復号できません。** `@cloudflare/workers-oauth-provider` は `props`（GitHubトークン）を、クライアントが持つBearerトークンから導出した鍵で包んで保存します。KVの中身を全部取られてもGitHubトークンは出ません。
- **CLI・ローカルWeb・stdio MCPはトークンを保存しません。** プロセス内だけです（`packages/pkgfactory/src/node/auth.ts`、`store.ts`）。
- **Deploy keyの秘密鍵は保存しません。** 生成直後にsealed boxで暗号化してGitHubへ送り、メモリ上で捨てます。
- **ブラウザーのlocalStorageにトークンを置く案は採用すべきではありません。** 現行のHttpOnly Cookieより弱くなります（§4）。
- **推奨する改善は「鍵の分割保持」です。** Cookieにだけある乱数と `SESSION_KEY` の両方からセッション鍵を導出します。これでDurable Objectのダンプと `SESSION_KEY` の両方が漏れてもトークンは復号できず、ログアウトによる無効化も維持できます（§5.1）。変更は `auth.ts` の数十行とテストです。
- 本当の最悪ケース（稼働中のWorkerの乗っ取り）では、どの保存設計でも通過中のトークンは取られます。そこに効くのはトークンの権限と寿命の縮小で、GitHub Appへの移行が本命です（§5.3）。

## 2. 現状: 何がどこに、どの形で、いつまであるか

| データ | 置き場所 | 形 | 保持期間 | 保存キー |
|---|---|---|---|---|
| Web: GitHubアクセストークン、GitHubユーザーID、CSRFトークン | `AuthState` DO `auth_v2` | AES-256-GCM（鍵 `SESSION_KEY`、AAD=レコードキー） | 8時間（期限後にalarmで削除） | `session:sha256(セッションID)` |
| Web: セッションCookie | ブラウザー `__Host-pkgfactory-session` | `乱数ID.HMAC(ID)`。トークンは含まない。HttpOnly/Secure/SameSite=Lax | 8時間 | — |
| Web: ログイン途中の `state`・PKCE verifier | ブラウザー `__Host-pkgfactory-login` | AES-256-GCM（`SESSION_KEY`） | 10分 | — |
| MCP: GitHubトークン（`props.githubToken`）とユーザーID | `OAUTH_KV`（grant/tokenレコード） | AES-GCM。鍵はクライアントのaccess/refreshトークンからHMAC→AES-KWで包む。KVにはトークンのSHA-256だけ | access 1時間、refresh 8時間（KVのTTLで削除） | `token:<userId>:<grantId>:<hash>` 等 |
| プラン（owner、パッケージ名、著者、説明、公開範囲、生成ファイル全文） | `ApplicationState` DO `operations_v2` | 平文JSON（Cloudflareの保存時暗号化のみ） | preview/complete 15分。running/pausedは無期限 | planId。`subject`（ユーザーID）と `repository`（小文字）に索引 |
| ジャーナル（進捗、リポジトリID、コミットSHA、鍵タイトル） | 同上 `metadata` 列 | 平文JSON | 同上 | 同上 |
| CLI/ローカルWeb/stdio MCP: トークン | プロセスメモリ | — | プロセス終了まで | — |
| CLI: ジャーナル | `~/.pkgfactory/journal.json`（0600） | 平文JSON。資格情報・秘密鍵なし | 無期限 | — |
| Deploy key秘密鍵 | なし（メモリのみ） | GitHub Secretへはsealed box | — | — |
| ログ（Workers Logs） | Cloudflare | イベント名・メソッド・パスのみ。IPは `SESSION_KEY` 付きハッシュ。クエリ文字列は削除 | Cloudflare側の保持 | — |
| ブラウザー `sessionStorage` | ブラウザー | 再ログイン時のフォーム下書き（owner、名前、著者、説明、テンプレート、公開範囲、login） | 1時間（タブを閉じれば消える） | — |

参照: `apps/cloudflare/src/auth.ts:28-57,123-127`、`apps/cloudflare/src/state.ts:309-351,415-459`、`apps/cloudflare/src/worker.ts:242-264`、`packages/pkgfactory/src/web/app.ts:476-494`。

### 2.1 すでに良い点

- Cookieは `__Host-` 接頭辞、HttpOnly、Secure、SameSite=Lax。CSRFはOriginヘッダーとトークンの二重検証。
- CSPは `default-src 'self'` でインラインスクリプトなし。XSSの足場が小さい。
- セッションIDはCookie側でHMAC検証してからDOに問い合わせるため、偽造IDでDOを叩けない。
- ログアウトはサーバーのレコード削除に加え、GitHubのトークンをOAuth App APIで失効させる。
- `SESSION_KEY` が32バイトでなければ起動を拒否。署名鍵と暗号鍵はHKDFで分離。
- ログにトークン・IP・アカウントを書かない。OAuthのエラーも固定コードのみ。
- ローカル系はトークンを一切永続化しない。

### 2.2 気になった点

1. **Webセッションのトークンは `SESSION_KEY` 一つで全件復号できる。** DOのダンプとWorkerのsecretの両方を持つ攻撃者（Cloudflareアカウント侵害、CIの `CLOUDFLARE_API_TOKEN` 漏えい、依存パッケージ汚染）は、有効な全セッションのGitHubトークンを即座に得ます。MCP側はライブラリがこの問題を解いているのに、Web側は解いていません。
2. **トークンの権限が広い。** スコープ `repo workflow read:user read:org` は、利用者の全リポジトリ（privateを含む）の読み書きです。1件のパッケージ作成に必要な範囲をはるかに超えます。漏えい時の被害範囲はここで決まります。
3. **OAuth Appのトークンは期限切れしない。** `AGENTS.md` の「Expire user access tokens: 有効」はGitHub Appの設定項目で、OAuth Appにはありません（要確認。今回はネットワーク制限でGitHub Docsを参照できませんでした）。実装もtokenレスポンスの `scope` に `repo` を要求しており（`auth.ts:95`）、これはOAuth App固有の応答です。つまりセッションが8時間で消えても、ログアウトせずに離れた利用者のトークンはGitHub側で生き続けます。サーバーに復号可能な複製は残らないため「保存された状態で漏れる」ことはありませんが、通過中に盗まれたトークンの寿命を縛るものがありません。
4. **プランは平文。** 著者欄は自由記述（Juliaの慣例で `Name <email>` を書く人がいる）、説明文、privateリポジトリ名が含まれます。`paused`/`running` のレコードは回復のため無期限に残ります。公開リポジトリに書く内容ではありますが、privateパッケージの名前や著者は「本人が公開していない情報」です。
5. **MCP grantの失効経路がない。** refresh tokenの期限（8時間）でKVから消えますが、GitHubトークン自体は失効しません。サーバーは読めないので失効もできません。これは設計上の帰結で、3.と同じくGitHub App化で解決します。

## 3. 脅威モデル: 「最悪のケース」を分けて考える

| ケース | 現状で漏れるもの | 改善後（§5.1+5.2） |
|---|---|---|
| A. ストレージのダンプだけ（DO/KVのバックアップ流出、ストレージ権限だけの侵害） | プラン平文、ジャーナル。トークンは暗号文のみ | ユーザーIDとリポジトリ名のHMAC、状態、時刻だけ |
| B. ダンプ + Workerのsecret（`SESSION_KEY` 等） | **有効なWebセッション全件のGitHubトークン**、プラン | プラン平文。トークンは出ない（Cookie側の乱数がない） |
| C. 稼働中Workerの改ざん（CFアカウント乗っ取り、CIトークン漏えい、依存汚染） | 期間中に通過した全トークン・全データ | 同じ。保存設計では防げない。効くのは権限縮小（§5.3）と運用（§5.4） |
| D. XSS | Cookieは読めない。セッション中の操作はできる | 同じ。localStorage案では**トークンそのものが読める**ようになるので採らない |
| E. 共用PCでログアウト忘れ | 8時間 | 同じ。localStorage案では無期限になる |

達成できる目標は「AとBでは何も読めない。Cでは通過中のものに限られ、その価値を小さくする」です。「どんな最悪でも漏れない」は、運用中のサーバーが必ず平文のトークンを扱う以上、保存設計だけでは作れません。

## 4. 「localStorageに暗号化して保存」を採らない理由

鍵をどこに置くかで二つに分かれ、どちらも現行より悪くなります。

- **鍵がサーバー側（`SESSION_KEY`）の場合。** サーバーは受け取るたびに復号するので、これは「暗号化Cookie」のステートレスセッションと同じ設計です。それ自体は成立しますが、置き場所はlocalStorageではなく**HttpOnly Cookie**であるべきです。localStorageはJavaScriptから読めるためXSSで暗号文ごと持ち出され、有効期限の強制もなく、タブや再起動をまたいで残ります。
- **鍵がブラウザー側（IndexedDBのnon-extractable CryptoKey等）の場合。** サーバーは保存時に読めなくなりますが、API呼び出しのたびにブラウザーのJSが復号して平文トークンを送ることになります。トークンがJSに見える時点でXSS耐性はHttpOnly Cookieより下がります。

さらにどちらの場合も、ログアウトで「複製を無効化する」手段がなくなり、GitHub側の失効に頼ることになります。ブラウザーに持たせるなら、持たせるのは「乱数（鍵の半分）」であって「トークン」ではない、というのが§5.1の考え方です。

## 5. 改善案

### 5.1 Webセッションの鍵の分割保持（推奨・小規模）

Cookieに乱数 `k`（32バイト）を加え、セッションレコードの暗号鍵を `HKDF(SESSION_KEY, salt=k, info='pkgfactory session v2')` で導出します。

- Cookie: `id.k.HMAC(id.k)`（HMAC鍵は現行どおり `SESSION_KEY` から派生）。約130文字。
- サーバー: `session:sha256(id)` に `AES-GCM(鍵=HKDF(SESSION_KEY, k), AAD=レコードキー)` の暗号文。
- 検証順序: HMAC → DO取得 → 復号。偽造Cookieは今までどおりDOの前で止まります。

性質:

| 攻撃者が持つもの | 得られるもの |
|---|---|
| DOダンプ | なし |
| DOダンプ + `SESSION_KEY` | なし（各利用者の `k` が必要） |
| 盗んだCookie | サーバーのレコードがある間だけ有効。ログアウトでレコード削除→無効 |
| 稼働中のWorker | 通過中のセッションだけ |

`workers-oauth-provider` がMCP側で行っていることをWeb側に揃える形です。`SESSION_KEY` のローテーションで全員ログアウトになる点は現行と同じです。

変更箇所:

- `apps/cloudflare/src/auth.ts`: `encrypt`/`decrypt` に鍵導出を追加、`sessionCookieValue`/`loadSession` のCookie形式変更、`/auth/callback` と `/auth/logout`。
- 既存セッション: 移行期間を作らず、デプロイ時に全員再ログインとするのが単純です（8時間以内に自然に切れます）。
- テスト: `test/auth.test.ts`（`k` なしでは復号できない、`SESSION_KEY` だけでは復号できない）、`test/worker/security.test.ts`（Cookie形式、ログアウト後の無効化）。
- 文書: `AGENTS.md` の「Webセッション」、`README.md:85`。

### 5.2 `ApplicationState` の保存内容を読めなくする（中規模）

- **`plan` 列の暗号化。** `DurableStore`（`state.ts:393`）がDOへ送る前に `plan` をAES-GCMで暗号化し、`get` で復号します。鍵は `HKDF(SESSION_KEY, info='pkgfactory plan v1')`、AADは `planId:subject`。サイズ検査（100KB）は暗号化前に行います。DOはプラン本文を解釈しないので、`state.ts` のSQLは変わりません。
- **索引列のハッシュ化。** `subject` と `repository` は等値比較にしか使わないので、`HMAC(SESSION_KEY, 値)` に置き換えられます。ダンプ単体からユーザーIDとリポジトリ名が読めなくなります。`metadata` に残る `plan.repository` も同様に扱うか、`metadata` ごと暗号化します。
- **保存量の削減。** 生成ファイルは `planPackage(spec, {id, uuid, date})` で再生成できます（`validatePlan` がそうしています）。`files` を保存せず実行時に再生成すれば、1プランが数十KBから1KB程度になり、ダンプに含まれる文章量も減ります。
- **`paused` の保持上限。** 無期限保持は回復のためですが、例えば30日を超えた `paused` は `files` を落として `recoveryError: 'expired'` に縮退させ、ロックは保つ、といった上限を置けます。利用者はリポジトリを手動確認することになります。

これらは「A. ダンプだけ」の漏えいをゼロに近づけます。`SESSION_KEY` を一緒に取られれば読めるので、§5.1ほど強くはありません。

移行: 旧行は平文のままなので、`get` で「復号に失敗したら平文として読む」フォールバックを置き、次の `put` で暗号化します。`ApplicationState` の既存の移行コード（`state.ts:324-340`）と同じ考え方です。

### 5.3 GitHub Appへの移行で権限と寿命を縮める（大規模・最も効果が大きい）

OAuth Appの `repo` スコープを、GitHub Appのfine-grained permissionsに置き換えます。

- user-to-serverトークンは8時間で期限切れ、refresh tokenは6か月。実装は `expires_in` と `refresh_token` を扱う必要があります（現在は無視）。
- 必要になりそうな権限: Administration（リポジトリ作成、Deploy key、Pages）、Contents、Workflows、Secrets、Metadata、組織のMembers読み取り（オーナー判定に使う `/user/memberships/orgs`）。
- 利用者（または組織オーナー）がAppをアカウントに導入する手順が増えます。導入先を「All repositories」にすると新規リポジトリが自動で範囲に入ります。
- 効果: 漏えいしたトークンで触れるのはApp導入先の、許可した操作だけ。8時間で確実に無効。`AGENTS.md` の「Expire user access tokens」が実態と一致します。
- 要検証: 組織へのApp導入にオーナー承認が要ること、`POST /orgs/{org}/repos` がuser-to-serverトークンで動くこと、Pages APIの権限名。

これは「C. 稼働中Workerの乗っ取り」で唯一効く設計変更です。

### 5.4 運用面（小規模）

- GitHub environment `production` に必須レビュアーを設定する（`CLOUDFLARE_API_TOKEN` の使用に人の承認を挟む）。
- Cloudflareアカウントの2FAとAPIトークンの最小権限・期限設定。
- `SESSION_KEY` のローテーション手順と周期を `AGENTS.md` に書く（全員再ログインになる）。
- 利用者向けに「GitHubの設定 > Applications からPkgFactoryの認可を取り消せば、保存場所によらず全トークンが無効になる」ことをREADMEに書く。
- `sourceKey`（`limits.ts:4`）の `sha256(SESSION_KEY + ':' + ip)` は実害はありませんが、HKDFで専用鍵を派生する形に揃えると鍵の用途が混ざりません。

## 6. 進め方の提案

| 順 | 内容 | 規模 | 効果 |
|---|---|---|---|
| 1 | §5.1 セッション鍵の分割保持 | `auth.ts` + テスト、1 PR | B（ダンプ+secret）でトークンが出なくなる |
| 2 | `AGENTS.md` のOAuth App設定表を実態に合わせる | 文書のみ | 誤解の解消 |
| 3 | §5.2 プラン暗号化・索引ハッシュ化・`files` 非保存 | `state.ts` と `DurableStore`、移行、テスト | A（ダンプ）で個人情報が出なくなる |
| 4 | §5.4 運用 | 設定と文書 | Cの発生確率を下げる |
| 5 | §5.3 GitHub App移行 | 認証フロー全体、Node側の `--device` も再設計 | Cの被害範囲と寿命を縮める |

1と2は今すぐ着手できます。3は1と同じ鍵導出の仕組みを使うので続けて行うと楽です。5は別途、GitHub側の制約を検証してから判断してください。
