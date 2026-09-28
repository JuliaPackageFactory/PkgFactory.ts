# 受入結果（2026-09-28 JST）

**実装とローカル検証は完了。本番公開可能という判定はまだしていません。**
ステージングは配備済みです。組織のDeploy key許可後の再開とEd25519の実サービス互換を確認しました。
ステージングのGitHub OAuth Client IDは反映・配備済みです。
本番用の新しいClient IDも設定ファイルへ反映済みです（本番は未配備）。
残りはClient secretの登録と認可後の実測、本番公開準備です。

| 検証 | 結果 |
|---|---|
| Node.js 24 / TypeScript strict | 成功 |
| リポジトリCI | [Windows/macOS/Linux＋Julia 3テンプレートの全6ジョブ成功](https://github.com/JuliaPackageFactory/PkgFactory.ts/actions/runs/36355182632) |
| Nodeテスト | 28件成功 |
| workerdテスト | 3件成功 |
| 3テンプレート | 指定コミットの58原本＋回復マーカー、TOML/YAML/CFF/JSONの構文検証成功 |
| Node/workerdのプラン一致 | 固定UUID・日付・日本語著者を含めて一致 |
| Ed25519 / RSA-4096 | Nodeとworkerdで生成成功。OpenSSHが秘密鍵を読み、公開鍵が一致 |
| GitHub Secret暗号化 | Node/workerdでsealed box生成、独立libsodiumで復号成功 |
| 作成・明示的再開 | 3テンプレートの模擬GitHub完走。8工程で応答喪失→ロック保持→照合→再開成功 |
| 切断 | Node AbortSignalとworkerd実HTTP接続の切断後、後続コミットなし |
| 排他・所有者 | 他人のプラン、別プランの同一repo、改変Project.toml、置換・削除されたrepoの再開を拒否 |
| ローカルWeb | ブラウザでプレビュー・ファイル表示・未確認作成の拒否を確認。Host/Origin/CSRFテスト成功 |
| MCP | stdioとStreamable HTTPのinitialize・tools/list・preview/create検証成功 |
| 公開認証のローカル検証 | S256 challenge、一回限りstate、ブラウザ不一致、暗号文改変・ID入替、CSRF、ログアウト成功 |
| npm tarball | Windows/macOS/LinuxのCIで別ディレクトリへインストール後、CLI/オフライン生成/Web/stdioが起動 |
| Wrangler dry-run | 成功。Worker約1.2MiB、gzip約250KiB。Julia/Containersなし |
| Cloudflareステージング配備 | 専用KV・SQLite DO・SESSION_KEY作成済み。短い名前へ配備成功、報告された起動時間36ms |
| 公開Edgeの疎通 | [health](https://pkgfactory-staging.ohnolab.workers.dev/health)は200/maintenance。OAuth未設定のWeb/MCP/作成APIは503、異なるOriginは403 |

workerdの鍵生成は一例でEd25519約1ms、RSA約0.4–2.1秒でした。これはローカルの経過時間で、
Cloudflare本番CPU/メモリ測定ではありません。高負荷・8同時実行の容量測定はステージングで行います。

## 実GitHubで作成した検証リポジトリ

| テンプレート | 結果・根拠 |
|---|---|
| minimum | [作成済み](https://github.com/JuliaPackageFactory/PkgFactoryPoc202609272136300.jl)、Factory完了、[Julia CI成功](https://github.com/JuliaPackageFactory/PkgFactoryPoc202609272136300.jl/actions/runs/36352363057) |
| simple | [作成・再開完了](https://github.com/JuliaPackageFactory/PkgFactoryPoc202609272136301.jl)、[DOCUMENTER_KEYでのCI成功](https://github.com/JuliaPackageFactory/PkgFactoryPoc202609272136301.jl/actions/runs/36382175415)、[公開docs HTTP 200](https://juliapackagefactory.github.io/PkgFactoryPoc202609272136301.jl/dev/) |
| all-in-one | [作成・再開完了](https://github.com/JuliaPackageFactory/PkgFactoryPoc202609272136302.jl)、[DOCUMENTER_KEYでのCI成功](https://github.com/JuliaPackageFactory/PkgFactoryPoc202609272136302.jl/actions/runs/36382015679)、Aqua/JET/書式検証成功、[公開docs HTTP 200](https://juliapackagefactory.github.io/PkgFactoryPoc202609272136302.jl/dev/) |

初回は `Deploy keys are disabled for this repository` で停止しました。
組織所有者による有効化後、同じプラン・UUIDでGitHub状態を照合して再開し、両方ともFactory完了となりました。
GitHub APIで登録鍵が `ssh-ed25519` / write許可であることを確認しました。

TagBot公式のSSH設定・タグpushコードを固定コミットで実行し、
[simple](https://github.com/JuliaPackageFactory/PkgFactoryPoc202609272136301.jl/actions/runs/36382173222)・
[all-in-one](https://github.com/JuliaPackageFactory/PkgFactoryPoc202609272136302.jl/actions/runs/36382184307) とも成功しました。
登録やGitHub Releaseは行わず、検証タグだけを作っています。

Documenterの両CIログで `DOCUMENTER_KEY` が非空であることと公開成功を確認しました。
DocumenterのGitHubActions認証実装はこの条件でSSHを選びます。
[公式実装](https://github.com/JuliaDocs/Documenter.jl/blob/master/src/deployconfig.jl)
初回公開はGITHUB_TOKENでしたが、今回の再開後の公開はEd25519鍵によるものです。
この結果から既定値をEd25519のまま採用します。RSA-4096への切替は不要でした。

保存済みプランID:

| テンプレート | planId |
|---|---|
| minimum | `5232c039-e5f7-48f7-b338-94c9ec7cd8ee` |
| simple | `d8ef5844-7306-4dd4-b6c5-09e4febd30ef` |
| all-in-one | `0baf53f5-94b9-4c0b-81b8-0839bcf1dcdb` |

状態は本ワークスペースの `.tmp/e2e-state`、結果は `artifacts/github-e2e.json` に保存されています。
これらのファイルにはトークンや秘密鍵を保存していませんが、運用状態なのでGitには含めません。
検証リポジトリは結果の確認用に残しています。自動削除・アーカイブはしていません。

## リリース前に残る確認

1. ステージングのGitHub OAuth Client secretを登録し、受付を有効化してWeb/MCPからの認可→作成→再開を確認する。Client ID/KV/DO/SESSION_KEYは配備済み。
2. 公開Edge経由の切断伝播・8同時実行・CPU/メモリを計測する。
3. 本番成果と切替手順をレビューし、承認後に本番・npm公開と旧リポジトリのアーカイブへ進む。

旧リポジトリ `PkgFactory.jl` の内容、設定、アーカイブ状態は変更していません。
