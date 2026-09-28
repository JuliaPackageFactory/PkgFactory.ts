# 本番切替前レビュー

公開するコードは [PkgFactory.ts PR #1](https://github.com/JuliaPackageFactory/PkgFactory.ts/pull/1) です。
本番・npmの公開と旧リポジトリのアーカイブは、成果と切替手順の確認後に行います。
現在、公開MCPの認可・3テンプレートの実作成・Documenter公開まで成功しています。
公開Edgeでの切断・ロック保持・状態照合・明示的再開も成功しました。
旧版のWeb導線・ロゴ・配色を引き継ぐ修正を加えました。認証後のオーナー選択・著者補完・名前照会が動作します。
修正版の公開Webから利用者による [ohno/MyPkg78.jl](https://github.com/ohno/MyPkg78.jl) の実作成も成功しました。

## 成果

- サービス PkgFactory / CLI `pkgfactory` / npm `@juliapackagefactory/pkgfactory`。
- Node.js 24・npm workspaces。配布するnpmパッケージは1つです。
- 共通TypeScriptエンジンを、CLI・ローカルWeb・stdio MCP・Cloudflare Web/MCPが利用します。
- 3テンプレート、プレビュー、作成、状態確認、明示的再開を実装しました。
- 公開GitHub OAuthは認可コード＋S256 PKCE。ローカルはPAT・Device Flow・任意のgh tokenに対応します。
- Ed25519の生成、GitHub登録、Documenter公開、TagBotのSSH/tag pushを検証しました。
- 固定3リポジトリTestMinimum.jl・TestSimple.jl・TestAllInOne.jlを更新するE2Eを移植しました。新規作成受入はTestYYYYMMDDHHMMSS.jlの1件に制限します。
- Juliaコンテナは使いません。旧コード・旧Workerは参照と稼働を維持しています。

詳細な証拠と未完了項目は [ACCEPTANCE.md](ACCEPTANCE.md) にまとめています。
ローカルの配布候補は `artifacts/juliapackagefactory-pkgfactory-0.1.0.tgz` です。
負荷の実測は8同時プレビューと3テンプレートの逐次作成で、8件同時作成の最大容量は未実測です。

## URL

| 用途 | URL |
|---|---|
| 本番Web（未公開） | https://pkgfactory.ohnolab.workers.dev/ |
| 本番MCP（未公開） | https://pkgfactory.ohnolab.workers.dev/mcp |
| 検証Web | https://pkgfactory-staging.ohnolab.workers.dev/ |
| 検証MCP | https://pkgfactory-staging.ohnolab.workers.dev/mcp |

## アカウント設定

1. **npm**: このPCは `npm whoami` が `ENEEDAUTH` です。`juliapackagefactory` organizationの公開権限があるアカウントで `npm login --auth-type=web` を行います。アカウント/organizationを未作成なら先に作成します。
2. **本番GitHub OAuth App**: Client IDは `Ov23liW9Mpoaeo70n071` を設定済みです。対応するClient secretを用意します。検証用のsecretとは別です。secretはチャットやGitへ貼りません。
3. **Cloudflare本番**: 公開承認後、本番専用KVとWorker `pkgfactory` を書込み停止状態で用意します。`SESSION_KEY` を生成し、本番の `GITHUB_OAUTH_CLIENT_SECRET` をWorker Secretへ登録します。
4. **継続的な公開**: GitHub Actionsの `production` / `npm` environmentに承認者を設定します。Cloudflare用のAPI token/account IDを登録し、npmの初回公開後はTrusted Publishingを `release.yml` / environment `npm` に結び付けます。
5. **継続E2E**: 固定3リポジトリに限定した `PKGFACTORY_E2E_TOKEN` を新版のActions Secretへ登録します。旧Template repositories E2Eを停止してから、新版mainで `PKGFACTORY_TEMPLATE_E2E_ENABLED=true` を設定します。[手順とテストの役割](TESTING.md) を参照してください。

GitHub OAuthの画面ごとの設定値とsecret登録手順は [DEPLOYMENT.md](DEPLOYMENT.md) を参照してください。
初回npm公開に進む前に `npm whoami` とorganizationの権限を改めて確認します。

## 切替順序

1. 残る受入検証を終え、PR・tarball・実行結果・この手順を提示します。
2. 本番公開の承認後、旧Web/MCPの新規作成受付を停止し、実行中操作と残存ロックをGitHubの状態と照合します。
3. 新版の本番KV・secretsを設定し、`MAINTENANCE=true` で配備します。
4. Web/MCPの案内先を上記の短いURLへ切り替えます。MCP POSTをHTTPリダイレクトで移転させません。
5. 新版の受付を有効化し、本番認可と疎通を確認します。承認済みのnpmパッケージを公開します。
6. 旧Juliaコンテナと専用設定を撤去します。未解決操作を新版で自動再送しません。
7. 旧READMEの更新内容と最終状態を提示し、アーカイブ承認後に `PkgFactory.jl` をアーカイブします。

観察期間や完全互換の移行は設けません。問題があれば新版をmaintenanceに戻し、150秒以上待って状態を照合してから明示的に再開します。
