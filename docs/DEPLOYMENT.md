# 配備

公開Web・MCPは一つのCloudflare Workerです。設定は `apps/cloudflare/wrangler.jsonc` にあり、トップレベルがステージング、`env.production` が本番です。

| 環境 | Worker名 | URL |
|---|---|---|
| ステージング | `pkgfactory-staging` | https://pkgfactory-staging.ohnolab.workers.dev |
| 本番 | `pkgfactory` | https://pkgfactory.ohnolab.workers.dev |

MCPのエンドポイントは各originの `/mcp` です。

## Workerの設定

| 種別 | 名前 | 内容 |
|---|---|---|
| var | `ORIGIN` | Workerの公開origin。Host・Origin・Cookieの検証に使う |
| var | `GITHUB_OAUTH_CLIENT_ID` | GitHub OAuth AppのClient ID |
| var | `KEY_ALGORITHM` | `ed25519`（既定）または `rsa4096` |
| var | `MAINTENANCE` | `true` で `/mcp`・`/api/create`・`/api/resume` を503にする |
| secret | `GITHUB_OAUTH_CLIENT_SECRET` | GitHub OAuth AppのClient secret |
| secret | `SESSION_KEY` | 乱数32バイトのBase64。セッションの暗号化と署名、接続元ハッシュの鍵 |
| KV | `OAUTH_KV` | `@cloudflare/workers-oauth-provider` のクライアント・grant・トークン |
| Durable Object | `STATE` (`ApplicationState`) | プランとジャーナル（SQLite） |
| Durable Object | `AUTH` (`AuthState`) | セッション、ログイン制限、state消費（SQLite） |
| Rate limit | `SOURCE_RATE_LIMIT` | 匿名ルート、接続元ごと毎分120回 |
| Rate limit | `REGISTRATION_RATE_LIMIT` | `/oauth/register`、接続元ごと毎分10回 |
| Rate limit | `ACCOUNT_RATE_LIMIT` | `/api/*` と `/mcp`、GitHubアカウントごと毎分120回 |
| AI | `AI` | テンプレート推薦（`typesafe/jev`） |

`ratelimits` の `namespace_id` はCloudflareアカウント内で一意にします。ステージングと本番で別の値を使います。
`observability` はWorkers Logsを有効にし、invocationログを無効、クエリ文字列を削除する設定です。

Secretが欠けている、`SESSION_KEY` が32バイトでない、レート制限バインディングがない場合、Workerは `/health` 以外に503を返します。

## GitHub OAuth App

環境ごとに1つ作ります。

| 設定 | 値 |
|---|---|
| Homepage URL | Workerのorigin |
| Authorization callback URL | `<origin>/auth/callback`（Web）と `<origin>/callback`（MCP）の2つ |
| Enable Device Flow | 本番は無効。公開Client IDだけで開始でき、本番アプリ名を使ったフィッシングに使えるため |
| Expire user access tokens | 有効 |

Workerは `repo workflow read:user read:org` を要求します。組織でOAuth Appの制限を有効にしている場合は、そのアプリを承認します。
Workerはrefresh tokenを保存せず、GitHubトークンを自動更新しません。期限切れ時は再認可します。

CLIの `--device` に使うOAuth Appは、Device Flowを有効にした別のアプリにします。

## Secretの登録

ステージングはトップレベル、本番は `--env production` を付けます。付け忘れるとステージングを上書きします。

```sh
npx wrangler secret put GITHUB_OAUTH_CLIENT_SECRET --config apps/cloudflare/wrangler.jsonc --env production
node -e "process.stdout.write(require('node:crypto').randomBytes(32).toString('base64'))" \
  | npx wrangler secret put SESSION_KEY --config apps/cloudflare/wrangler.jsonc --env production
npx wrangler secret list --config apps/cloudflare/wrangler.jsonc --env production
```

`SESSION_KEY` は環境ごとに別の値を使います。変更すると既存のWebセッションは復号できなくなり、利用者はログインし直します。保存済みのプランやMCPのgrantには影響しません。

新しい環境ではKVも作成し、返されたIDを `kv_namespaces[0].id` に設定します。

```sh
npx wrangler kv namespace create PKGFACTORY_TS_PRODUCTION_OAUTH --config apps/cloudflare/wrangler.jsonc --env production
```

## 配備の流れ

| ワークフロー | 契機 | 内容 |
|---|---|---|
| `ci.yml` | PR、mainへのpush、手動 | Nodeテスト、workerdテスト、tarballの検証、3テンプレートのJulia実行。mainで全ジョブ成功後にステージングへ配備し、`/health` を確認する |
| `production.yml` | mainから手動 | 起動時点のmainがステージングへ配備済みかを `scripts/release-revision.ts` で照合してから本番へ配備し、`/health` を確認する |
| `release.yml` | mainから手動、確認欄に `publish` | `staging` の再配備、または `npm publish --provenance` |
| `template-repositories.yml` | mainのテンプレート関連変更、手動 | 固定3リポジトリの更新（[TESTING.md](TESTING.md)） |

ステージング配備は、配備直前にmainの先頭が対象コミットのままであることを確認し、古い実行が新しい配備を巻き戻さないようにします。
本番配備は `wrangler.jsonc` に `CONFIGURE_` が残っていればCloudflareへ接続する前に失敗します。

GitHubの `staging` / `production` environmentには、Cloudflareの **Edit Cloudflare Workers** 権限を持つAPIトークンを `CLOUDFLARE_API_TOKEN`（secret）、Account IDを `CLOUDFLARE_ACCOUNT_ID`（variable）として登録し、deployment branchを `main` に限定します。
`npm` environmentには承認者を設定し、npmのTrusted Publishingをこのリポジトリの `release.yml` と `npm` environmentに結び付けます。

ローカルから配備するには `npm run deploy:staging` / `npm run deploy:production` を使います。

## テンプレート推薦

Webの説明文からテンプレートを推薦する機能は、`AI` バインディングで `typesafe/jev` の `choice` 質問を呼びます。
`typesafe/jev` はサードパーティーモデルのため、AI GatewayのUnified Billingを使います。配備先アカウントにクレジットを追加してください。
呼び出しは `gateway: {id: 'default', collectLog: false}` で行い、`default` Gatewayは初回要求時に自動作成されます。

推薦の要求はブラウザー側で1ページあたり10回までです。失敗時は `template_suggestion_failed` イベントに `reason`、`upstreamStatus`、検証パスを記録し、説明文と応答本文は記録しません。
ローカルWebにはAIバインディングがないため、この機能はありません。

## 運用

**メンテナンス:** `MAINTENANCE=true` で配備すると作成と再開を止めます。この応答はGitHubの操作を始める前に返るため、リポジトリは作られません。

**残存ロック:** 中断した操作は `status` で照合し、リース期限後に `resume` で再開します。マーカーやProject.tomlが一致しない場合は再開を拒否するので、リポジトリを手動で確認します。ロックだけを削除するAPIはありません。
ローカルの `journal.lock` はファイル更新の短い排他で、記録されたPIDが終了していることを確認できた場合にだけ取り除けます。`journal.json` は削除しません。

**ログ:** Cloudflare DashboardのWorkers Logsで、[ARCHITECTURE.md](ARCHITECTURE.md) に挙げたイベント名を確認できます。

**認証エラーの切り分け:** エラーの `code` が `oauth_client_credentials` ならClient IDとsecretの組、`oauth_redirect_uri` なら登録済みcallback URL、`oauth_code_invalid` ならコードの期限切れ・再利用、`oauth_scopes` なら `repo`/`workflow` の付与を確認します。
