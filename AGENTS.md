# PkgFactory 開発ガイド

保守者とコーディングエージェント向けです。利用者向けの説明は [README.md](README.md) にあります。

## 方針

サーバーに置く情報は最小限にします。

- サーバー（Durable Object、KV、ログ）に置くのは、GitHubから読み直せず、利用者側にも持たせられないものだけにする
- 置く場合は、個人情報とトークンを含まない形（ハッシュ、カウンター、期限）にする
- GitHubトークンは利用者側が持つ。Webは `SESSION_KEY` で暗号化したCookie、CLIはプロセスメモリ、MCPはクライアントのトークンでしか復号できないgrant
- 新しい状態を保存する前に、置かずに済む方法を先に検討する

サーバーに残る状態は、`AuthState` のログイン制限カウンター・使用済みOAuth `state`・ログアウト済みセッションIDのハッシュと、MCPのgrant（KV。クライアントのトークンでしか復号できない）だけです。
プランとジャーナルは保存しません。プレビューは純粋な計算で、作成は1回の要求の中で完了するか失敗し、再開機能はありません。

## 構成

npm workspacesで `packages/pkgfactory`（公開npmパッケージ）と `apps/cloudflare`（Worker）を管理します。

| パス | 責務 |
|---|---|
| `packages/pkgfactory/src/core` | 入力検証（Zod）、Mustacheによるファイル生成、プランの固定とハッシュ、名前規則、Markdownエスケープ |
| `packages/pkgfactory/src/github` | GitHub REST クライアント、Device Flow、Deploy key生成、Secretのsealed box、GitHub App導入状況 |
| `packages/pkgfactory/src/application` | `Factory`（プレビュー・作成） |
| `packages/pkgfactory/src/node` | CLI、ローカルWeb、資格情報の取得 |
| `packages/pkgfactory/src/web` | HTML、ブラウザー側スクリプト、`/api/*` ルート、共通のエラー応答 |
| `packages/pkgfactory/src/mcp` | MCPサーバー（stdio / Streamable HTTP） |
| `packages/pkgfactory/templates` | 3テンプレートの原本（58ファイル） |
| `apps/cloudflare/src` | Worker本体、OAuth、セッションCookie、`AuthState` Durable Object、レート制限、切断検出、テンプレート推薦 |
| `scripts` | ビルド、テンプレート埋め込み、E2E、配備確認 |
| `test` | Nodeテストとworkerdテスト |

`core`・`github`・`application` はNode固有APIを使わず、NodeとCloudflare Workersの両方で動きます。

### ビルド

`scripts/build.mjs` は次を行います。

1. `templates/` を `src/core/templates.json` に埋め込む（`scripts/templates.mjs`。Gitには含めない）
2. ブラウザー側スクリプト、CSS、画像を `src/web/assets.json` に埋め込む
3. `dist/cli.js`、`dist/index.js`、型定義、`apps/cloudflare/dist/worker.js` を生成する
4. `README.md` と `LICENSE` をパッケージへコピーする

`templates.json` は `npm ci`、`typecheck`、`test`、`e2e`、`build`、`npm pack` の前に自動生成されます。`tsx` でソースを直接実行する前には `npm run templates` を実行してください。

## プラン

`planPackage(spec)` は次を決めます。

- `id`: プランID（UUID）
- `uuid`: Project.tomlのUUID
- `createdAt`: 生成日時。ライセンス年とCITATIONの日付に使う
- `files`: 全ファイルの内容。`src/PKG.jl` と `examples/PKG.ipynb` はパッケージ名に置換する
- `digest`: `{spec, uuid, files}` のSHA-256
- `.pkgfactory.json`: 回復マーカー。`planId`、`digest`、`uuid`、`state`、Project.tomlのSHA-256を持つ

`validatePlan` は同じ入力と固定値から再生成して一致を確かめます。CLIの `--plan` はこの検証を通してから使います。
クライアントがプレビューから保持するのは設定と `{id, uuid, createdAt}`（`PlanReference`）だけです。作成時に `restorePlan(spec, reference)` が同じファイルを再生成するため、サーバーはプランを保存しません。

説明文は3通りに描画します。README向けはCommonMarkの記号をバックスラッシュでエスケープし、Documenter向けは固定の `@raw html` ブロック内のテキストとして `&<>` と記号をエンティティ化し、GitHubのdescriptionには原文を使います。

## 作成手順

