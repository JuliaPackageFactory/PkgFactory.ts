# PkgFactory

GitHubにJuliaパッケージのリポジトリを作り、CI・ドキュメント・リリース自動化まで設定するツールです。
TypeScriptで書かれた一つの生成エンジンを、CLI・Web・MCPサーバーから共通に使います。

| 名前 | 値 |
|---|---|
| サービス名 | PkgFactory |
| CLI | `pkgfactory` |
| npmパッケージ | `@juliapackagefactory/pkgfactory`（未公開） |
| 公開Web / MCP | https://pkgfactory.ohnolab.workers.dev / 同origin の `/mcp` |
| 実行環境 | Node.js 24 |

Julia、Docker、Git、OpenSSHは不要です。GitHubへの操作はすべてREST APIで行います。

## インストール

```sh
npm ci
npm run build
node packages/pkgfactory/dist/cli.js --help
```

`npm pack --workspace @juliapackagefactory/pkgfactory` で作ったtarballを `npm install` しても同じです。

## CLI

```sh
pkgfactory templates                                   # テンプレート一覧
pkgfactory preview --spec package.json --out plan.json # オフラインで生成内容を固定
pkgfactory create --plan plan.json --yes --gh          # プランどおりに作成
pkgfactory create --spec package.json --yes --gh       # プレビューを省いて作成
pkgfactory web --gh                                    # ローカルWeb（127.0.0.1:8787）
pkgfactory mcp --stdio                                 # stdio MCPサーバー
```

`--spec` に渡す設定ファイルの例（[examples/package.json](examples/package.json)）:

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

| 項目 | 内容 |
|---|---|
| `owner` | 自分のアカウント、またはオーナー権限を持つ組織 |
| `name` | パッケージ名。リポジトリ名は `<name>.jl` |
| `authors` | 1〜20名 |
| `description` | 省略可。READMEとdocsにはエスケープして埋め込み、GitHubのdescriptionには原文を使う |
| `template` | `minimum` / `agentic` / `simple` / `all-in-one`（既定 `simple`） |
| `visibility` | `public` / `private`（既定 `public`） |

