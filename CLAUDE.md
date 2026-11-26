# プロジェクトのルール

## 基本
- ユーザーとのやり取り、UIの文言、設計書は日本語。コード中の識別子は英語、コメントは日本語でよい。
- ユーザーは非エンジニア寄り。報告は結論から短く書き、専門用語には一言説明を添える。
- 依頼があいまいなときは、選択肢とおすすめを示してから進める。要件が決まっていない段階で実装に入らない。
- 5分以上かかりそうな作業は、始める前にユーザーへ報告する。報告には、やること、おおよその所要時間、並行で進めるかどうかを書く。進行中に見込みより長引きそうになったら、その時点で状況と残りの見込みを伝える。

## 役割分担：思考・判断は Opus、実行は Sonnet

| 担当 | モデル | やること |
| --- | --- | --- |
| メインセッション | Opus | 調査、要件整理、設計、アルゴリズムの決定、仕様作成、レビュー、commit / push、ユーザーへの報告 |
| `implementer`（`.claude/agents/implementer.md`） | Sonnet | 仕様どおりの実装・修正、ビルド・テスト・lint の実行 |
| `designer`（`.claude/agents/designer.md`） | Opus | 見た目・情報設計・デザインシステムの評価と改善提案（コードは編集しない） |
| `ergonomics`（`.claude/agents/ergonomics.md`） | Opus | ジムでの使用環境を前提にした操作性・視認性・認知負荷・エラー防止の評価と改善提案（コードは編集しない） |
| `sports-scientist`（`.claude/agents/sports-scientist.md`） | Opus | 論文を本文で確かめ、理論・目標算出・しきい値の根拠を評価（コードは編集しない） |
| `cv-engineer`（`.claude/agents/cv-engineer.md`） | Opus | 動画フォーム解析の計測精度・撮影条件・誤差の扱いを評価（コードは編集しない） |
| `code-reviewer`（`.claude/agents/code-reviewer.md`） | Opus | 不具合・データ破損・安全面・ルール違反を再現条件つきで報告（コードは編集しない） |
| `qa-tester`（`.claude/agents/qa-tester.md`） | Sonnet | アプリを実際に操作して動作確認し、再現手順とスクリーンショットつきで報告（コードは編集しない） |

### チームの使い方（作業の種類ごと）
| 作業 | 事前の評価・調査（並行） | 実装 | 実装後の確認（並行） |
| --- | --- | --- | --- |
| 理論・目標算出のロジック | `sports-scientist` | `implementer` | `code-reviewer` |
| 動画フォーム解析 | `cv-engineer`、根拠が要るときは `sports-scientist` | `implementer` | `code-reviewer`、`qa-tester` |
| 画面を新しく作る・大きく変える | `designer`、`ergonomics` | `implementer` | `qa-tester` |
| 不具合の修正 | 原因が分からなければ `code-reviewer` または `cv-engineer` | `implementer`（数行ならメイン） | `qa-tester`（画面に関わるとき） |
| PR・リリースの前 | — | — | `code-reviewer`、`qa-tester` |

- メインは各メンバーの報告をまとめて判断し、最終的な仕様・修正の要否・commit / push を決める。メンバーの報告は鵜呑みにせず、ビルド・テスト・lint はメインでも実行する。
- 画面の評価で `designer` と `ergonomics` の提案が対立したら、ジムでの使いやすさ（`ergonomics`）を優先し、判断の理由をユーザーに伝える。
- 根拠の評価で `sports-scientist` と他のメンバーの意見が対立したら、論文で確かめられた内容を優先する。
- 評価・確認だけのメンバーは同じファイルを触らないので、並行して依頼してよい。

- メインセッションが Opus 以外で動いていると分かったら、最初にユーザーへ伝える（`/model opus` で切り替え可能）。
- **任せる作業：** 新しい画面・コンポーネント、まとまった関数の追加、テストの追加、複数ファイルにまたがる修正。
- **メインが直接やる作業：** 数行の修正、CLAUDE.md・README・設定ファイルの編集、調査のための閲覧・検索・テスト実行。依頼文を書くほうが手間な作業は任せない。
- 互いに独立した作業は、別々の `implementer` に並行して依頼してよい。同じファイルを触る作業は1つにまとめる。

### 実装を任せる手順
1. 仕様を決める。依頼文は次の形で、それだけで作業できるように書く。
   ```
   目的：何のための変更か（1〜2行）
   変更するファイル：パスと、それぞれで何をするか
   仕様：関数・型・画面の形、守る条件、扱う例外ケース
   触らないもの：変更してはいけないファイルや挙動
   完了の基準：npm run build / npm test / npm run lint が通る、追加すべきテスト
   ```
