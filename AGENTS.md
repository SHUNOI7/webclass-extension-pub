# webclass-extension/

WebClass Tampermonkey 拡張機能一式。

## ファイル

### `manifest.json`
Chrome 拡張機能の設定ファイル（Manifest V3）。対象URL・content script の指定。

### `content.js`
Chrome 拡張機能のコンテンツスクリプト本体。`manifest.json` から読み込まれる。機能は `webclass-improve.user.js` と同一。

### `webclass-improve.user.js`
Tampermonkey 用ユーザースクリプト（Chrome拡張機能版と並行して保持）。WebClass（香川大学医学部）のコースリストページに時間割グリッドと未提出課題一覧を追加する。

**対象URL**: `https://gymnast15.med.kagawa-u.ac.jp/webclass/*`

**現在の機能 (v3.1)**:

1. **未提出課題一覧**（サイドバー「課題実施状況一覧」に表示）
   - 医学科2年の全15科目を対象に `score_summary_table` API を並列フェッチ
   - `answer_datetime === null`（未提出）の課題を絞り込み
   - 提出期限順にソート
   - 色分け：24時間以内→赤、1週間以内→オレンジ、それ以外→グレー
   - ダッシュボードへのリンクも表示

2. **期限の優先順位と上書き**
   - `end_date`（システム期限）をデフォルトとして使用
   - ⚙ボタンで設定パネルを開き、講義ごとに「授業日（`start_date`）からN日以内」というルールを設定可能（`localStorage: wc-deadline-rules`）
   - ✎ボタンで課題単位の手動上書き（`localStorage: wc-deadline-overrides`）
   - 優先順位：手動上書き（**手動**バッジ）> 講義ルール（**ルール**バッジ）> `end_date`
   - ↩ボタンで手動上書きを解除
   - ルール変更後は「適用」ボタンでリストに反映
   - APIレスポンスは `cachedResults` にキャッシュし、再フェッチなしで再レンダリング可能

3. **時間割グリッド**（ページ最上部 `#UserTopInfo` の直前に挿入）
   - 前期①/②・後期①/② の4タブ切り替え
   - 現在の日付に応じて自動的に対応タブを初期表示
   - タブ選択状態は `sessionStorage` に保存（リロード後も維持）
   - 各セルは科目コースページへの直リンク（`acs_=` トークンを自動取得）
   - 4/27以降は月曜Ⅲ〜Ⅴ限が解剖学Ⅱ→生理学Ⅰに切り替わる
   - モノトーン系カラーリング

4. **お知らせバナー**（「課題実施状況一覧」見出しの直上に表示）
   - GitHub Gist（`gistfile1.txt`）から JSON を毎回フェッチ（キャッシュバイパス）
   - JSON形式：`{"id": "1", "message": "テキスト"}`
   - `message` が空なら非表示
   - メッセージ内容が変わると最小化が自動解除されて展開表示
   - ▲で最小化、▼クリックで再展開（状態は `localStorage: wc-announcement` に保存）
   - Gist URL: `https://gist.githubusercontent.com/SHUNOI7/b5b36b026e7e4bfa7a77c02819bfb237/raw/gistfile1.txt`

**使用API**:
- `GET /webclass/ip_mods.php/plugin/score_summary_table/contents?group_id={courseId}` — 課題一覧取得（`start_date`・`end_date`・`contents_name`・`scores` を使用）

**localStorage キー一覧**:
| キー | 内容 |
|------|------|
| `wc-deadline-rules` | 講義ごとのN日ルール `{ courseId: N }` |
| `wc-deadline-overrides` | 課題単位の上書き `{ "courseId:課題名": ISO日時文字列 }` |
| `wc-announcement` | お知らせの既読・最小化状態 `{ seenMessage, minimized }` |

**硬直コースID（医学科2年 2026年度 全15科目）**:
| 科目 | courseId |
|------|----------|
| 分子生物学 | `8d5215783015764ce951cc9024a8efa9` |
| 分子遺伝学 | `fdc0989de1e818adafa59ccf8f40c39a` |
| 医学と研究 | `3c58a2eebd8d277e8a23660cba8607f2` |
| 医学・医療と社会 | `38a9d09f451ee1cb82f6c6770d88ca9d` |
| 医用化学Ⅱ | `14f26982e6d4628008ca1272a3a3cfcd` |
| 医療倫理学 | `1af3888f3b4f25f3c99c6d09ca8bdbf7` |
| 患者との出会い | `9b3e1287ccdd818baae60be6ec73c9c1` |
| 早期医学実習Ⅱ | `19e2e404088da5a87f17b10be54392ce` |
| 生化学 | `49f9ee1ac60effa5895a47682fb6198e` |
| 生理学Ⅱ | `235d2308e5452e1b8e1cbcd801b9d6e2` |
| 生理学Ⅰ | `6d5e784a3c6676d64fae08ec8417ae70` |
| 細胞生物学 | `06b305e2e2aefec207ec25f0bf93018e` |
| 行動科学 | `28e51271a617bb1de7d40b2472c43118` |
| 解剖学Ⅱ | `6b114e2b135f7aac169bc428f00951aa` |
| 解剖学Ⅰ | `aea2184cf7cd67f5ea205f70e8a9a8ab` |

### `webclass-grid-mock.html`
時間割グリッドの HTML モック（デザイン確認用）。実装前にブラウザで開いて見た目を確認するために作成。

### `sources/`
WebClass から取得した HTML ソース・ネットワークログの保管場所。
- `page-source.html` — コースリストページの HTML ソース（2026-03-31 取得）
- `dashboard-source.html` — ダッシュボードページの HTML ソース（SPA構成確認用）
- `network-log.txt` — ダッシュボードページの HAR ネットワークログ（API調査用）

## WebClass ページ構造メモ（コースリスト）

```
ul.courseTree.courseLevelOne
  li
    h4.courseTree-levelTitle  ← セクション名（「医学部」「医学部 医学科 専門基礎...」）
    ul.courseTree.courseLevelTwo
      li
        div.title > h5        ← グループ名（「医学科　２年生」等）
        ul.courseTree.courseList
          li
            div.course-title > a[href]  ← コース名・リンク
            span.course-info            ← 年度・学期情報
```

コースリンク形式: `/webclass/course.php/{courseId}/login?acs_=...`
