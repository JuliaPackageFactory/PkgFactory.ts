# Opusレビューへの対応（2026-09-29）

対象: [PR #1のレビュー](https://github.com/JuliaPackageFactory/PkgFactory.ts/pull/1#issuecomment-5873460848)（確認対象コミット `03e64b047730b5f7b376ec792112a848977d346c`）。

| 指摘 | 修正 | 検証 |
|---|---|---|
| `/auth/login`の認可待ちデータで共通4096件枠が埋まる | state/verifier/期限を暗号化Cookieへ移動。開始要求は接続元ごとに毎分20回。セッション用の共通件数上限と要求ごとの全件走査を廃止し、SQLite索引で検索・期限削除 | 21回目を429で拒否、別IPのログインと既存セッションは利用可能。改変・別ブラウザ・期限切れを拒否し、同時callbackは一方だけがGitHubのコード交換へ進む |
| 全体256件のプラン枠とMCPの所有者未検証 | 保存枠はsubjectごと16件。SQLで自分の記録と排他に必要な記録だけ取得。Web/MCPは共通の権限・名前照会を保存前に実行 | 17アカウント×16件を保存しても別アカウントがプレビュー可能。同一アカウントの17件目、他人の所有先、同一repoの別プランを拒否。同時実行8件制限は維持 |
| 同意画面のlocalhost警告・CIMDドメインがない | 端末内アプリへの転送と信頼するアプリかの確認を表示。検証済みclient_idから実ドメインと完全なメタデータURLを表示 | IPv4/IPv6/localhostと紛らわしい外部ドメインを区別。HTMLエスケープと実同意ルートを検証 |
| descriptionからDocumenter `@eval`等を挿入できる | README/docs用のdescriptionを文字列としてMarkdownエスケープ。GitHubメタデータは入力のまま | 3テンプレートの生成テスト。生成物CIでは無害なファイル書込みの`@eval`・`@raw`・インデント・HTMLを含む入力でJulia/Documenterを実行し、実行痕跡なし・文字列表示・HTML無害化を確認 |

既存のApplicationState/AuthStateを同じDurable Object内で移行します。旧形式の130プランと暗号化セッションを投入し、更新と再起動後に不変プラン、未確定書込み、残存リース、エラー、セッションが一致することをworkerdで検証しました。
paused/runningの記録は期限削除しません。GitHub状態の照合と明示的再開が必要です。

ローカルのオフラインCLI/stdioプレビューは認証不要のままです。公開MCPにはオフライン用の資格情報フォールバックを置きません。
ストレージの変更に新しいCloudflareバインディングやSecretは不要です。

検証結果: [修正版CIの全6ジョブ成功](https://github.com/JuliaPackageFactory/PkgFactory.ts/actions/runs/36448728883)。Node 40件・workerd 7件、3 OSの配布物インストール、3テンプレートのJuliaテスト、simple/all-in-oneの実Documenterによるdescription無害化検証を含みます。
ステージングはversion `fb751e5c-daad-40e3-9e82-514fbc96209c` へ配備しました。配備後の疎通とS256ログイン開始も成功しています。

この対策はレビューで指摘された小さな共通枠の枯渇を解消します。複数IP・複数GitHubアカウントによる大規模な負荷を無制限に処理できるという意味ではありません。同時実行は8件、利用者ごとの保存は16件を維持しています。