2. Agent ツールで `subagent_type: "implementer"` を指定して依頼する。
3. 差分を `git diff` で読み、下の「レビューの観点」で確認する。直すべき点があれば、具体的な修正指示をつけて再依頼する。2回直しても仕様どおりにならない場合は、仕様の書き方を見直すか、メインが直接直す。
4. レビューが通ったら、メインが commit / push し、ユーザーに結果を報告する。

### レビューの観点
- 仕様どおりか。仕様にない変更・依存パッケージの追加が混ざっていないか。
- 筋トレのロジックが設計書（下記）と矛盾していないか。
- ビルド・テスト・lint が通っているか（報告を鵜呑みにせず、メインでも実行する）。
- スマホ幅（360px）で崩れないか、保存できない環境でも画面が壊れないか。

## 完了の定義
- リポジトリのルートで `npm run build`、`npm test`、`npm run lint` がすべて通る。
- ロジックを変えたら `src/logic.test.ts` にテストを追加・更新する。
- 失敗やスキップがある場合は、そのままユーザーに報告する。

## Git
- 作業ブランチにコミットし、push する。PR はユーザーに頼まれたときだけ作る。
- コミットメッセージは英語で、何をなぜ変えたかを書く。`node_modules/` と `dist/` はコミットしない。

## プロジェクト構成（筋トレログアプリ）
- このリポジトリは筋トレログアプリ専用。音楽ツール（Loop Studio）は別リポジトリ `music-gene-app` にあり、ここには含めない。
- 公開：本流ブランチ（main）への push で GitHub Actions が lint・テスト・ビルドを通してから GitHub Pages（https://masa-taka-code.github.io/workout-app/）に公開する（`.github/workflows/deploy.yml`）。
- Vite + React 19 + TypeScript、グラフは Recharts、テストは Vitest。
- データはブラウザの localStorage にのみ保存する（キー `workout-app:data`）。サーバーや外部通信は追加しない。localStorage の読み書きは必ず try/catch で囲む。
  - 例外（ユーザー承認済みの機能）：動画フォーム採点の解析部品（MediaPipe の wasm を cdn.jsdelivr.net から、姿勢推定モデルを storage.googleapis.com から）だけは初回にダウンロードし、Service Worker でキャッシュする。ユーザーの映像・記録は一切送らない。これ以外の外部通信は追加しない。
- データ形式（`src/types.ts`）を変えたら、`src/storage.ts` の読み込み処理で古いデータを補えるようにする。
- 目標算出のロジックは `src/logic.ts` に純粋関数として置き、画面のコードには書かない。
- UI はスマホ優先（幅360px で横スクロールなし、タップ領域44px 以上）、ダークモード対応。

## 設計書（判断の根拠）
- [筋トレログアプリ 概要設計書](https://claude.ai/artifact/XBGpDVXYmPcRmtQzSDYiAv)：機能、画面、データモデル。
- [筋肥大理論とアルゴリズム設計](https://claude.ai/artifact/VWJQP3karjk9thZSAzXhrv)：週10〜20セット、RIR 0〜2、RIR補正のダブルプログレッション、停滞時のみデロード、動画フォーム解析の構成。
- `src/logic.ts` の定数（`WEEKLY_MIN` / `WEEKLY_MAX` / `SESSION_CAP` など）や判定条件を変えるときは、先に設計書を更新し、根拠（論文）を示す。

## 論文調査のやり方
- 根拠は論文の本文（無理なら抄録）で確かめる。検索結果の要約だけで数値を書かない。読めた範囲（本文／抄録／プレプリント）を必ず記録する。
- この環境で開ける論文サイト：PubMed・PMC・www.ncbi.nlm.nih.gov・arXiv・SportRxiv・PeerJ・Frontiers。NCBI の通常のページは curl だとブラウザ確認の画面が返るので、公式の BioC API を使う：
  - 抄録：`https://www.ncbi.nlm.nih.gov/research/bionlp/RESTful/pubmed.cgi/BioC_json/<PMID>/unicode`
  - PMC 全文：`https://www.ncbi.nlm.nih.gov/research/bionlp/RESTful/pmcoa.cgi/BioC_json/<PMCID>/unicode`
  - 検索：`https://www.ncbi.nlm.nih.gov/research/pubtator3-api/search/?text=<語>`
- 論文の値とアプリの設計値（暫定のしきい値・重み）を混ぜない。設計値はコードのコメントと設計書に「設計値」「暫定」と書く。
- 本文での確認結果は設計書「筋肥大理論とアルゴリズム設計」の「論文本文での確認と修正」の節にまとめる。