`Factory.execute(plan, credentials, signal)` は1回の要求の中で次の順に進みます。ジャーナルは持ちません。

| 項目 | 値 |
|---|---|
| 実行全体の期限 | 120秒 |
| GitHub要求ごとの期限 | 30秒 |

1. `/user` を読み、`subject`（GitHubユーザーID）が資格情報の持ち主と一致することを確かめる。Nodeローカルアダプターはsubjectを `local` とし、この照合を省く
2. 作成先のオーナー権限と、リポジトリが存在しないことを確かめる。存在すれば `code: exists` で止まり、何も書かない
3. リポジトリを作成する（descriptionは利用者の入力）
4. Contents APIでREADMEを置き、`main` を初期化する。コミット名は `Using PkgFactory`
5. 全ファイルのtreeとコミットを作り、`main` を非強制で更新する。このコミットには `[skip ci]` を付ける。default branchが `main` でなければ変更する
6. トピック `julia`、`juliapackagefactory` を設定する
7. `simple` / `all-in-one` のみ: `gh-pages` ブランチ、Deploy key（書き込み可、タイトル `PkgFactory:<planId>`）、sealed boxで暗号化した `DOCUMENTER_KEY`、Pages（`gh-pages` の `/`）を設定する
8. 回復マーカー `.pkgfactory.json` の `state` を `complete` に更新する。このコミットでpush CIが1回起動する

結果にはリポジトリのURLと、Pagesを設定した場合はそのURL（`pagesUrl`）を含めます。

## 失敗時

通信例外、5xx、応答の読み取り失敗、429、切断、期限のいずれでも、以後のGitHub要求を送らず、`code: incomplete` のエラーで止まった段階とリポジトリのURLを返します。再開機能はありません。
送信済みの要求がGitHubで完了した可能性は残るため、利用者はリポジトリを確認し、未完成なら削除してから作り直します。回復マーカーの `state` が `complete` でなければ未完成です。

鍵はWeb Cryptoで生成し、Ed25519はOpenSSH形式、RSA-4096はPKCS#1 PEM形式に変換します。秘密鍵はメモリにだけ存在し、どこにも保存しません。
`DOCUMENTER_KEY` の値は秘密鍵PEMのBase64で、GitHubにはlibsodium互換のsealed boxで暗号化して送ります。

## Cloudflare Worker

`apps/cloudflare/src/worker.ts` が一つのWorkerでWebとMCPを提供します。

| パス | 内容 |
|---|---|
| `/` `/app.js` `/style.css` `/assets/*` | Web画面 |
| `/auth/login` `/auth/callback` `/auth/logout` | WebのGitHub OAuth |
| `/api/*` | Web API。セッションCookieとCSRFトークンが必要 |
| `/api/template-suggestion` | 説明文からのテンプレート推薦 |
| `/mcp` | MCP（Streamable HTTP）。OAuthのBearerトークンが必要 |
| `/authorize` `/oauth/token` `/oauth/register` `/callback` | MCPクライアント向けOAuth（`@cloudflare/workers-oauth-provider`） |
| `/health` | `{service, status}`。`status` は `ok` または `maintenance` |

### Webセッション

- ログイン開始時、`state`・PKCE verifier・10分の期限をAES-256-GCMで暗号化し、`__Host-pkgfactory-login` Cookieに置く
- コールバックでCookieと `state` の一致と期限を検証し、`state` のハッシュを `AuthState` で一度だけ消費してから、認可コードを交換する
- トークンのスコープに `repo` と `workflow` があることを確認し、`/user` でユーザーIDを得る
- セッション `{id, subject, token, csrf, expiresAt}` は `SESSION_KEY` でAES-256-GCM暗号化（AADは `web-session:<ORIGIN>`）し、Cookie `__Host-pkgfactory-session` にだけ置く。サーバーにセッションは保存しない。期限は1時間で、Cookieの `Max-Age` と暗号文内の `expiresAt` の両方で検証する
- 復号できないCookie（`SESSION_KEY` 変更後など）は未ログインとして扱う
- ログアウトはGitHubのトークンをOAuth AppのAPIで失効させ、セッションIDのハッシュを期限まで `AuthState` に記録して同じCookieの再利用を拒む

### MCP OAuth

