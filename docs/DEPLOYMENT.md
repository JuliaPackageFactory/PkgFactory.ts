# 配備と切替手順

実装・ビルド・ローカル受入検証は実施済みです。本番公開、npm公開、旧リポジトリのアーカイブは未実施です。
先に [ACCEPTANCE.md](ACCEPTANCE.md) の未完了条件を解消してください。

## 1. GitHubのDeploy key許可

2026-09-28に組織所有者がDeploy keysを有効化し、停止していたsimple/all-in-oneの両プランを
明示的に再開して完了しました。検証結果は [ACCEPTANCE.md](ACCEPTANCE.md) に記録しています。
最初の実行で返された `Deploy keys are disabled for this repository` は組織ポリシーによるもので、鍵方式の非互換ではありませんでした。

組織所有者が [JuliaPackageFactory / Settings / Member privileges](https://github.com/organizations/JuliaPackageFactory/settings/member_privileges)
を開き、**Deploy keys → Enabled → Save** と設定します。組織全体への許可なので、実装作業から勝手に変更していません。
Enterprise管理下では上位ポリシーの変更も必要です。[GitHub公式手順](https://docs.github.com/en/enterprise-cloud@latest/organizations/managing-organization-settings/restricting-deploy-keys-in-your-organization)

設定後は既存のテストリポジトリを明示的に再開します。新規作成を繰り返す必要はありません。
この検証を実行したワークスペースには `.tmp/e2e-state/journal.json` と `artifacts/github-e2e.json` が残っています。

```sh
npm run e2e -- --confirm-create-test-repositories --resume-file=artifacts/github-e2e.json
npx tsx scripts/install-key-poc.ts JuliaPackageFactory/PkgFactoryPoc202609272136301.jl --confirm
npx tsx scripts/install-key-poc.ts JuliaPackageFactory/PkgFactoryPoc202609272136302.jl --confirm
```

後半のスクリプトは検証リポジトリに手動実行用Workflowを追加し、固定コミットのTagBotから
実際のSSH設定・Git pushを行います。登録処理やGitHub Releaseは作成せず、`pkgfactory-key-poc-RUN_ID` の検証タグを作ります。
同時にDocumenterのCIを再実行します。Documenterログで `DOCUMENTER_KEY` を使用したことを確認してください。

Ed25519がDocumenterまたはTagBotと非互換なら、エラーを記録してRSA-4096へ切り替えます。
新しいPoCプランを `--key-algorithm rsa4096` で作り、同じテストを通した後、
CLI既定値とWorker `KEY_ALGORITHM` をRSAへ合わせます。成功済みプランの `resume` は鍵を勝手に変更しません。
今回の両テンプレートの実機検証ではEd25519が成功したため、既定値をEd25519のまま採用しています。

## 2. GitHub OAuthアプリ

`-ts`・`-web`・`-mcp` はWorker名に不要です。WebとMCPは同じWorkerが提供し、パスで分けます。

| 用途 | URL |
|---|---|
| 本番Web（公開前） | `https://pkgfactory.ohnolab.workers.dev/` |
| 本番MCP（公開前） | `https://pkgfactory.ohnolab.workers.dev/mcp` |
| 検証Web | `https://pkgfactory-staging.ohnolab.workers.dev/` |
| 検証MCP | `https://pkgfactory-staging.ohnolab.workers.dev/mcp` |

本番URLは設定済みですが、公開はまだ実施していません。検証用の `-staging` は本番と区別するために残します。
旧検証Worker `pkgfactory-ts-staging` は短い名前への配備確認後に削除済みです。
旧版 `pkgfactory-web`・`pkgfactory-mcp` の切替・撤去は本番公開の承認後に行います。

### 2.1 今回作成するOAuthアプリ

今回は検証用を一つ作ります。本番用は公開前に別のアプリとして作成します。

1. GitHubで `JuliaPackageFactory` 組織の **Settings → Developer settings → OAuth apps → New OAuth App** を開きます。
   [組織のOAuthアプリ設定](https://github.com/organizations/JuliaPackageFactory/settings/applications)
2. 次の値を入力します。対象は **OAuth App** です。

| GitHubの入力欄 | 検証用の入力値 |
|---|---|
| Application name | `PkgFactory Staging` |
| Homepage URL | `https://pkgfactory-staging.ohnolab.workers.dev/` |
| Application description（任意） | `Julia package generator — staging` |
| Authorization callback URL 1 | `https://pkgfactory-staging.ohnolab.workers.dev/auth/callback` |
| Authorization callback URL 2（Add callback URLで追加） | `https://pkgfactory-staging.ohnolab.workers.dev/callback` |
| callbackのwildcard matching | 両方とも無効 |
| Enable Device Flow | 有効（ローカルCLIのDevice Flowでも使えるようにする） |

3. **Register application** を押します。作成後の画面で **Client ID** を控えます。
4. **Generate a new client secret** を押してsecretを生成します。再認証を求められた場合はGitHubで完了してください。

**以前の「callbackにルートURLを一つ登録する」という説明は訂正します。**
現在のGitHubはcallbackを複数登録でき、wildcard無効時は完全一致です。上記2つの実際のcallbackを登録します。
ルートURLだけの登録やwildcard有効化は不要です。
[GitHubの作成手順](https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/creating-an-oauth-app)・
[callback/PKCE仕様](https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/authorizing-oauth-apps#redirect-urls)

`Expire user access tokens` が表示される場合は、有効のままで構いません。
現実装はGitHub tokenを自動更新せず、期限切れ時にログアウト・再認可します。Webセッションの上限も8時間です。

### 2.2 Client IDとsecretの登録先

**Client IDは公開識別子なのでチャットで共有できます。**
受け取ったIDを `apps/cloudflare/wrangler.jsonc` のトップレベル `GITHUB_OAUTH_CLIENT_ID` に設定します。
本番用の `env.production` はまだ変更しません。

**Client secretはチャットやGitへ貼らず、Cloudflareへ直接登録します。**

1. [Cloudflare Dashboard](https://dash.cloudflare.com/) を開きます。
2. **Workers & Pages → pkgfactory-staging → Settings → Variables and Secrets → Add** を開きます。
3. Typeを **Secret**、名前を **GITHUB_OAUTH_CLIENT_SECRET**、ValueをGitHubで生成したsecretにします。
4. 画面の **Add / Deploy** または保存ボタンで反映します。

`SESSION_KEY` はすでに登録済みです。GitHubのClient secretで上書きしないでください。
Client IDの共有とsecretの登録が終われば、こちらで設定を配備してWeb/MCPのログイン検証へ進めます。
CLIで登録する場合のコマンドは次節にあります。

### 2.3 公開前に作成する本番用アプリ

Application nameは `PkgFactory`、Homepage URLは `https://pkgfactory.ohnolab.workers.dev/`、
callbackは `https://pkgfactory.ohnolab.workers.dev/auth/callback` と
`https://pkgfactory.ohnolab.workers.dev/callback` にします。
本番用のClient ID/secretは本番Workerへ登録し、検証用と分けます。

`repo workflow read:user` を要求します。組織にOAuthアプリ制限がある場合は、そのアプリを承認します。
Client IDは変数、Client secretはWorker secretへ設定します。チャットやGitにsecretを貼らないでください。

## 3. Cloudflareステージング

2026-09-28時点で [pkgfactory-staging](https://pkgfactory-staging.ohnolab.workers.dev/health) は配備済みです。
新版専用のOAuth KV `PKGFACTORY_TS_STAGING_OAUTH`、SQLite DO、32バイトの `SESSION_KEY` secretを準備しました。
旧WorkerのKVやDOは流用していません。`MAINTENANCE=true` とOAuth未設定時の503で受付を停止しています。

このステージングでは `apps/cloudflare/wrangler.jsonc` のトップレベル `GITHUB_OAUTH_CLIENT_ID` を設定し、
次のsecretを登録してください。既存のSESSION_KEYやKVを作り直す必要はありません。

```sh
npx wrangler secret put GITHUB_OAUTH_CLIENT_SECRET --config apps/cloudflare/wrangler.jsonc
```

Client ID/secretを設定した後、トップレベル `MAINTENANCE` を `false` に変更し、
`npm run check` → `npm run deploy:staging` を実行して、下記の受入検証を行います。

別アカウントや新環境を準備する場合のみ、以下の初期設定を実施します。
Workers PaidとDurable Objectsを使えるアカウント、Workers/KV/DOを配備できる認証が必要です。
`ORIGIN`、`GITHUB_OAUTH_CLIENT_ID`、KV IDをその環境の実値へ変更します。

```sh
npm ci
npm run check
node scripts/pack-smoke.mjs
npx wrangler login
npx wrangler kv namespace create PKGFACTORY_TS_STAGING_OAUTH --config apps/cloudflare/wrangler.jsonc
```

返されたIDをトップレベルの `kv_namespaces[0].id` に入れます。

```sh
npx wrangler secret put GITHUB_OAUTH_CLIENT_SECRET --config apps/cloudflare/wrangler.jsonc
npx wrangler secret put SESSION_KEY --config apps/cloudflare/wrangler.jsonc
```

新環境の `SESSION_KEY` は暗号学的乱数32バイトのBase64文字列です。パスワードマネージャーで生成・保管し、
secret入力プロンプトへ渡してください。CLIで生成するなら
`node -e "console.log(require('node:crypto').randomBytes(32).toString('base64'))"` を手元で実行します。
キー変更は既存Webセッションを復号できなくするため、ログインし直しが必要です。

```sh
npx wrangler deploy --config apps/cloudflare/wrangler.jsonc --dry-run
npm run deploy:staging
```

ステージングで `/health`、Web OAuth、MCP OAuth、3テンプレートの作成を確認します。
WebとMCPで同じsubject・repositoryへの作成を競合させ、片方がロックで停止することを確認します。
作成中にHTTP接続を切り、GitHubの操作が止まること、リース後の明示的再開で回復することを確認します。
本番Edgeでの切断伝播、実CPU・メモリ、8件同時作成の計測はこの段階の受入条件です。

## 4. npm公開準備

`juliapackagefactory` npm organizationの公開権限を用意します。
パッケージは `@juliapackagefactory/pkgfactory` の一つだけです。
GitHub Actionsの環境 `npm` に承認者を設定し、npmのTrusted Publishingを
リポジトリ `JuliaPackageFactory/PkgFactory.ts`、Workflow `release.yml`、environment `npm` に結び付けます。
初回公開でTrusted Publishingを設定できない場合は、管理者の対話 `npm login` から初回公開します。

```sh
npm run build
npm pack --workspace @juliapackagefactory/pkgfactory
# 成果物レビュー・公開承認後にのみ実行
npm publish --workspace @juliapackagefactory/pkgfactory --access public
```

`release.yml` は手動実行専用です。targetを `staging`・`production`・`npm` から選び、
確認欄 `publish` と環境承認を経て実行します。Cloudflare用環境には
secret `CLOUDFLARE_API_TOKEN`、variable `CLOUDFLARE_ACCOUNT_ID` を設定します。
WorkerのOAuth/SESSION secretsはWranglerで別途登録し、GitHub Workflowから表示しません。

## 5. 本番公開前に提示するもの

完成したコード/PR、固定依存lockfile、npm tarball、CI結果、3テンプレートの作成・再開・Documenter公開URL、
Ed25519またはRSAのTagBot PoCログ、ステージングWeb/MCP OAuthの結果、Edge切断テストと負荷計測です。
この一覧を確認した承認の後だけ本番公開を行います。

1. 旧 `pkgfactory-web` と `pkgfactory-mcp` の新規作成受付を止める。
2. 旧版の実行中操作と残存ロックをGitHub状態と照合する。未解決操作を新版で自動再実行しない。
3. 新版の本番専用KV・OAuth・SESSION secretsを設定し、`--env production` で配備する。
   既定 `MAINTENANCE=true` のため書込みは停止したまま。
4. 旧Web/MCPの案内URLを新版originと `/mcp` へ更新する。旧grant・プレビューの引継ぎは行わず再認可する。
   MCPのPOSTをHTTPリダイレクトで移転させない。
5. 新版 `MAINTENANCE=false` を設定・配備し、確認済み検証プランで疎通を確かめる。
6. 旧Juliaコンテナと専用設定を撤去する。旧DOやKVを削除する前に残存操作の照合を終える。
7. 旧READMEの参照先更新と最終状態を提示し、アーカイブ承認後に `PkgFactory.jl` をアーカイブする。

観察期間を設ける手順は含めていません。旧URLやAPIの完全互換も対象外です。
新版に問題がある場合は `MAINTENANCE=true` に戻し、150秒以上待ってGitHub状態を照合します。
中断ジャーナルを残したまま、直前の正常な新版Worker versionへ戻して明示的に再開します。

## 残存ロックの運用

通常は `status` → リース終了確認 → `resume` で完了します。認証主体・マーカー・Project.tomlが一致しなければ
再開は拒否されます。その場合、リポジトリ内容を手動確認し、意図しない既存リポジトリを上書きしないでください。
ロックを削除するだけのHTTP APIはありません。
ローカルの `journal.lock` は短いファイル更新の排他です。記録されたPIDが終了していることを確認できた場合のみ
このファイルを取り除けます。操作状態を保存した `journal.json` の削除ではありません。
