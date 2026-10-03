# 継続テストと実GitHub受入

旧版 `7c7d4af` の `test/e2e/repositories.jl`・`sync.jl`・`E2E.yml` に相当する仕組みは、
`scripts/template-repositories.ts`・`scripts/e2e/snapshots.ts`・`template-repositories.yml` に移しました。
当初のTypeScript版にはこの固定リポジトリのE2Eが欠けていました。ローカル生成・模擬GitHub・新規作成受入と役割を分けて補っています。

| 検証 | 実行契機 | GitHubへの書込み |
|---|---|---|
| Node/workerd・生成JuliaのCI | PR / main / 手動 | なし。3テンプレートの構文、Pkg.test、ドキュメントビルド、切断・再開など |
| 固定リポジトリのE2E | 有効化後、mainのテンプレート/生成処理変更 / 手動 | 下記の既存3リポジトリに差分だけをcommit/push |
| 作成・再開の受入 | 明示的な手動実行 | 1回の実行で新規リポジトリは最大1件。再開時は0件 |

GitHub ActionsのテストはLinux（`ubuntu-latest`）で実行します。本体CIとall-in-oneテンプレートのmacOS・Windows設定はコメントで残しています。

## 固定3リポジトリ

| テンプレート | 現在のリポジトリ | 初回更新で受け入れる旧パッケージ名 |
|---|---|---|
| minimum | [ExampleMinimum.jl](https://github.com/JuliaPackageFactory/ExampleMinimum.jl) | TestMinimum / TemplateMinimum / PkgFactoryMinimum |
| simple | [ExampleSimple.jl](https://github.com/JuliaPackageFactory/ExampleSimple.jl) | TestSimple / TemplateSimple / PkgFactorySimple |
| all-in-one | [ExampleAllInOne.jl](https://github.com/JuliaPackageFactory/ExampleAllInOne.jl) | TestAllInOne / TemplateAllInOne / TamplateAllInOne / PkgFactoryAllInOne |

GitHub Actionsのワークフロー名は **Template E2E tests**、各ジョブの表示名は `E2E (ExampleMinimum.jl)`・`E2E (ExampleSimple.jl)`・`E2E (ExampleAllInOne.jl)` です。サマリーにも同じジョブ名が使われます。

既存リポジトリとmainを必須とし、リポジトリの作成・削除はしません。
Project.toml・モジュール・テスト・README・docsの名前とURLを生成器で一貫して更新し、UUIDとGit履歴を維持します。
生成物にない古い追跡ファイルは除去するため、これらの専用リポジトリに手書きのファイルを混在させないでください。
Factoryの作成ジャーナル用 `.pkgfactory.json` は継続スナップショットには含めません。
日付はリポジトリの最初のコミットから決め、同じ入力で毎回日付が変わる差分を防ぎます。
生成内容が同じならコミットしません。更新コミットの件名は `Update ExampleAllInOne from PkgFactory.ts <生成元の40桁SHA>` の形式で、対象パッケージ名と生成元のコミットIDを記録します。空行を挟んだ3行目にはそのコミットURLを記録します。
dirty checkout・別パッケージ名・不正UUIDを拒否し、競合するpushは強制上書きも自動再送もしません。

```sh
# GitHubは読み取りだけ。生成予定の全ファイルを .tmp/template-repositories/ に保存
npm run e2e:templates -- --gh
# ソース変更をコミット後、固定3件を更新（新規作成0件）
npm run e2e:templates -- --gh --publish
# 1テンプレートのみ確認する場合
npm run e2e:templates -- --gh --publish --package=ExampleSimple
```

結果は `artifacts/template-repositories*.json` にUUID・更新前後SHA・チェックアウト先を保存します。
失敗時はremote mainを確認してから明示的に再実行します。新しいcheckoutで最新状態を照合し、同一内容の再pushはしません。
ローカル一時Gitリポジトリを使った回帰テストは `npm test` に含め、改名、UUID/履歴保持、削除のみの変更、同一出力、競合、汚れたcheckoutを検証します。

## GitHub Actionsの設定

1. JuliaPackageFactoryをResource ownerとするfine-grained PATを用意し、対象を上記3リポジトリに限定します。
   Repository permissionsは **Contents: Read and write**、**Workflows: Read and write**、**Metadata: Read-only**。
   作成や鍵設定はこのCIでは行わないため、Administration/Secrets権限は不要です。
   旧E2E用のトークンが手元にある場合は、対象3件の権限を確認して再利用できます。
2. [PkgFactory.tsのActions secrets](https://github.com/JuliaPackageFactory/PkgFactory.ts/settings/secrets/actions) に
   `PKGFACTORY_E2E_TOKEN` を登録します。旧リポジトリのSecretは自動的には引き継がれません。
   トークンをチャットへ送ったり、ローカルghの広い権限の資格情報をそのままCIへコピーする必要はありません。
3. 旧PkgFactory.jlの **Template repositories E2E** の実行完了を確認し、このWorkflowだけを無効化します。
   二つのリポジトリのconcurrency設定は共通ロックにはならないため、固定リポジトリへの更新元を新版へ一本化します。
   旧コードの変更やアーカイブは不要です。旧リポジトリを参照用とする方針に従い、この設定変更は本作業では行いません。
4. 新版のmainへマージした後、[Actions variables](https://github.com/JuliaPackageFactory/PkgFactory.ts/settings/variables/actions) に
   `PKGFACTORY_TEMPLATE_E2E_ENABLED=true` を登録し、**Template repositories E2E → Run workflow → main** を実行します。
   有効化前とPRでは外部リポジトリへ書き込みません。

Workflowは固定3件を順に更新し、ファイル一致・UUID・履歴・remote SHAを検証します。
その後、公開用PATを渡さずにJulia 1.12のPkg.test（JETを含む）とdocsビルドを行い、結果をartifactとjob summaryへ残します。
pushされたリポジトリ自身のCIが、Linuxでの各Julia版のテスト・品質検査・Documenter公開を担当します。
そのCIを同じ更新について二重にdispatchしません。GITHUB_TOKENによる別リポジトリ更新には制限があるため、上記の専用PATを使います。
[GitHubのトークンとWorkflow起動の仕様](https://docs.github.com/en/actions/how-tos/write-workflows/choose-when-workflows-run/trigger-a-workflow)

ExampleSimple.jl・ExampleAllInOne.jlのDocumenter公開は、旧名のTestSimple.jl・TestAllInOne.jlで既存設定による成功を確認しています。
現在はリポジトリ自身の `GITHUB_TOKEN`（contents: write）で認証し、Pagesは `gh-pages` の `/` を公開しています。
TagBotが作るタグからCIを起動するSSH検証を追加する場合は、Deploy key（write許可）と、対応するBase64形式の秘密鍵をActions Secret `DOCUMENTER_KEY` に設定します。
[Documenterの認証方式とTagBot](https://documenter.juliadocs.org/stable/man/hosting/)
PkgFactory.ts側の公開用PATは生成リポジトリのSecretへコピーしません。
固定リポジトリのE2E自体は既存の鍵・Secret・Pages設定を変更しません。

## 新規作成が必要な受入

Node版と公開MCP版が同じ命名と1件制限を使います。名前は `TestYYYYMMDDHHMMSS.jl`、時刻はUTCです。
既定テンプレートはsimple。3テンプレートを一度に新規作成するループはありません。
下記の新規作成コマンドは選択肢です。一連の受入ではNodeまたは公開MCPの一方を選び、まとめて実行しません。
失敗・応答不明の作成も1件に数え、別リポジトリを作ってやり直しません。報告ファイルと保存プランを使って再開します。

```sh
npm run e2e -- --gh --template=simple --confirm-create-test-repository
npm run e2e -- --gh --resume-plan=PLAN_ID --confirm-resume
# 公開MCPの認可・8同時プレビュー（新規作成なし）
npm run e2e:staging
# 8プレビューのうち選択したテンプレートの1プランだけを作成
npm run e2e:staging -- --template=all-in-one --confirm-create-test-repository
npm run e2e:staging -- --resume-plan=PLAN_ID --confirm-resume
# 作成1件の途中で切断し、状態照合後に同じプランを明示的に再開
npm run e2e:staging -- --template=simple --confirm-create-test-repository --confirm-disconnect-and-resume
```

Nodeのプランは `.tmp/e2e-state` に保持します。両runnerは書込み前にplanIdを含む一意の報告ファイルへ保存し、その場所を実行結果に表示します。
Deploy key PoCが必要なときも、その実行で作成した同じ1件を `scripts/install-key-poc.ts OWNER/TestYYYYMMDDHHMMSS.jl --confirm` に渡します。
過去の受入記録のPkgFactoryPoc/Edgeリポジトリは履歴資料であり、今後の新規作成先には使いません。