- アクセストークンは1時間、refresh tokenは8時間。refresh時はGitHubの `/user` でユーザーIDの一致を確認する
- 同意画面はクライアント名、戻り先、ループバック・カスタムスキームの注意、CIMDクライアントのドメインを表示する
- 戻り先はHTTPS、ループバックへのHTTP、カスタムスキームに限る。動的登録と認可開始の両方で検査する
- JSON-RPCバッチと不正なJSONは400で拒否する。切断検出は `tools/call` 1件ごとに行う

### レート制限

| 対象 | キー | 上限 |
|---|---|---|
| `/auth/login` | 接続元 | 毎分20回（`AuthState` のカウンター） |
| 匿名ルート（OAuth関連と `/auth/*`） | 接続元 | 毎分120回（`SOURCE_RATE_LIMIT`） |
| `/oauth/register` | 接続元 | 上記に加えて毎分10回（`REGISTRATION_RATE_LIMIT`） |
| `/api/*` と `/mcp` | GitHubアカウント | 毎分120回（`ACCOUNT_RATE_LIMIT`） |

接続元はIPv4アドレスまたはIPv6 /64の鍵付きハッシュです。Workers Rate Limitingは拠点ごとの概算です。

### 切断検出

`/api/create` とMCPの `tools/call` は、応答を先に開き、50ms間隔と各GitHub要求の直前に空白を書き込んで接続を確かめます。
書き込みに失敗すると `AbortSignal` を発火し、以後のGitHub要求を止めます。
この応答ではHTTP 200のまま本文に `error`（MCPでは `isError`）が入ることがあります。

### 起動時の検査

`/health` 以外のルートは、次が揃っていなければ503を返します。

- `GITHUB_OAUTH_CLIENT_ID` と `GITHUB_OAUTH_CLIENT_SECRET`
- Base64で復号して32バイトになる `SESSION_KEY`
- 3つのレート制限バインディング

`MAINTENANCE=true` のとき、`/mcp` と `/api/create` は503を返します。

### ログ

Workers Logsにはイベント名・メソッド・パスだけを記録します（`rate_limited`、`origin_rejected`、`csrf_rejected`、`redirect_rejected`、`registration_rejected`、`github_revoke_failed`、`oauth_error`、`template_suggestion_failed`）。
invocationログは無効にし、URLのクエリ文字列は削除します。

### テンプレート推薦

`/api/template-suggestion` は `AI` バインディングで `typesafe/jev` の `choice` 質問を呼び、3テンプレートの選択と確率を返します。
`typesafe/jev` はサードパーティーモデルのため、AI GatewayのUnified Billingを使います（`gateway: {id: 'default', collectLog: false}`）。配備先アカウントにクレジットを追加してください。
ブラウザー側の要求は1ページあたり10回までです。失敗時は `template_suggestion_failed` イベントに `reason`、`upstreamStatus`、検証パスを記録します。

## 配備

設定は `apps/cloudflare/wrangler.jsonc` にあり、トップレベルがステージング、`env.production` が本番です。

| 環境 | Worker名 | URL |
|---|---|---|
| ステージング | `pkgfactory-staging` | https://pkgfactory-staging.ohnolab.workers.dev |
| 本番 | `pkgfactory` | https://pkgfactory.ohnolab.workers.dev |

| 種別 | 名前 | 内容 |
|---|---|---|
| var | `ORIGIN` | Workerの公開origin。Host・Origin・Cookieの検証に使う |
| var | `GITHUB_OAUTH_CLIENT_ID` | GitHub OAuth AppのClient ID |
| var | `KEY_ALGORITHM` | `ed25519`（既定）または `rsa4096` |
| var | `MAINTENANCE` | `true` で作成を止める |
| secret | `GITHUB_OAUTH_CLIENT_SECRET` | GitHub OAuth AppのClient secret |
| secret | `SESSION_KEY` | 乱数32バイトのBase64 |
| KV | `OAUTH_KV` | OAuth providerのクライアント・grant・トークン |
| Durable Object | `AUTH` (`AuthState`) | ログイン制限、state消費、ログアウト済みセッションIDのハッシュ。旧 `ApplicationState` クラスはmigration `v2` で削除済み |
| Rate limit | `SOURCE_RATE_LIMIT` `REGISTRATION_RATE_LIMIT` `ACCOUNT_RATE_LIMIT` | 上記のレート制限 |
| AI | `AI` | テンプレート推薦 |

`ratelimits` の `namespace_id` はCloudflareアカウント内で一意にし、ステージングと本番で別の値を使います。

### GitHub OAuth App

環境ごとに1つ作ります。

