# PkgFactory

TypeScriptでJuliaパッケージを作る、Web・CLI・MCP共通の生成エンジンです。
サービス名は **PkgFactory**、CLIは **pkgfactory**、公開npm名は
**@juliapackagefactory/pkgfactory** です。Node.js **24 LTS** を使用します。
サービスの実行にJulia、Docker、Git、OpenSSHは不要です。`gh` は任意の認証補助です。

## ローカルで使う

公開後のインストール:

```sh
npm install -g @juliapackagefactory/pkgfactory@0.1.0
pkgfactory templates
pkgfactory preview --spec package.json --out plan.json
pkgfactory create --plan plan.json --yes --gh
pkgfactory status --plan-id PLAN_UUID --gh
pkgfactory resume --plan-id PLAN_UUID --yes --gh
pkgfactory web --gh
pkgfactory mcp --stdio
```

まだnpm公開は実施していません。現時点ではこのチェックアウトで `npm ci && npm run build`
の後、`node packages/pkgfactory/dist/cli.js` を使うか、
`npm pack --workspace @juliapackagefactory/pkgfactory` のtarballをインストールしてください。

設定ファイルの例:

```json
{
  "owner": "YourGitHubOwner",
  "name": "MyPackage",
  "authors": ["Your Name"],
  "description": "My Julia package",
  "template": "simple",
  "visibility": "public"
}
```

| テンプレート | 内容 |
|---|---|
| `minimum` | パッケージ、テスト、CI |
| `simple` | 上記＋Documenter、TagBot |
| `all-in-one` | 上記＋Aqua、JET、書式検証、引用情報、ノートブック |

どのテンプレートでも、作成したGitHubリポジトリに `julia` トピックを自動付与します。再開時も既存のトピックを保持します。

CLIのプレビューはオフラインで動作し、UUIDと全ファイルの内容を固定します。
作成には確認済みプランと `--yes` が必要です。再開では設定の再入力やUUIDの再生成をしません。
状態は既定で `~/.pkgfactory` に保存します。`--state-dir` または `PKGFACTORY_STATE_DIR` で変更できます。
同じ状態ディレクトリを使えばCLI・Web・stdio MCP間で状態を共有できます。

## 認証

- ローカル: `GITHUB_TOKEN` → `GH_TOKEN` の順。明示した場合だけ `--gh` で `gh auth token` を使用。
- Device Flow: Device Flowを有効にしたOAuth AppのClient IDを `PKGFACTORY_GITHUB_CLIENT_ID` に設定して `--device`。認証後のトークンはプロセス内だけに保持。
  公開Web・MCPの本番用OAuth AppはDevice Flowを無効にしているため使えません。CLI用には別のOAuth Appを用意してください。
- stdio MCP: PATまたは `--gh`。対話ログインは開始しません。`--read-only` で作成・再開ツールを非公開にできます。
- 公開Web: GitHub OAuth認可コード＋S256 PKCE。HttpOnly・Secure・SameSite Cookie。
- 公開MCP: OAuth 2.1、S256 PKCE、GitHubへの上流認可。GitHub PATをMCPのBearerとして受け付けません。

GitHubのclassic PAT/OAuthは `repo`・`workflow` が必要です。Webでのプロフィール・組織一覧には `read:user`・`read:org` も要求します。組織側のOAuth承認とDeploy key許可も確認してください。
Fine-grained PATでは対象リポジトリの作成、Administration、Contents、Workflows、Secrets、Pagesの権限が必要です。
ローカルWebは `127.0.0.1` のみで待受し、Host・Origin・CSRFを検証します。

