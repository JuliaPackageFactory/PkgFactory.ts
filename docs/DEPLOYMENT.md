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
Nodeのプランは `.tmp/e2e-state/journal.json`、planIdは各実行の `artifacts/github-e2e-*.json` に残します。
過去の3件作成の記録は `artifacts/github-e2e.json` として保持していますが、現行runnerは1件だけを作成・再開します。

```sh
npm run e2e -- --gh --resume-plan=PLAN_ID --confirm-resume
npx tsx scripts/install-key-poc.ts JuliaPackageFactory/TestYYYYMMDDHHMMSS.jl --confirm
```

後半のスクリプトはその実行で既に作成した1件に手動実行用Workflowを追加し、固定コミットのTagBotから
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

### 2.1 検証用OAuthアプリ（作成済み）

検証用 `PkgFactory Staging` は作成済みです。Client ID `Ov23li7iF0SLvIWtqPyX` を
検証用Worker設定へ反映しています。このアプリを作り直す必要はありません。
以下は設定値の確認と、別環境を用意する場合の手順です。

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
| Expire user access tokens | 有効（期限切れ時は再認可） |

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
本番Client IDは `env.production.vars.GITHUB_OAUTH_CLIENT_ID` に分けて設定しています。

**Client secretはチャットやGitへ貼らず、Cloudflareへ直接登録します。**