| 設定 | 値 |
|---|---|
| Homepage URL | Workerのorigin |
| Authorization callback URL | `<origin>/auth/callback`（Web）と `<origin>/callback`（MCP） |
| Enable Device Flow | 本番は無効。公開Client IDだけで開始でき、本番アプリ名を使ったフィッシングに使えるため |

OAuth Appのトークンは期限切れしません（期限付きトークンはGitHub Appの機能です）。Webのログアウトで失効させ、それ以外は利用者がGitHubの設定でアプリの認可を取り消します。

CLIの `--device` には、Device Flowを有効にした別のOAuth Appを使います。

### Secretの登録

ステージングはトップレベル、本番は `--env production` を付けます。付け忘れるとステージングを上書きします。

```sh
npx wrangler secret put GITHUB_OAUTH_CLIENT_SECRET --config apps/cloudflare/wrangler.jsonc --env production
node -e "process.stdout.write(require('node:crypto').randomBytes(32).toString('base64'))" \
  | npx wrangler secret put SESSION_KEY --config apps/cloudflare/wrangler.jsonc --env production
npx wrangler secret list --config apps/cloudflare/wrangler.jsonc --env production
```

`SESSION_KEY` は環境ごとに別の値を使います。変更すると既存のWebセッションは復号できなくなり、利用者はログインし直します。
新しい環境ではKVも作成し、返されたIDを `kv_namespaces[0].id` に設定します。

```sh
npx wrangler kv namespace create PKGFACTORY_TS_PRODUCTION_OAUTH --config apps/cloudflare/wrangler.jsonc --env production
```

### ワークフロー

| ワークフロー | 契機 | 内容 |
|---|---|---|
| `ci.yml` | PR、mainへのpush、手動 | Nodeテスト、workerdテスト、tarballの検証、3テンプレートのJulia実行。mainで全ジョブ成功後にステージングへ配備し、`/health` を確認する |
| `production.yml` | mainから手動 | 起動時点のmainがステージングへ配備済みかを `scripts/release-revision.ts` で照合してから本番へ配備し、`/health` を確認する |
| `release.yml` | mainから手動、確認欄に `publish` | `staging` の再配備、または `npm publish --provenance` |
| `template-repositories.yml` | mainのテンプレート関連変更、手動 | 固定3リポジトリの更新 |

ステージング配備は直前にmainの先頭が対象コミットのままであることを確認します。本番配備は `wrangler.jsonc` に `CONFIGURE_` が残っていればCloudflareへ接続する前に失敗します。

GitHubの `staging` / `production` environmentには、Cloudflareの **Edit Cloudflare Workers** 権限を持つAPIトークンを `CLOUDFLARE_API_TOKEN`（secret）、Account IDを `CLOUDFLARE_ACCOUNT_ID`（variable）として登録し、deployment branchを `main` に限定します。
`npm` environmentには承認者を設定し、npmのTrusted Publishingを `release.yml` と `npm` environmentに結び付けます。

ローカルから配備するには `npm run deploy:staging` / `npm run deploy:production` を使います。

## テスト

| 層 | コマンド | GitHubへの書き込み |
|---|---|---|
| 型検査 | `npm run typecheck` | なし |
| Nodeテスト | `npm test` | なし。GitHubは模擬サーバー（`test/fake-github.ts`）。鍵形式の検証に `ssh-keygen` が必要 |
| workerdテスト | `npm run test:worker` | なし。Miniflare上でWorker全体を実行する |
| tarball検証 | `node scripts/pack-smoke.mjs` | なし。`npm pack` の成果物をインストールしてCLI・stdio MCP・ローカルWebを起動する |
| 生成パッケージのJulia実行 | CI `generated-julia` ジョブ | なし。3テンプレートで `Pkg.test` とdocsビルドを行い、説明文が実行されないことを確認する |
| 固定リポジトリE2E | `npm run e2e:templates` | 既存3リポジトリへの差分commit/push |
| 作成の受入 | `npm run e2e`、`npm run e2e:staging` | 1回の実行で新規リポジトリ1件まで |

`npm run check` は型検査、Nodeテスト、ビルド、workerdテストをまとめて実行します。

