# jp-phone-number-db

総務省が公開している「[電気通信番号指定状況](https://www.soumu.go.jp/main_sosiki/joho_tsusin/top/tel_number/number_shitei.html)」
から、日本の電話番号の決まり（市外局番の桁数・番号の種類ごとの桁数と区切り）を作って配布しています。
毎日自動チェックし、元データが更新されていれば追随します（[GitHub Actions](.github/workflows/update-db.yml)）。

- **`jp_phone_number.json`**（正本）: 番号を「03-1234-5678」「0467-12-3456」「090-1234-5678」のように
  区切る・桁数を確かめるための表。入力フォームの検証やハイフン入れにそのまま使えます（約 15KB）。
- **`jp_phone_number.db`**（SQLite3）: 元データの番号ブロック（「0 + 市外局番 + 市内局番」の 6 桁）
  ごとの行。市内局番ごとの事業者・使用中/未使用・番号区画コードを引けます（約 3.5MB）。

固定電話の市外局番は「前の数字が同じなら長い方」だけでは決まりません（015 と 0154 はどちらも
市外局番で、015-41 は 015、0154-2 は 0154）。そこで元データの約 4 万の番号ブロックを木にして、
「この頭（先頭の数字）なら市外局番は何桁か」を、できるだけ短い頭の組（約 250 個）に縮めています。

## ダウンロード

以下のURLから常に最新版を取得できます（[Releases](https://github.com/kobesoft-inc/jp-phone-number-db/releases)）。

```
https://github.com/kobesoft-inc/jp-phone-number-db/releases/latest/download/jp_phone_number.json
https://github.com/kobesoft-inc/jp-phone-number-db/releases/latest/download/jp_phone_number.db
https://github.com/kobesoft-inc/jp-phone-number-db/releases/latest/download/jp_phone_number.schema.json
https://github.com/kobesoft-inc/jp-phone-number-db/releases/latest/download/SHA256SUMS
```

```bash
curl -L -O https://github.com/kobesoft-inc/jp-phone-number-db/releases/latest/download/jp_phone_number.json
curl -L -O https://github.com/kobesoft-inc/jp-phone-number-db/releases/latest/download/SHA256SUMS
shasum -a 256 -c SHA256SUMS --ignore-missing
```

最新の `jp_phone_number.json` はリポジトリにも置いてあり（[`jp_phone_number.json`](jp_phone_number.json)）、
コミットの履歴で表の移り変わりを追えます。

## jp_phone_number.json の形

形は [`jp_phone_number.schema.json`](jp_phone_number.schema.json)（JSON Schema）のとおりです。

```jsonc
{
  "format": 1,                     // このファイルの形の版
  "version": "2026-09-01",         // データの版（中身が変わったときの総務省のページの時点）
  "generatedAt": "2026-09-23T10:34:58Z",
  "source": {
    "publisher": "総務省",
    "page": "https://www.soumu.go.jp/main_sosiki/joho_tsusin/top/tel_number/number_shitei.html",
    "asOf": "2026-09-01",          // ページの時点
    "license": "公共データ利用規約（第1.0版）",
    "credit": "「電気通信番号指定状況」（総務省）（https://www.soumu.go.jp/…/number_shitei.html）を加工して作成",
    "files": [                     // 元にした「1〜9 から始まる市外局番」の Excel（ファイルごとの日付）
      { "title": "1から始まる市外局番", "url": "https://www.soumu.go.jp/main_content/000697543.xls",
        "asOf": "令和6年9月1日現在", "date": "2024-09-01", "rows": 4410 }
      // …
    ],
    "rows": 41987                  // 番号ブロックの行の合計
  },
  "services": [                    // 市外局番を使わない番号
    { "prefix": "090", "kind": "mobile", "label": "携帯電話", "length": 11, "groups": [3, 4, 4], "designated": true },
    { "prefix": "0120", "kind": "toll_free", "label": "フリーダイヤル", "length": 10, "groups": [4, 3, 3], "designated": true }
    // …
  ],
  "fixed": {                       // 固定電話
    "kind": "fixed", "label": "固定電話", "length": 10,
    "subscriberFirstDigits": "123456789",
    "areaCodes": ["011", "0123", "…"],
    "areaCodeLength": { "01": 4, "011": 3, "015": 3, "0154": 4, "03": 2, "…": 0 }
  }
}
```

### services（市外局番を使わない番号）

| prefix | kind | 番号の種類 | 桁数 | 区切り |
| --- | --- | --- | --- | --- |
| 060・070・080・090 | `mobile` | 携帯電話（070 は PHS を含む） | 11 | 3-4-4 |
| 050 | `ip` | IP 電話 | 11 | 3-4-4 |
| 020 | `m2m` | データ通信（M2M） | 11 | 3-4-4 |
| 0200 | `m2m` | データ通信（M2M・14 桁） | 14 | 4-5-5 |
| 0120 | `toll_free` | フリーダイヤル | 10 | 4-3-3 |
| 0800 | `toll_free` | フリーダイヤル | 11 | 4-3-4 |
| 0570 | `shared_cost` | ナビダイヤル | 10 | 4-3-3 |
| 0180 | `mass_calling` | テレドーム | 10 | 4-3-3 |
| 0990 | `premium` | 情報料代理徴収 | 10 | 4-3-3 |

- 頭（`prefix`）は**長く当たるものが勝ちます**（0800 は 080 より先、0200 は 020 より先）。
- `length`（0 を含めた桁数）と `groups` は Excel には無いため、電気通信番号計画（令和元年総務省告示第6号）
  の別表から [`services.json`](services.json) に手で書いています。告示が変わったらここを直します。
- `designated` は総務省のページで事業者への指定があるか（「指定なし」なら `false`）で、毎回ページから読みます。

### fixed（固定電話）の引き方

固定電話は 0 を含めて 10 桁です。市外局番の桁数は、`areaCodeLength` の頭のうち番号に当たる
**いちばん長いもの**の値です。市内局番は `10 - 市外局番の桁 - 4` 桁、加入者番号は 4 桁です。

```js
const table = JSON.parse(await (await fetch(url)).text());
const keys = Object.keys(table.fixed.areaCodeLength).sort((a, b) => b.length - a.length);

function areaCodeLength(digits) {
  const hit = keys.find((k) => digits.startsWith(k));
  return table.fixed.areaCodeLength[hit];
}

areaCodeLength('0312345678');  // 2 → 03-1234-5678
areaCodeLength('0154123456');  // 3 → 015-412-3456
areaCodeLength('0154234567');  // 4 → 0154-23-4567
areaCodeLength('0126723456');  // 5 → 01267-2-3456
```

元データの「未使用」の番号ブロックも含めて表にしています（あとで使い始めても、区切り方は変わりません）。

## jp_phone_number.db のテーブル構成

| テーブル | 内容 |
| --- | --- |
| `number_blocks` | 番号ブロック（6 桁）→ 市外局番・市内局番・番号区画コード・事業者・使用状況（元データの行そのまま） |
| `area_code_rules` | 頭 → 市外局番の桁数（`jp_phone_number.json` の `fixed.areaCodeLength` と同じ） |
| `services` | 市外局番を使わない番号（`jp_phone_number.json` の `services` と同じ。`groups` は `3-4-4` の形） |
| `source_files` | 元にした Excel ごとの URL・日付・行数 |
| `meta` | 版・作った日時・出典など |

### number_blocks（番号ブロック）

| カラム | 内容 |
| --- | --- |
| number | 「0 + 市外局番 + 市内局番」の 6 桁（例: `035253`） |
| area_code | 市外局番（0 を含む。例: `03`） |
| local_code | 市内局番（例: `5253`） |
| ma_code | 番号区画コード（3 桁。番号管理上の数字で、ダイヤルする番号とは関係ありません） |
| carrier | 指定を受けた事業者名（元データのまま） |
| status | `使用中` / `未使用` |
| note | 備考（多くは空文字列） |

固定電話の番号は、頭 6 桁でそのまま引けます。

```sql
SELECT area_code, local_code, carrier, status
FROM number_blocks
WHERE number = substr('0352535111', 1, 6);
-- 03 | 5253 | 東日本電信電話株式会社 | 使用中
```

番号区画コードに対応する地域名（市区町村）は元の Excel に無いため、収録していません
（総務省「[市外局番の一覧](https://www.soumu.go.jp/main_sosiki/joho_tsusin/top/tel_number/shigai_list.html)」を参照してください）。

## 更新頻度

毎日09:00 JSTに、総務省のページから最新の Excel を読み直して表を作り、**中身が前回と変わった場合のみ**
コミットして最新版をリリースします（更新が無い日は何もしません）。総務省はページの時点を毎月進めますが、
更新のない番号種別のファイルはそのままなので、ページの時点だけが進んだときはリリースしません。
リリースのタグは `db-<データの版>`（例: `db-2026-09-01`）です。過去のリリースは残さず、常に最新版のみを
公開しています。

元データの読み損ねでおかしな表を出さないよう、次の場合は失敗してリリースしません（[`check.mjs`](check.mjs)）。

- 形が JSON Schema の決まりに合わない、よく知られた番号（03・06・0467・01267 など）の市外局番が合わない
- 前回より市外局番が 2% より多く減った、頭の決まりの数が 15% より多く変わった、番号ブロックが 5% より多く減った

総務省側の大きな変更が本物の場合は、差分を確認した上で `workflow_dispatch` の `allow_large_change` を付けて流します。

## ライセンス

このリポジトリのコード（`build.mjs`等）は MIT License です。

電話番号のデータ自体は、総務省のホームページのコンテンツとして
「[公共データ利用規約（第1.0版）](https://www.digital.go.jp/resources/open_data/public_data_license_v1.0)」
（クリエイティブ・コモンズ 表示 4.0 国際 と互換）に準拠した利用条件の下で提供されています。
このリポジトリの配布物は元の Excel を加工して作ったものなので、利用の際は次のように出典と加工した旨を
記載してください（`jp_phone_number.json` の `source.credit` にも同じ文言が入っています）。

> 「電気通信番号指定状況」（総務省）（https://www.soumu.go.jp/main_sosiki/joho_tsusin/top/tel_number/number_shitei.html）を加工して作成

加工した情報を、あたかも国（総務省）が作成したかのような態様で公表・利用することはできません。
詳細は総務省「[当省ホームページについて](https://www.soumu.go.jp/menu_kyotsuu/policy/tyosaku.html)」を参照してください。

## 自分でビルドする場合

Node.js 22.5 以上のみで動作します（追加の依存ライブラリは不要。SQLite3 の書き出しには `node:sqlite` を使います）。

```bash
node build.mjs          # dist/ に jp_phone_number.json・.db・.schema.json・SHA256SUMS を出す
node check.mjs          # 決まりに合うか・前回（./jp_phone_number.json）との違いを見る
node --test test/       # テスト
```

総務省のページから「1から始まる市外局番」〜「9から始まる市外局番」の Excel（.xls）の場所を毎回
拾い（ファイルの番号は差し替えのたびに変わるため決め打ちにしていません）、ダウンロードして表を作ります。
1 つの項目に新旧 2 つのファイルが並んでいるときは、ファイルの中の日付が新しい方を使います。
手元に置いたファイルから作るときは、ページ（`number_shitei.html`）と .xls を 1 つのディレクトリに置いて
`node build.mjs --from <dir>` とします。

.xls（Excel 97-2003 形式）は [`lib/xls.mjs`](lib/xls.mjs) の小さな読み手（複合ファイルと BIFF8 の
セルの値だけを読む）で読んでいます。

- データソース: [電気通信番号指定状況](https://www.soumu.go.jp/main_sosiki/joho_tsusin/top/tel_number/number_shitei.html)
- 自動更新の仕組みは [`.github/workflows/update-db.yml`](.github/workflows/update-db.yml) を参照してください。
