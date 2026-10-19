# PkgFactory

GitHubにJuliaパッケージのリポジトリを作り、CI・ドキュメント・リリース自動化まで設定するツールです。
TypeScriptで書かれた一つの生成エンジンを、CLI・Web・MCPサーバーから共通に使います。

| 名前 | 値 |
|---|---|
| サービス名 | PkgFactory |
| CLI | `pkgfactory` |
| npm | `@juliapackagefactory/pkgfactory`（未公開） |
| 実行環境 | Node.js 24 |

Julia、Docker、Git、OpenSSHは不要です。GitHubへの操作はすべてREST APIで行います。

## インストール

npm公開後は `npm install -g @juliapackagefactory/pkgfactory` でインストールできます。
現時点ではこのリポジトリからビルドします。

```sh
npm ci
npm run build
node packages/pkgfactory/dist/cli.js --help
```

`npm pack --workspace @juliapackagefactory/pkgfactory` で作ったtarballをインストールしても同じです。

## CLI

```sh
pkgfactory templates                                   # テンプレート一覧
pkgfactory preview --spec package.json --out plan.json # オフラインで生成内容を固定
pkgfactory create --plan plan.json --yes --gh          # プランどおりに作成
pkgfactory status --plan-id PLAN_UUID --gh             # GitHubの状態を照合
pkgfactory resume --plan-id PLAN_UUID --yes --gh       # 中断した作成を明示的に再開
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
| `template` | `minimum` / `simple` / `all-in-one`（既定 `simple`） |
| `visibility` | `public` / `private`（既定 `public`） |

パッケージ名の規則は[PkgFactory.jl](https://github.com/JuliaPackageFactory/PkgFactory.jl/blob/6cf2962ceab3e7ee3662d5bb980960fbb434a5f9/src/verification.jl)と同じです。
5〜100文字のASCII英数字、先頭は大文字、小文字を1文字以上含み、`Julia`/`julia` を含まず、`Ju` で始まらず、`jl` で終わらないこと。末尾の `.jl` はAPI・CLI・MCPでは取り除いて受け付けます。

### プランと状態

`preview` はネットワークなしで動き、プランID・パッケージUUID・全ファイルの内容を固定します。
`create` と `resume` はそのプランに対してだけ動き、`--yes` を要求します。
状態は `~/.pkgfactory/journal.json` に保存します（`--state-dir` または `PKGFACTORY_STATE_DIR` で変更）。
同じディレクトリを使えば、CLI・ローカルWeb・stdio MCPの間で状態を共有できます。

## テンプレート

| テンプレート | 内容 |
|---|---|
| `minimum` | パッケージ本体、テスト、CI |
| `simple` | 上記 ＋ Documenter、TagBot、Codecov |
| `all-in-one` | 上記 ＋ Aqua、JET、ExplicitImports、Runic書式検査、CITATION.cff、Issue/PRテンプレート、Dependabot、ノートブック、`AGENTS.md` |

`simple` と `all-in-one` では、作成時にDeploy keyと `DOCUMENTER_KEY` Secretを登録し、`gh-pages` ブランチとGitHub Pagesを設定します。
どのテンプレートでも、リポジトリに `julia` と `juliapackagefactory` のトピックを付けます。

## 認証

| 入口 | 資格情報 |
|---|---|
| CLI / ローカルWeb | `GITHUB_TOKEN` または `GH_TOKEN`。`--gh` で `gh auth token`、`--device` でDevice Flow |
| stdio MCP | `GITHUB_TOKEN`/`GH_TOKEN` または `--gh`。対話ログインはしない |
| 公開Web | GitHub OAuth 認可コード ＋ S256 PKCE。セッションはHttpOnly/Secure Cookie |
| 公開MCP | OAuth 2.1（S256 PKCE）。GitHubへ上流認可する。GitHub PATをBearerとして受け付けない |

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
- 作成後はリポジトリ、Actions、ドキュメントへのリンクと、AIエージェント用のプロンプトを表示します。

公開Webでは、説明文からテンプレートを推薦する機能があります（Cloudflare Workers AIの `typesafe/jev`）。ローカルWebにはありません。

ローカルWebは `127.0.0.1` だけで待ち受け、Host・Origin・CSRFトークンを検証します。
Webに再開画面はありません。中断したプランはCLIかMCPの `status` / `resume` で扱います。

## MCP

ツールは5つです。

| ツール | 内容 |
|---|---|
| `list_templates` | テンプレート一覧 |
| `preview_package` | プランを生成して保存する。認証済みなら作成先の権限と既存リポジトリを確認する |
| `repository_status` | 保存済みプランとGitHubの状態を照合する |
| `create_package` | `planId` と `confirm: true` で作成する |
| `resume_package` | `planId` と `confirm: true` で明示的に再開する |

`pkgfactory mcp --stdio --read-only` では `create_package` と `resume_package` を公開しません。
クライアント設定の例は [examples/mcp.json](examples/mcp.json)、公開MCPのURLはWorkerの `/mcp` です。

## ライブラリ

```ts
import { Factory, MemoryStore } from '@juliapackagefactory/pkgfactory';

const factory = new Factory(new MemoryStore());
const plan = await factory.preview({owner: 'YourGitHubOwner', name: 'MyPackage', authors: ['You']}, subject);
// 利用者がプランを確認してから実行する
await factory.execute(plan.id, {subject, token: githubToken}, false, signal);
```

`subject` はGitHubユーザーIDの文字列で、実行時にトークンの持ち主と照合します。
`MemoryStore` はプロセス内だけの保存です。永続化するには `StateStore` を実装したストアを渡します。

## 中断と再開

GitHubへの書き込みは、送信前にジャーナルへ記録し、自動では再送しません。
接続切断、120秒の実行期限、30秒の要求期限のいずれかで、以後のGitHub操作を止めます。
結果が不明な操作はロックとして残り、150秒のリース期限後に `status` で照合してから `resume` で再開します。
再開時はリポジトリID、回復マーカー `.pkgfactory.json`、Project.tomlを照合し、他人や別プランのリポジトリを上書きしません。

秘密鍵は保存しません。Secret登録の結果が不明なら、再開時に新しい鍵ペアを作り、登録後にそのプランの古い鍵だけを削除します。
Deploy keyは既定でEd25519です。`--key-algorithm rsa4096`（Workerでは `KEY_ALGORITHM=rsa4096`）でRSA-4096に切り替えられます。

詳細は [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) を参照してください。

## 開発

```sh
npm ci
npm run check          # typecheck, test, build, test:worker
node scripts/pack-smoke.mjs
```

テンプレートの編集元は `packages/pkgfactory/templates/` です。
`src/core/templates.json` はそこから生成する埋め込み用ファイルで、Gitには含めません。
`npm ci`、型検査、テスト、ビルド、`npm pack` の前に自動生成されます。`tsx` で直接実行する前には `npm run templates` を実行してください。

- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) — 構成、作成手順、再開、公開環境の設計
- [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) — Cloudflare Workerの設定と配備
- [docs/TESTING.md](docs/TESTING.md) — テストとE2E

## 由来

テンプレートとWeb画面は [PkgFactory.jl](https://github.com/JuliaPackageFactory/PkgFactory.jl) の `7c7d4af` から移植しました。
旧版のAPI・CLI・生成物との互換は保証しません。ライセンスは [LICENSE](LICENSE)、帰属は [NOTICE.md](NOTICE.md) を参照してください。