Nodeテスト（`test/*.test.ts`）の対象: 説明文のエスケープと名前規則（`core`）、段階ごとの失敗・切断・他subject・既存リポジトリの拒否とプラン参照の再生成（`engine`）、プロフィールと組織オーナー判定（`github-context`）、ローカルWebとstdio MCP（`local`）、Streamable HTTP（`mcp-http`）、セッションCookie・同意画面・戻り先・PKCE（`auth`）、jsdomでのブラウザー側の挙動（`web-workflow`、`web-interactions`）、Jev応答の検証（`template-suggestion`）、本番配備前の照合（`release`）、ローカルGitでの固定リポジトリ更新（`e2e-repositories`）。

workerdテスト（`test/worker/*.test.ts`）の対象: テンプレート生成のNodeとの一致、鍵生成とsealed box、ルートとセッションCookie、OAuth PKCEとCSRF、切断後の停止、ネイティブfetchでのWeb/MCP認可と3テンプレートの作成（`runtime`）、ログインとアカウントのレート制限、`SESSION_KEY` の鍵長（`security`）。

### 固定リポジトリE2E

`scripts/template-repositories.ts` が3つの専用リポジトリを現在の生成器で更新します。

| テンプレート | リポジトリ |
|---|---|
| `minimum` | [ExampleMinimum.jl](https://github.com/JuliaPackageFactory/ExampleMinimum.jl) |
| `simple` | [ExampleSimple.jl](https://github.com/JuliaPackageFactory/ExampleSimple.jl) |
| `all-in-one` | [ExampleAllInOne.jl](https://github.com/JuliaPackageFactory/ExampleAllInOne.jl) |

- 既存のUUIDとGit履歴を維持し、日付はリポジトリの最初のコミットから取る
- 生成物にないファイルは削除する。回復マーカー `.pkgfactory.json` は含めない
- 生成内容が同じならコミットしない。コミット名は `Update <Package> from PkgFactory.ts <生成元SHA>`
- dirty checkout、別のパッケージ名、不正なUUID、remote mainの変化を検出すると停止する

```sh
npm run e2e:templates -- --gh                              # 読み取りのみ。生成内容を .tmp/template-repositories/ に出力
npm run e2e:templates -- --gh --publish                    # 3件を更新
npm run e2e:templates -- --gh --publish --package=ExampleSimple
```

結果は `artifacts/template-repositories*.json` に保存します。

GitHub Actionsの `Template E2E tests` は、mainへのテンプレート関連の変更で1件ずつ更新し、その後に公開用トークンを渡さずにJuliaのテストとdocsビルドを行います。有効化には次が必要です。

1. 対象3リポジトリに限定したfine-grained PAT（Contents: Read and write、Workflows: Read and write、Metadata: Read-only）をActions secret `PKGFACTORY_E2E_TOKEN` に登録する
2. Actions variable `PKGFACTORY_TEMPLATE_E2E_ENABLED` を `true` にする

### 作成の受入

新規作成は `JuliaPackageFactory/TestYYYYMMDDHHMMSS.jl`（UTC）を1回の実行で1件だけ作ります。失敗や結果不明も1件に数え、残ったリポジトリは手動で確認・削除します。

```sh
# Node（記録は artifacts/github-e2e-*.json）
npm run e2e -- --gh --template=simple --confirm-create-test-repository

# ステージングの公開MCP（OAuth認可をブラウザーで行う。引数なしでは8同時プレビューのみ）
npm run e2e:staging
npm run e2e:staging -- --template=all-in-one --confirm-create-test-repository
```

ステージングの記録は `artifacts/staging-mcp-*.json` に保存します。

Deploy keyの実機検証には、その実行で作ったリポジトリに手動実行のワークフローを追加し、TagBotのSSH設定とタグpushを実行します。

```sh
npx tsx scripts/install-key-poc.ts JuliaPackageFactory/TestYYYYMMDDHHMMSS.jl --confirm
npm run poc   # Ed25519 / RSA-4096 の鍵生成の計測
```

## 運用

- **メンテナンス:** `MAINTENANCE=true` で配備すると作成を止めます。この応答はGitHubの操作を始める前に返ります。
- **未完成のリポジトリ:** 作成が途中で止まると、`code: incomplete` のエラーが段階とURLを示します。サーバーに記録は残りません。利用者がリポジトリを確認し、削除してから作り直します。
- **認証エラー:** `code` が `oauth_client_credentials` ならClient IDとsecretの組、`oauth_redirect_uri` なら登録済みcallback URL、`oauth_code_invalid` ならコードの期限切れ・再利用、`oauth_scopes` なら `repo`/`workflow` の付与を確認します。
