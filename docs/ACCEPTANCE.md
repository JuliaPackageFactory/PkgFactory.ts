# 受入結果（2026-09-28 JST）

**実装とローカル検証は完了。本番公開可能という判定はまだしていません。**
ステージングは配備済みです。組織のDeploy key許可後の再開とEd25519の実サービス互換を確認しました。
ステージングのGitHub OAuth Client IDは反映・配備済みです。
本番用の新しいClient IDも設定ファイルへ反映済みです（本番は未配備）。
ステージングのClient secret登録を確認し、受付を有効化しました。
公開MCPのOAuth認可・3テンプレートの実作成・Documenter公開を確認しました。
公開Edgeでの接続切断・ロック保持・状態照合・明示的再開も完了しました。
残りはWebログインの利用者側確認と、本番公開準備です。

| 検証 | 結果 |
|---|---|
| Node.js 24 / TypeScript strict | 成功 |
| リポジトリCI | [Windows/macOS/Linux＋Julia 3テンプレートの全6ジョブ成功](https://github.com/JuliaPackageFactory/PkgFactory.ts/actions/runs/36391031646) |
| Nodeテスト | 29件成功 |
| workerdテスト | 4件成功 |
| 3テンプレート | 指定コミットの58原本＋回復マーカー、TOML/YAML/CFF/JSONの構文検証成功 |
| Node/workerdのプラン一致 | 固定UUID・日付・日本語著者を含めて一致 |
| Ed25519 / RSA-4096 | Nodeとworkerdで生成成功。OpenSSHが秘密鍵を読み、公開鍵が一致 |
| GitHub Secret暗号化 | Node/workerdでsealed box生成、独立libsodiumで復号成功 |
| 作成・明示的再開 | 3テンプレートの模擬GitHub完走。8工程で応答喪失→ロック保持→照合→再開成功 |
| 切断 | Node AbortSignalとworkerd実HTTP接続の切断後、後続コミットなし |
| 排他・所有者 | 他人のプラン、別プランの同一repo、改変Project.toml、置換・削除されたrepoの再開を拒否 |
| ローカルWeb | ブラウザでプレビュー・ファイル表示・未確認作成の拒否を確認。Host/Origin/CSRFテスト成功 |
| MCP | stdioとStreamable HTTPのinitialize・tools/list・preview/create検証成功 |
| 公開認証のローカル検証 | S256 challenge、一回限りstate、ブラウザ不一致、暗号文改変・ID入替、CSRF、ログアウト成功。MCPクライアント登録→同意/取消→遷移ページ、一回限り同意の検証も成功 |
| ネイティブworkerd通信 | 実fetchを通るWeb/MCP認可・3テンプレート作成・Deploy key/Secret/Pages設定成功（送信先のみ模擬GitHub）。転送拒否と、認可コード/保存状態の期限切れも確認 |
| npm tarball | Windows/macOS/LinuxのCIで別ディレクトリへインストール後、CLI/オフライン生成/Web/stdioが起動 |
| Wrangler dry-run | 成功。Worker約1.2MiB、gzip約250KiB。Julia/Containersなし |
| Cloudflareステージング配備 | 専用KV・SQLite DO・SESSION_KEY・GitHub Client secret設定済み。受付有効、報告された起動時間39ms。version `9f3f57ed-1644-408d-803f-37dda60fdaeb` |
| 公開Edgeの疎通 | [health](https://pkgfactory-staging.ohnolab.workers.dev/health)は200/ok、Webは200。未認証API/MCPは401。MCPの認証案内・resource metadata・authorization metadataは正常、S256のみを案内 |
| 公開MCPの実認可・作成 | GitHub OAuth→MCPトークン交換→5ツールの呼び出し成功。3テンプレートの実作成・状態照合がすべてcomplete |
| 公開Edgeの実測 | 8同時プレビュー710ms。作成minimum 8.875秒、simple 12.551秒、all-in-one 11.965秒（クライアント実測） |
| 公開Edgeの切断・再開 | 実HTTP接続を切断後、GitHub状態の進行停止とロック保持を確認。期限後に状態を照合し、明示的resumeでcomplete |

workerdの鍵生成は一例でEd25519約1ms、RSA約0.4–2.1秒でした。これはローカルの経過時間で、
CloudflareのCPU/メモリ測定ではありません。ステージングでの実測は次節を参照してください。

## Cloudflare公開MCPでの受入

GitHub OAuth認可と公開MCPへの接続後、8件の同時プレビューを保存し、先頭3件を作成しました。
statusでマーカー・鍵・Secret・Pages設定を照合し、すべてcompleteを確認しています。

| テンプレート | planId / 結果 |
|---|---|
| minimum | `7f1ccb73-ede4-497b-ad60-2a9244a2c211` / [リポジトリ](https://github.com/JuliaPackageFactory/PkgFactoryEdge202609280723450.jl) / [CI成功](https://github.com/JuliaPackageFactory/PkgFactoryEdge202609280723450.jl/actions/runs/36391433516) |
| simple | `17541d8b-3086-4e3f-aa83-ad58cf577e3a` / [リポジトリ](https://github.com/JuliaPackageFactory/PkgFactoryEdge202609280723451.jl) / [CI成功](https://github.com/JuliaPackageFactory/PkgFactoryEdge202609280723451.jl/actions/runs/36391452126) / [公開docs HTTP 200](https://juliapackagefactory.github.io/PkgFactoryEdge202609280723451.jl/dev/) |
| all-in-one | `9fd63016-4579-4f2f-84a9-34ee7d6f4ae1` / [リポジトリ](https://github.com/JuliaPackageFactory/PkgFactoryEdge202609280723452.jl) / [最終CI成功](https://github.com/JuliaPackageFactory/PkgFactoryEdge202609280723452.jl/actions/runs/36391473751) / [公開docs HTTP 200](https://juliapackagefactory.github.io/PkgFactoryEdge202609280723452.jl/dev/) |

simple/all-in-oneのDeploy keyは、GitHub APIで `ssh-ed25519`・`read_only=false` を確認しました。
両方の最終Documenterジョブで `DOCUMENTER_KEY` が非空であり、公開ジョブが成功したことも確認しています。
認可資格情報は検証プロセスのメモリだけに保持し、終了時に破棄しています。
結果は `artifacts/staging-mcp-e2e.json` に記録し、トークンや認可コードは含めていません。

Cloudflare GraphQL `workersInvocationsAdaptive`（2026-09-28 07:23:00–07:39:07 UTC）の取得結果:

| 指標 | 値 |
|---|---|
| 成功 requests / subrequests / runtime errors | 54 / 243 / 0 |
| 意図したclientDisconnected | 1件（runtime errors 0） |
| 成功リクエストのCPU P50 / P99 | 11.394ms / 161.286ms |
| 成功リクエストのV8 isolateメモリ P50 / P99 | 11,404,814 / 17,486,224 bytes（約10.9 / 16.7MiB） |

CPUの単位がmicroseconds、メモリがbytesであることをGraphQL schemaの説明で確認しました。
原データは `artifacts/staging-metrics.json` に保存しています。これはこの小規模受入の測定値で、
8件同時のリポジトリ作成や長時間負荷の上限を保証する値ではありません。
[Cloudflareの計測仕様](https://developers.cloudflare.com/workers/observability/metrics-and-analytics/)

### 公開Edgeの切断と明示的再開

[検証リポジトリ](https://github.com/JuliaPackageFactory/PkgFactoryEdge202609280735569.jl)
のplanIdは `84377178-84bb-46f7-9af7-866049122ac7` です。

1. 07:36:01 UTC、リポジトリが作成された直後にHTTPクライアントの接続を切断しました。
2. 切断後2秒・5秒の照合で、head `b67315301f8bef2e223ded05596899c1f23e42c0` が同一、回復マーカーなし、Deploy keyなし、Secretなしを確認しました。操作はrunning、リース期限は07:38:27.960 UTCのままでした。
3. 期限後にも同じGitHub状態であり、勝手に再開していないことを確認しました。
4. 検証スクリプトの明示的resumeを1回実行し、complete・一致するマーカー・Ed25519鍵・Documenter Secret・Pages設定を確認しました。
5. 再開後の [Julia/Documenter CI](https://github.com/JuliaPackageFactory/PkgFactoryEdge202609280735569.jl/actions/runs/36392772784) が成功し、[公開docs](https://juliapackagefactory.github.io/PkgFactoryEdge202609280735569.jl/dev/) のHTTP 200と生成したパッケージ名を確認しました。

Cloudflareのメトリクスにも `clientDisconnected` が1件記録されています。
結果は `artifacts/staging-disconnect-e2e.json` に保存しています。

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

1. 公開Webのログイン確認。MCPのGitHub OAuth・5ツール・3テンプレートの実作成は完了。通常のブラウザーでWebへログインした結果を確認中。
2. 本番成果と [切替前レビュー](RELEASE_REVIEW.md) を確認し、npmの公開権限と本番専用secrets/KVを準備する。このPCのnpmログインは未設定（ENEEDAUTH）。公開レジストリからのパッケージ参照はE404で、公開済みとは確認できていない。
3. 承認後に本番・npm公開と旧リポジトリのアーカイブへ進む。負荷の範囲は上記の通りで、8件同時作成の容量測定は未実施。

旧リポジトリ `PkgFactory.jl` の内容、設定、アーカイブ状態は変更していません。
