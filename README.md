# PkgFactory

GitHubにJuliaパッケージのリポジトリを作り、CI・ドキュメント・リリース自動化まで設定します。
Julia、Git、OpenSSHは不要です。

| 使い方 | 場所 |
|---|---|
| Web | https://pkgfactory.ohnolab.workers.dev |
| MCPサーバー | 上記origin の `/mcp`、または `pkgfactory mcp --stdio` |
| CLI | `pkgfactory`（Node.js 24） |

## テンプレート

| テンプレート | 内容 |
|---|---|
| `minimum` | パッケージ本体、テスト、CI |
| `simple` | 上記 ＋ Documenter、TagBot、Codecov |
| `all-in-one` | 上記 ＋ Aqua、JET、ExplicitImports、Runic書式検査、CITATION.cff、Issue/PRテンプレート、Dependabot、ノートブック、`AGENTS.md` |

`simple` と `all-in-one` では、ドキュメント公開用のDeploy keyと `DOCUMENTER_KEY` Secret、`gh-pages` ブランチ、GitHub Pagesも設定します。

## CLI

npmパッケージ `@juliapackagefactory/pkgfactory` は未公開です。ソースからビルドします。

```sh
npm ci
npm run build
node packages/pkgfactory/dist/cli.js --help
```

```sh
pkgfactory templates                                   # テンプレート一覧
pkgfactory preview --spec package.json --out plan.json # 生成内容を確認（オフライン）
pkgfactory create --plan plan.json --yes --gh          # 作成
pkgfactory status --plan-id PLAN_UUID --gh             # 中断した作成の状態確認
pkgfactory resume --plan-id PLAN_UUID --yes --gh       # 中断した作成の再開
pkgfactory web --gh                                    # ローカルWeb（http://127.0.0.1:8787）
pkgfactory mcp --stdio                                 # MCPサーバー（--read-only で作成を無効化）
```

`--spec` の例（[examples/package.json](examples/package.json)）:

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

- `owner`: 自分のアカウント、またはオーナー権限を持つ組織
- `name`: パッケージ名。リポジトリは `<name>.jl` になる。規則は[PkgFactory.jl](https://github.com/JuliaPackageFactory/PkgFactory.jl/blob/6cf2962ceab3e7ee3662d5bb980960fbb434a5f9/src/verification.jl)と同じ
- `template`: 既定は `simple`
- `visibility`: 既定は `public`

作成が中断しても自動では再送しません。`status` で状態を確認してから `resume` で再開します。

## 認証

| 入口 | 資格情報 |
|---|---|
| CLI / ローカルWeb / stdio MCP | `GITHUB_TOKEN` または `GH_TOKEN`。`--gh` で `gh auth token` を使う |
| 公開Web / 公開MCP | GitHub OAuth |

必要なスコープは `repo workflow read:user read:org` です。
組織へ作成するには、その組織のオーナーであることが必要です。
`templates` と `preview` は資格情報なしで使えます。

MCPクライアントの設定例は [examples/mcp.json](examples/mcp.json) にあります。

## 開発

```sh
npm ci
npm run check
```

構成、作成手順、配備、テストは [AGENTS.md](AGENTS.md) を参照してください。

## ライセンス

MITライセンスです（[LICENSE](LICENSE)）。
テンプレートとWeb画面のスタイルシート・ロゴは [PkgFactory.jl](https://github.com/JuliaPackageFactory/PkgFactory.jl)（MIT）に由来します。
