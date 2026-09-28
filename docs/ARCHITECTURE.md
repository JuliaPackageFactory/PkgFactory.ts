# 実装構成

`packages/pkgfactory` のみをnpm公開します。npm workspacesで `apps/cloudflare` と管理し、
内部依存を別npmパッケージとして公開しません。

| ディレクトリ | 責務 |
|---|---|
| `src/core` | Zod入力検証、Mustache描画、固定UUID・日付、プランのハッシュ |
| `src/github` | Fetch GitHub API、Device Flow、Web Crypto鍵生成、sealed box |
| `src/application` | プレビュー所有者、期限、リポジトリ排他、書込ジャーナル、照合・再開 |
| `src/node` | CLI、永続JSONストア、ループバックWeb、PAT/任意のgh |
| `src/web` | 共通画面、Fetch APIルート、CSRF、安全なエラー |
| `src/mcp` | 公式MCP SDK、stdio/Streamable HTTP共通ツール |
| `apps/cloudflare` | Worker、OAuth、暗号化セッション、Durable Objects、配備設定 |

ビルドはテンプレートとブラウザ資産を埋め込みます。`.github`・`.gitignore`を含めて
npm tarballで欠落しないことをインストール後に検証します。
コア・GitHubエンジンはNode固有APIやJuliaプロセスに依存しません。

## 状態モデル

```mermaid
stateDiagram-v2
    preview --> running: reviewed plan + create
    running --> complete: confirmed completion marker
    running --> paused: failure / disconnect / timeout
    paused --> running: explicit resume after lease + GitHub reconciliation
```

実行前にGitHubユーザーIDを確認し、保存済みsubjectと一致させます。
Nodeローカルアダプターのみsubjectを `local` とし、起動者の資格情報を利用します。
公開Web/MCPにサーバー共通PATのフォールバックはありません。

プレビューと成功結果は15分、subjectごとのプラン上限16、全体256、同時実行8。
中断したプラン・ロックは時間だけでは削除しません。リース終了は新しい作成の許可ではなく、
同じプランの明示的再開で照合を開始できる時刻です。

CloudflareのApplicationStateはSQLite Durable Object上でメタデータをCAS更新し、
大きな不変プランを別キーへ保存します。WebとMCPが同じ排他対象を共有します。
NodeのFileStoreは同じディレクトリを利用する複数プロセスをファイルロックとatomic renameで直列化します。
別ディレクトリ、別ホスト、Cloudflareとローカルの間に共通ロックはありません。
GitHub上のマーカーと非強制ref更新が衝突を検出します。

## 結果不明の扱い

すべてのGitHub書き込みを `pending` として送信前に記録します。
通信例外、5xx、成功応答の読み取り失敗に対して自動再送しません。429も自動再送しません。
切断時にはジャーナル保存だけを続け、GitHubの後続操作を止めます。

Cloudflareの書込み応答はJSONに空白のkeepaliveを付けたストリームです。
作成処理中は50ms間隔とGitHub操作直前に接続へ書き込み、RequestのAbortSignalとwriterの終了を
共通のAbortSignalへ接続します。接続切断を検出した後、新しいGitHub要求を送信しません。
送信済み要求がGitHubで完了した可能性は残ります。処理をQueuesやwaitUntilへ移していません。
この応答の操作失敗はHTTP 200のJSON内 `error` またはMCP `isError` で返る場合があります。
クライアントはHTTPステータスだけで成功判定しないでください。

再開ではGETでリポジトリ、default branch、マーカー、Project.toml、deploy keys、
Secretメタデータ、Pagesを照合してから残存ロックの実行権を更新します。
リポジトリ作成直後の応答喪失に備えて初期descriptionにプランIDを置き、マーカーを書いた後で
利用者のdescriptionへ変更します。証明できない既存リポジトリは引き継ぎません。
空のリポジトリをREADMEで初期化し、最初のコミット名を
`Using PkgFactory` とし、空行を挟んだ3行目に `https://github.com/JuliaPackageFactory/PkgFactory.ts` を記載します。
テンプレート追加コミットには `[skip ci]` を付け、鍵・Secret・Pages設定を終えた完了コミットでpush CIを1回起動します。
テンプレートの通常のpush/PRトリガーは変更しません。
[GitHubのコミットメッセージによるスキップ仕様](https://docs.github.com/en/actions/how-tos/manage-workflow-runs/skip-workflow-runs)
Git tree/commitだけが孤立した場合、明示的再開で新しい未参照オブジェクトを作ることがあります。

Secretの値をGitHubから読み戻すことはできません。Secret結果不明の再開は同じ秘密鍵の再送ではなく、
新しいペアへ入れ替える新規操作です。設定成功が確認できるまで古い管理鍵を削除しません。

## 認証と秘密情報

Web OAuth stateは10分・一回限りで、ログインを開始したブラウザCookieのハッシュに結び付けます。
PKCE verifierとセッションをAES-256-GCMで暗号化し、AADを保存先IDに結び付けます。
CookieにはランダムセッションIDのみ、サーバーにはそのハッシュを保存し、有効期限は8時間です。
ログアウトでサーバーのセッションを削除します。OAuth providerはMCPトークンとGitHub資格情報を分離します。
トークン・秘密鍵を操作プラン、ジャーナル、エラー本文に記録しません。
WorkerのリクエストログはOAuth codeの記録を防ぐため既定無効です。

鍵はWeb Cryptoで生成し、Ed25519はOpenSSH形式、RSA-4096はPKCS#1 PEM形式へ変換します。
Documenter/TagBot用Secretは秘密鍵のBase64、GitHubへの送信はlibsodium互換sealed boxです。
Nodeとworkerd双方の鍵PoC、および独立したlibsodiumによる復号試験があります。