パッケージ名の規則は[PkgFactory.jl](https://github.com/JuliaPackageFactory/PkgFactory.jl/blob/6cf2962ceab3e7ee3662d5bb980960fbb434a5f9/src/verification.jl)と同じです。
5〜100文字のASCII英数字、先頭は大文字、小文字を1文字以上含み、`Julia`/`julia` を含まず、`Ju` で始まらず、`jl` で終わらないこと。末尾の `.jl` はAPI・CLI・MCPでは取り除いて受け付けます。

`preview` はネットワークなしで動き、プランID・パッケージUUID・全ファイルの内容を固定します。
`create --plan` は保存したプランを再生成して一致を確かめてから作成し、`--yes` を要求します。
状態はどこにも保存しません。

## テンプレート

| テンプレート | 内容 |
|---|---|
| `minimum` | パッケージ本体、テスト、CI |
| `agentic` | `minimum` ＋ Aqua、JET、ExplicitImports、Runic書式検査、doctest、CITATION.cff、Issue/PRテンプレート、Dependabot、TagBot、AIコーディングエージェント向けの `AGENTS.md`（ドキュメントサイトなし） |
| `simple` | `minimum` ＋ Documenter、TagBot、Codecov |
| `all-in-one` | 上記 ＋ Aqua、JET、ExplicitImports、Runic書式検査、CITATION.cff、Issue/PRテンプレート、Dependabot、ノートブック、`AGENTS.md` |

`simple` と `all-in-one` では、作成時にDeploy keyと `DOCUMENTER_KEY` Secretを登録し、`gh-pages` ブランチとGitHub Pagesを設定します。
どのテンプレートでも、リポジトリに `julia` と `juliapackagefactory` のトピックを付けます。

## 認証

| 入口 | 資格情報 |
|---|---|
| CLI / ローカルWeb | `GITHUB_TOKEN` または `GH_TOKEN`。`--gh` で `gh auth token`、`--device` でDevice Flow |
| stdio MCP | `GITHUB_TOKEN` / `GH_TOKEN` または `--gh` |
| 公開Web | GitHub OAuth 認可コード ＋ S256 PKCE。セッションは暗号化したHttpOnly/Secure Cookieにだけ置き、サーバーには保存しない。有効期間は1時間 |
| 公開MCP | OAuth 2.1（S256 PKCE）。GitHubへ上流認可する |

Device Flowは、Device Flowを有効にしたOAuth AppのClient IDを `PKGFACTORY_GITHUB_CLIENT_ID`（または `--client-id`）に設定して使います。取得したトークンはプロセス内にだけ保持します。

要求するスコープは `repo workflow read:user read:org` です。
Fine-grained PATを使う場合は、対象リポジトリの作成権限と、Administration・Contents・Workflows・Secrets・Pagesの読み書きが必要です。
組織へ作成するには、その組織のオーナーであることと、組織がOAuth AppとDeploy keyを許可していることが必要です。

資格情報なしでも `templates`、`preview`、MCPの `list_templates` / `preview_package` は使えます。

## Web

画面は7段階で進みます。GitHub接続、リポジトリ設定、パッケージ情報、自動化の確認、レビューと作成、結果、AIエージェントへの引き継ぎ。

- 接続後、自分のアカウントとオーナー権限のある組織を作成先に選べます。著者名はGitHubの表示名から補完します。
- 名前の形式と既存リポジトリの有無を入力中に確認し、設定が揃うとプレビューを自動生成します。
- `simple` / `all-in-one` ではCodecov Appの導入を確認します。組織では自動で確認し、確認できない場合は手動のチェックで進めます。
- 公開Webでは、説明文からテンプレートを推薦します（Cloudflare Workers AIの `typesafe/jev`）。
- 作成後はリポジトリ、Actions、ドキュメントへのリンクと、AIエージェント用のプロンプトを表示します。

ローカルWebは `127.0.0.1` だけで待ち受け、Host・Origin・CSRFトークンを検証します。プレビューはページの中にだけあり、作成時に設定と固定値を送り返してサーバーが同じファイルを再生成します。

## MCP

| ツール | 内容 |
|---|---|
| `list_templates` | テンプレート一覧 |
| `preview_package` | プランを生成して返す。認証済みなら作成先の権限と既存リポジトリを確認する。サーバーには保存しない |
| `create_package` | プレビューと同じ設定に `plan: {id, uuid, createdAt}` と `confirm: true` を添えて作成する |

`pkgfactory mcp --stdio --read-only` では `create_package` を公開しません。
クライアント設定の例は [examples/mcp.json](examples/mcp.json) です。

## ライブラリ

```ts
import { Factory } from '@juliapackagefactory/pkgfactory';

const factory = new Factory();
const plan = await factory.preview({owner: 'YourGitHubOwner', name: 'MyPackage', authors: ['You']});
// 利用者がプランを確認してから実行する
await factory.execute(plan, {subject, token: githubToken}, signal);
```

`subject` はGitHubユーザーIDの文字列で、実行時にトークンの持ち主と照合します。
`Factory` は状態を持ちません。プランを後で使うなら `planReference(plan)` の `{id, uuid, createdAt}` と設定を保持し、`restorePlan(spec, reference)` で同じプランを再生成します。

## 失敗時

接続切断、120秒の実行期限、30秒の要求期限、GitHubのエラーのいずれでも、以後のGitHub操作を止め、止まった段階とリポジトリのURLを含むエラーを返します。
自動では再送せず、再開機能もありません。送信済みの操作がGitHubで完了している可能性があるため、リポジトリを確認し、未完成（`.pkgfactory.json` の `state` が `complete` でない）なら削除してから作り直してください。
サーバーにも手元にも記録は残りません。

秘密鍵は保存しません。生成直後に暗号化してGitHubのSecretに登録し、メモリから捨てます。
Deploy keyは既定でEd25519です。`--key-algorithm rsa4096`（Workerでは `KEY_ALGORITHM=rsa4096`）でRSA-4096に切り替えられます。

## 開発

```sh
npm ci
npm run check          # typecheck, test, build, test:worker
node scripts/pack-smoke.mjs
```

構成、作成手順、Cloudflare Workerの設計、配備、テストは [AGENTS.md](AGENTS.md) を参照してください。

## ライセンスと帰属

MITライセンスです（[LICENSE](LICENSE)）。Copyright (c) 2025-2026 Shuhei Ohno and contributors.

- テンプレート（58ファイル）とWeb画面のスタイルシート・ロゴは、[PkgFactory.jl](https://github.com/JuliaPackageFactory/PkgFactory.jl) のコミット `7c7d4afeaa3b4b708726af4795c13c192fc3c948`（MIT）に由来します。テンプレートの描画はJulia文字列をエスケープするため、旧版とバイト単位の互換はありません。
- OAuthには [@cloudflare/workers-oauth-provider](https://github.com/cloudflare/workers-oauth-provider)（MIT）、MCPには [@modelcontextprotocol/sdk](https://github.com/modelcontextprotocol/typescript-sdk)（MIT）を使用しています。
- `packages/pkgfactory/src/web/github.svg` のGitHub Invertocatロゴは、[GitHubのロゴ使用ガイドライン](https://brand.github.com/foundations/logo)に従います。