Web画面は旧版の認証から始まる手順、ロゴ、配色を引き継いでいます。
認証後に個人アカウントとオーナー権限のある組織を選択でき、著者名はGitHubの表示名（未設定ならlogin）から補完されます。
入力中とプレビュー保存時に、名前の形式・作成先の権限・既存リポジトリの有無を確認します。
名前は5〜100文字のASCII英数字で、先頭は大文字、小文字を1文字以上含めます。`Julia`／`julia`を含む名前、`Ju`で始まる名前、`jl`で終わる名前は受け付けません。
これらは[Julia版の検証規則](https://github.com/JuliaPackageFactory/PkgFactory.jl/blob/6cf2962ceab3e7ee3662d5bb980960fbb434a5f9/src/verification.jl)に合わせています。Webでは`.jl`を入力した場合だけ、自動付加される旨を警告します。API・CLI・MCPでは従来どおり`.jl`付きの入力も正規化します。
作成時にも権限を確認します。組織のポリシーやトークンの権限によってGitHubが作成を拒否する場合は、その結果を表示します。
既存リポジトリへ新規作成はしません。Webの再開フォームは一時非表示です。保存済みplanIdによる状態確認・再開はCLI・MCP・APIで引き続き利用できます。

Webは完了したセクションを緑、次のセクションを紫のREADYで表示します。著者名のカンマ・セミコロンは改行に変換します。
テンプレートは未選択で始まり、入力が揃うと入力中の操作を妨げずに自動設定へ案内します。レビュー生成で続けて画面を移動せず、閲覧中のファイルとスクロール位置を保ちます。Documenter・TagBot・Codecovの行は選択にかかわらず表示します。
WebのSimple／All-in-oneでは、Codecovの導入確認が済むまで第4セクションをREADY、第5セクションをUPCOMINGに保ちます。GitHubで導入済みと確認できるか、確認不能の場合に手動でチェックするとレビューを自動生成します。チェックを外すと作成確認も解除されます。作成中はスピナー・進行バー・経過時間を表示します。
作成後はプレビューを残したまま、第6セクションにリポジトリへのリンクと、Actions・ドキュメント・必要なCodecov設定・General登録の案内をリンク付きの文章で表示します。
MinimumではDocumenter・TagBot・Codecovを緑の「NOT INCLUDED」で表示し、App確認とインストール操作を省きます。Codecovのインストール状況は、GitHubが読み取りを許可する組織で確認します。
現在のOAuth認証では個人アカウントの他社App一覧を取得できず、組織も権限により確認できない場合があります。その場合はGitHubで確認し、画面で確認済みにできます。
「Installed」はオーナーへのインストールを表し、選択したリポジトリだけにアクセスを許可する場合は作成後に追加が必要です。GitHubの設定リンクから戻ると状態を自動再確認します。
Privateを選んだ場合はDocumenterの利用条件と公開範囲への案内を表示します（Minimumは対象外）。
認証切れの際は再接続を案内し、同じアカウントで戻れば入力設定を復元します。確認チェックや作成要求は復元しません。作成に失敗した場合は同じ要求の再送を止め、再開設計は[Issue #5](https://github.com/JuliaPackageFactory/PkgFactory.ts/issues/5)で検討します。

## MCPとAPI

MCPツールは `list_templates`、`preview_package`、`create_package`、`repository_status`、
`resume_package`。作成・再開には保存済み `planId` と `confirm: true` が必要です。
クライアント設定は [examples/mcp.json](examples/mcp.json) を参照してください。
公開MCPのURLは設定したWorker originの `/mcp` です。

```ts
import { Factory, MemoryStore } from '@juliapackagefactory/pkgfactory';
const factory = new Factory(new MemoryStore());
const plan = await factory.preview({owner: 'YourGitHubOwner', name: 'MyPackage', authors: ['You']}, githubUserId);
// 確認したプランに対してのみ実行する
await factory.execute(plan.id, {subject: githubUserId, token: githubToken}, false, signal);
```

`MemoryStore` は埋め込み用です。プロセス再起動を跨ぐ利用は永続ストアを渡してください。
公開Web・MCPは同じDurable Objectの排他制御を使います。

## 中断と再開

GitHubへの書き込みは送信前に操作ジャーナルへ記録し、自動再送しません。
切断・120秒の実行期限・30秒の個別要求期限で以後のGitHub操作を停止します。
既に送信した操作の取り消しは保証できないため、結果不明ならロックを残します。
`status` でGitHubを確認し、記録された150秒のリース期限後に `resume` を明示的に呼びます。
再開時にもリポジトリID・回復マーカー・Project.tomlを照合し、既存変更を強制上書きしません。

秘密鍵は保存しません。Secret登録の結果が不明な場合、明示的再開で新しい鍵ペアを生成し、
登録成功後にそのプランが作った古い鍵のみ削除します。既存のユーザー鍵は対象外です。
Deploy keyの既定値はEd25519。`--key-algorithm rsa4096` / Workerの `KEY_ALGORITHM=rsa4096` で切替可能です。

## 開発・配備

```sh
npm ci
npm run check
node scripts/pack-smoke.mjs
npm run poc
# 既存の固定3リポジトリを読み取り、更新内容をローカルに生成
npm run e2e:templates -- --gh
# 新規作成が必要な検証だけ、1回に1件
npm run e2e -- --gh --template=simple --confirm-create-test-repository
```

通常のテンプレートE2Eは既存の `ExampleMinimum.jl`・`ExampleSimple.jl`・`ExampleAllInOne.jl` を継続更新します。
新規作成E2Eは `JuliaPackageFactory/TestYYYYMMDDHHMMSS.jl`（UTC）の1件だけです。
テンプレートを選択して実行し、途中停止時は保存済みplanIdを明示的に再開します。自動削除はしません。
OpenSSHとJuliaは開発時の鍵PoC・生成パッケージ検証にのみ使用します。

- [構成と安全な再開](docs/ARCHITECTURE.md)
- [固定リポジトリのE2E・CI設定](docs/TESTING.md)
- [配備・外部設定・切替手順](docs/DEPLOYMENT.md)
- [実施した検証と未完了の受入条件](docs/ACCEPTANCE.md)

旧PkgFactory.jlの `7c7d4af` にある58ファイルを参照しています。旧リポジトリは変更していません。
旧API・CLI・生成物の完全互換や移行ガイドは対象外です。
