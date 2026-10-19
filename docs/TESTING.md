# テスト

| 層 | コマンド | GitHubへの書き込み |
|---|---|---|
| 型検査 | `npm run typecheck` | なし |
| Nodeテスト | `npm test` | なし。GitHubは模擬サーバー（`test/fake-github.ts`） |
| workerdテスト | `npm run test:worker` | なし。Miniflare上でWorker全体を実行する |
| tarball検証 | `node scripts/pack-smoke.mjs` | なし。`npm pack` の成果物をインストールしてCLI・stdio MCP・ローカルWebを起動する |
| 生成パッケージのJulia実行 | CI `generated-julia` ジョブ | なし。3テンプレートで `Pkg.test` とdocsビルドを行い、説明文が実行されないことを確認する |
| 固定リポジトリE2E | `npm run e2e:templates` | 既存3リポジトリへの差分commit/push |
| 作成・再開の受入 | `npm run e2e`、`npm run e2e:staging` | 1回の実行で新規リポジトリ1件まで |

`npm run check` は型検査、Nodeテスト、ビルド、workerdテストをまとめて実行します。

## Nodeテスト

`test/*.test.ts` を `node:test` で実行します。主な対象:

- `core`: 説明文のエスケープ、パス・Julia文字列のインジェクション、名前規則のメッセージ
- `engine`: 切断後の書き込み停止、他subjectの拒否、競合プランと改変Project.tomlの拒否、置換・削除されたリポジトリの拒否
- `github-context`: プロフィール、組織オーナー判定、名前の空き確認、GitHub App導入状況
- `local`: ローカルWebのHost/Origin/CSRF、`FileStore` の再起動と多重プロセス、stdio MCP
- `mcp-http`: Streamable HTTPでの初期化・一覧・作成・取り消し
- `auth`: 接続元の正規化、同意画面の表示、戻り先の制限、セッションの暗号化と鍵長、Device Flow、PKCEの交換
- `web-workflow` / `web-interactions`: jsdomでのブラウザー側の挙動（段階の遷移、IME、プレビュー、テンプレート推薦、AI引き継ぎ）
- `template-suggestion`: Jev応答の検証とエラーの区別
- `release`: 本番配備前のステージング配備履歴の照合
- `e2e-repositories`: ローカルGitでの固定リポジトリ更新（改名、UUIDと履歴の維持、競合、dirty checkout）

## workerdテスト

`test/worker/*.test.ts` はMiniflareでWorkerをバンドルして実行します。

- `runtime`: テンプレート生成とNodeとの一致、鍵生成とsealed box、ルート、Durable Objectの永続化、OAuth PKCEとCSRF、切断後の停止、ネイティブfetchでのWeb/MCP認可と3テンプレートの作成
- `security`: subjectごとの容量分離、旧形式の移行、欠損プランの隔離、ログインの接続元制限、匿名ルートとアカウントのレート制限、`SESSION_KEY` の鍵長

## 固定リポジトリE2E

`scripts/template-repositories.ts` が3つの専用リポジトリを現在の生成器で更新します。リポジトリの作成・削除はしません。

| テンプレート | リポジトリ |
|---|---|
| `minimum` | [ExampleMinimum.jl](https://github.com/JuliaPackageFactory/ExampleMinimum.jl) |
| `simple` | [ExampleSimple.jl](https://github.com/JuliaPackageFactory/ExampleSimple.jl) |
| `all-in-one` | [ExampleAllInOne.jl](https://github.com/JuliaPackageFactory/ExampleAllInOne.jl) |

- 既存のUUIDとGit履歴を維持し、日付はリポジトリの最初のコミットから取る
- 生成物にないファイルは削除する。これらのリポジトリに手書きのファイルを置かない
- 回復マーカー `.pkgfactory.json` は含めない
- 生成内容が同じならコミットしない。コミット名は `Update <Package> from PkgFactory.ts <生成元SHA>`
- dirty checkout、別のパッケージ名、不正なUUID、remote mainの変化を検出すると停止する。強制pushと自動再送はしない

```sh
npm run e2e:templates -- --gh                              # 読み取りのみ。生成内容を .tmp/template-repositories/ に出力
npm run e2e:templates -- --gh --publish                    # 3件を更新
npm run e2e:templates -- --gh --publish --package=ExampleSimple
```

結果は `artifacts/template-repositories*.json` に保存します。

GitHub Actionsの `Template E2E tests`（`template-repositories.yml`）は、mainへのテンプレート関連の変更で順に1件ずつ更新し、その後に公開用トークンを渡さずにJuliaのテストとdocsビルドを行います。
有効化には次が必要です。

1. 対象3リポジトリに限定したfine-grained PAT（Contents: Read and write、Workflows: Read and write、Metadata: Read-only）をActions secret `PKGFACTORY_E2E_TOKEN` に登録する
2. Actions variable `PKGFACTORY_TEMPLATE_E2E_ENABLED` を `true` にする

## 作成・再開の受入

新規作成は `JuliaPackageFactory/TestYYYYMMDDHHMMSS.jl`（UTC）を1回の実行で1件だけ作ります。失敗や結果不明も1件に数え、別のリポジトリでやり直さず、保存したplanIdで再開します。

```sh
# Node（状態は .tmp/e2e-state、記録は artifacts/github-e2e-*.json）
npm run e2e -- --gh --template=simple --confirm-create-test-repository
npm run e2e -- --gh --resume-plan=PLAN_ID --confirm-resume

# ステージングの公開MCP（OAuth認可をブラウザーで行う。新規作成なしで8同時プレビュー）
npm run e2e:staging
npm run e2e:staging -- --template=all-in-one --confirm-create-test-repository
npm run e2e:staging -- --resume-plan=PLAN_ID --confirm-resume
# 作成中にHTTP接続を切り、停止・照合・明示的再開を確認する
npm run e2e:staging -- --template=simple --confirm-create-test-repository --confirm-disconnect-and-resume
```

ステージングの記録は `artifacts/staging-{mcp,disconnect,resume}-*.json` に保存し、トークンや認可コードは含めません。

Deploy keyの実機検証には、その実行で作ったリポジトリに手動実行のワークフローを追加し、TagBotのSSH設定とタグpushを実行します。

```sh
npx tsx scripts/install-key-poc.ts JuliaPackageFactory/TestYYYYMMDDHHMMSS.jl --confirm
npm run poc   # Ed25519 / RSA-4096 の鍵生成だけを計測
```