1. [Cloudflare Dashboard](https://dash.cloudflare.com/) を開きます。
2. **Workers & Pages → pkgfactory-staging → Settings → Variables and Secrets → Add** を開きます。
3. Typeを **Secret**、名前を **GITHUB_OAUTH_CLIENT_SECRET**、ValueをGitHubで生成したsecretにします。
4. 画面の **Add / Deploy** または保存ボタンで反映します。

`SESSION_KEY` はすでに登録済みです。GitHubのClient secretで上書きしないでください。
このステージングではClient IDとsecretの登録を確認し、受付を有効化しました。Web/MCPのログイン検証を進めています。
CLIで登録する場合のコマンドは次節にあります。

### 2.3 本番用OAuthアプリ（作成済み）

管理対象は `PkgFactory`（本番用）と `PkgFactory Staging`（検証用）の2つに整理します。
新しい本番用 `PkgFactory` のClient ID `Ov23liW9Mpoaeo70n071` は
`env.production.vars.GITHUB_OAUTH_CLIENT_ID` に反映済みです。本番配備・公開はまだ実施していません。
以下は設定値の確認と、別環境を用意する場合の手順です。
所有者をリポジトリと揃える場合は `JuliaPackageFactory` 組織を選びます。

1. [JuliaPackageFactoryのOAuth apps](https://github.com/organizations/JuliaPackageFactory/settings/applications)
   で **New OAuth App** を開きます。別の運営組織で管理する場合は、その組織の設定画面を使用します。
2. 次の値を入力します。

| GitHubの入力欄 | 本番用の入力値 |
|---|---|
| Application name | `PkgFactory` |
| Homepage URL | `https://pkgfactory.ohnolab.workers.dev/` |
| Application description（任意） | `Create Julia packages with PkgFactory` |
| Authorization callback URL 1 | `https://pkgfactory.ohnolab.workers.dev/auth/callback` |
| Authorization callback URL 2（Add callback URLで追加） | `https://pkgfactory.ohnolab.workers.dev/callback` |
| callbackのwildcard matching | 両方とも無効 |
| Enable Device Flow | 有効 |
| Expire user access tokens | 有効（期限切れ時は再認可） |

3. **Register application** を押します。表示された本番用Client IDを共有してください。
   こちらで `env.production.vars.GITHUB_OAUTH_CLIENT_ID` に設定します。
4. **Generate a new client secret** で本番用secretを作り、パスワードマネージャー等へ保存します。
   チャットやGitには貼りません。検証用secretとは別の値です。
5. 本番Worker `pkgfactory` の配備準備時に、そのWorkerの **Settings → Variables and Secrets** へ
   Type **Secret**、名前 **GITHUB_OAUTH_CLIENT_SECRET** で登録します。
   本番Workerはまだ未配備なので、この登録は配備準備の案内後に行います。

本番用secretを検証用Worker `pkgfactory-staging` に登録しないでください。
旧本番で使用中のOAuthアプリは、新版への切替が完了するまで残します。
不要アプリは表示名だけで判断せず、所有者・Client ID・callbackを照合してから整理します。

`repo workflow read:user read:org` を要求します。組織にOAuthアプリ制限がある場合は、そのアプリを承認します。
以前の認可で組織の読み取り権限が不足する場合は、Webの「Connect with GitHub」から再認可します。
OAuth AppのClient IDやsecretを作り直す必要はありません。
Webは認証後にプロフィールと作成先を読み込み、本人とactive/adminの組織を選択肢にします。
[組織membership API](https://docs.github.com/en/rest/orgs/members#list-organization-memberships-for-the-authenticated-user)
Client IDは変数、Client secretはWorker secretへ設定します。チャットやGitにsecretを貼らないでください。

## 3. Cloudflareステージング

2026-09-28時点で [pkgfactory-staging](https://pkgfactory-staging.ohnolab.workers.dev/health) は配備済みです。
新版専用のOAuth KV `PKGFACTORY_TS_STAGING_OAUTH`、SQLite DO、32バイトの `SESSION_KEY` secretを準備しました。
旧WorkerのKVやDOは流用していません。Client secret登録後、トップレベルの `MAINTENANCE=false` を配備し、受付を有効化しました。
本番の `env.production.vars.MAINTENANCE` は `true` のままです。

このステージングのClient ID/secretは設定済みです。以下はsecretを更新する場合のコマンドです。
既存のSESSION_KEYやKVを作り直す必要はありません。

```sh
npx wrangler secret put GITHUB_OAUTH_CLIENT_SECRET --config apps/cloudflare/wrangler.jsonc
```

登録後に `npm run check` → `npm run deploy:staging` を実行済みです。下記の受入検証を続けます。

MCPの対話検証は次のコマンドで起動します。表示されたlocalhost URLを通常のブラウザーで開き、
クライアントとGitHubの認可を行います。認証情報はプロセスのメモリだけに保持し、ファイルや標準出力へ出しません。

```sh
# 読み取り検証: 5ツールの確認と8同時プレビュー（3テンプレート）
npx tsx scripts/staging-mcp-e2e.ts
# 明示的な実リポジトリ作成: JuliaPackageFactory/TestYYYYMMDDHHMMSS.jl の1件（UTC）
npm run e2e:staging -- --template=simple --confirm-create-test-repository
# 途中停止した場合: 状態を再取得し、リース満了後に明示的に再開
npm run e2e:staging -- --resume-plan=PLAN_ID --confirm-resume
# 実HTTP切断後の停止確認→リース満了→照合→明示的再開（検証repoを1件作成）
npm run e2e:staging -- --template=simple --confirm-create-test-repository --confirm-disconnect-and-resume
```

認可入口は30分有効です。結果は `artifacts/staging-{mcp,disconnect,resume}-Test<日時>-<run ID>.json` に記録し、
認可の開始時にファイル名を表示します。過去の報告を上書きしません。
書き込みを自動再送しません。実行が停止したら結果に記録されたplanIdを確認してください。
MCPの同意フォームは、外部へのHTTPリダイレクトをCSPが遮断するブラウザーに対応するため、
同意後に遷移用HTMLを返します。`form-action 'self'` は維持します。
[MDNのform-action仕様説明](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Content-Security-Policy/form-action)

同意画面の `Referrer-Policy` は `same-origin` とします。`no-referrer` ではHTMLフォームのPOSTに
`Origin: null` が付いて正当な認可も拒否されるためです。他の応答は `no-referrer` を維持し、
`Origin: null` や異なるOrigin自体は引き続き拒否します。
[MDNのOriginへの影響](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Referrer-Policy#effect_on_the_origin_header)

GitHubがパスキーによる本人確認を求める場合、普段使っているChrome/Edge等でlocalhost入口から
認可を開始し、同じブラウザーで完了してください。OAuth Appへの権限付与はGitHubのAuthorizeで行います。
途中でcallback URLを別ブラウザーへコピーせず、入口からやり直します（stateはブラウザーに結び付いています）。

認証エラーは作成操作のresumeでは回復しません。新しい認可を開始します。
エラーの `code` が `oauth_client_credentials` なら、設定中のClient IDと同じOAuth AppのClient secretか確認します。
`oauth_redirect_uri` なら登録済みcallback URLを確認し、`oauth_code_invalid` なら期限切れ/使用済みコードなので入口からやり直します。
`oauth_scopes` ならrepo/workflow権限、`oauth_mcp_grant` ならMCPの認可保存処理を確認します。
トークン応答・秘密鍵・Client secret・認可コードはログにも診断表示にも含めません。

認可の失敗時は、まず保存状態と認可コードの期限切れを切り分けます。保存状態は10分で失効し、
GitHubのコードが失効していれば `oauth_code_invalid` になります。今回の `oauth_exchange_network` は、
待ち時間を入れないworkerd検証でも再現した実行環境の非互換が原因でした。
GitHubへの通信は `redirect: 'manual'` と3xxの拒否を用い、ネイティブfetchをクラスメソッドとして呼ばない実装に修正済みです。
Nodeのモックfetchだけでなく、workerdのRequest/fetchを通る回帰テストで確認します。

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

ステージングで `/health`、Web OAuth、MCP OAuth、選択したテンプレートの作成1件を確認します。
3テンプレートの継続的な生成検証には既存のTestMinimum.jl・TestSimple.jl・TestAllInOne.jlを使います。
[固定リポジトリE2Eの設定](TESTING.md) を参照してください。
WebとMCPで同じsubject・repositoryへの作成を競合させ、片方がロックで停止することを確認します。
作成中にHTTP接続を切り、GitHubの操作が止まること、リース後の明示的再開で回復することを確認します。
公開Edgeでの切断伝播と実CPU・メモリを確認します。今回の負荷測定は8同時プレビューと
3テンプレートの逐次作成でした。今後の作成受入は1回に1件とします。8件同時作成の最大容量は未実測なので、受入結果と区別して記録します。

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

ステージングは `ci.yml` が自動配備します。mainへのpushでNodeの3 OS・Juliaの3テンプレートの全CIが成功した後、
同じコミットを `staging` environmentの資格情報で配備し、`/health` の正常応答まで確認します。PRでは配備しません。
配備直前にmainの先頭SHAを照合し、古いCIの遅延完了による巻き戻しを防ぎます。配備は直列化し、実行途中で取り消しません。
資格情報が未登録の場合は `Deploy staging` が設定不足を明示して失敗します。登録後に失敗ジョブを再実行するか、mainでCIを手動実行できます。

### GitHub Actionsの配備設定

1. [CloudflareのAccount API tokens](https://dash.cloudflare.com/?to=/:account/api-tokens)で対象アカウントを選び、**Create Token → Permission policies → Custom → Edit Cloudflare Workers** を選びます。名前の例は `PkgFactory GitHub Actions`。対象アカウントをPkgFactoryの配備先だけに限定します。
2. [PkgFactory.tsのEnvironments](https://github.com/JuliaPackageFactory/PkgFactory.ts/settings/environments)で **staging** と **production** のそれぞれに、Environment secret **CLOUDFLARE_API_TOKEN** を登録します。同じCloudflareアカウントを使う現在の構成では、同じトークンを両環境に登録できます。GitHubのPATやGitHub OAuthのClient secretとは別の値です。
3. 両environmentのEnvironment variable **CLOUDFLARE_ACCOUNT_ID** に、配備先の32桁Account IDを登録します。両環境のdeployment branchは `main` に限定します。stagingは自動、本番は利用者が確認してからActionsを手動起動します。

ローカルの `wrangler login` の状態はGitHub Actionsに引き継がれません。CIではこの専用APIトークンを使います。
[Cloudflare公式のGitHub Actions認証手順](https://developers.cloudflare.com/workers/ci-cd/external-cicd/github-actions/)
既存Workerの `GITHUB_OAUTH_CLIENT_SECRET` と `SESSION_KEY` はWorker側に保持し、GitHubへコピーする必要はありません。

### ステージング確認後の本番反映

1. mainの **CI → Deploy staging** が成功した後、ステージングのWeb/MCPを確認します。
2. 確認したCIのURL `https://github.com/JuliaPackageFactory/PkgFactory.ts/actions/runs/<実行ID>` から数字の実行IDを控えます。
3. [Release (manual)](https://github.com/JuliaPackageFactory/PkgFactory.ts/actions/workflows/release.yml)の **Run workflow** を開き、branchは `main`、targetは `production`、confirmationは `publish`、staging_run_idは確認済みの実行IDを入力して起動します。
4. Actionsが、その実行のCI・実配備・health確認の成功を照合し、**その実行のコミットSHA** をcheckoutして本番を配備します。確認中にmainへ別の変更が入っても、指定したコミットが使われます。反映したSHAと参照したCIはActionsのSummaryに残ります。

失敗・実行中・PRのCIや、古いmainとして配備が省略されたCIは本番反映に使えません。
再実行されたCIは最新attemptの成功結果を照合します。本番も手動配備を直列化し、配備後の `/health` を確認します。
初回準備中の `MAINTENANCE=true` は正常なmaintenance応答として扱うため、このhealth確認だけで公開完了とは判定しません。

`release.yml` のtarget `staging` は手動再配備、`npm` はnpm公開用で、staging_run_idは不要です。
いずれもmainから確認欄 `publish` を入力して手動起動します。環境に承認者が設定されている場合はその承認も必要です。
WorkerのOAuth/SESSION secretsはWranglerで別途登録し、GitHub Workflowから表示しません。
本番のKV、OAuth/SESSION secrets、受付開始の設定は、以下の本番公開手順で準備してから利用します。

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
