#!/usr/bin/env node
/**
 * 総務省「電気通信番号指定状況」から、日本の電話番号の決まりを作る。
 *
 *   node build.mjs                      # 総務省のページから取ってきて dist/ に出す
 *   node build.mjs --from <dir>         # 手元に置いたページ（number_shitei.html）と .xls から作る
 *   node build.mjs --out <dir>          # 出す先（既定 dist/）
 *
 * 出すもの
 *   jp_phone_number.json          番号の決まり（正本）
 *   jp_phone_number.db            番号ブロック（6 桁）ごとの元の行（SQLite3）
 *   jp_phone_number.schema.json   JSON の形
 *   SHA256SUMS                    上の 3 つの SHA-256
 *
 * Node.js 22.5 以上（node:sqlite を使う）。依存ライブラリは無い。
 */
import { copyFile, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { readFirstSheet } from './lib/xls.mjs';
import { compress, readSheet } from './lib/areaCodes.mjs';
import { PAGE, decodePage, fetchBuffer, parsePage } from './lib/soumu.mjs';
import { FORMAT, LICENSE, credit, validate } from './lib/table.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const option = (name) => {
    const i = args.indexOf(name);
    return i >= 0 ? args[i + 1] : undefined;
};
const fromDir = option('--from');
const outDir = option('--out') ?? join(here, 'dist');

const { services: serviceSpecs } = JSON.parse(await readFile(join(here, 'services.json'), 'utf8'));

// 1. ページ
const pageHtml = fromDir
    ? decodePage(await readFile(join(fromDir, 'number_shitei.html')))
    : decodePage(await fetchBuffer(PAGE));
const page = parsePage(pageHtml, serviceSpecs.map((s) => s.prefix));

// 2. 市外局番の Excel（1 項目に新旧が並ぶときは、中の日付がいちばん新しいものを使う）
const local = fromDir ? new Set(await readdir(fromDir)) : null;
const files = [];
const blocks = [];
for (const item of page.fixed) {
    let best = null;
    for (const url of item.candidates) {
        const name = url.split('/').pop();
        if (local && !local.has(name)) continue;
        const buf = local ? await readFile(join(fromDir, name)) : await fetchBuffer(url);
        const sheet = readSheet(readFirstSheet(buf).rows);
        if (sheet.blocks.some((b) => b.number[1] !== item.digit)) throw new Error(`${url} に ${item.digit} から始まらない番号があります`);
        if (!best || sheet.date > best.sheet.date) best = { url, sheet };
    }
    if (!best) throw new Error(`${item.title} の Excel が読めません`);
    files.push({ title: item.title, url: best.url, asOf: best.sheet.asOf, date: best.sheet.date, rows: best.sheet.blocks.length });
    blocks.push(...best.sheet.blocks);
}

const numbers = new Set();
for (const b of blocks) {
    if (numbers.has(b.number)) throw new Error(`番号ブロックが重なっています: ${b.number}`);
    numbers.add(b.number);
}

// 3. 表にする
const table = {
    $schema: 'https://github.com/kobesoft-inc/jp-phone-number-db/releases/latest/download/jp_phone_number.schema.json',
    format: FORMAT,
    version: page.asOf,
    generatedAt: new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'),
    source: {
        publisher: '総務省',
        title: '電気通信番号指定状況（電気通信番号計画（令和元年総務省告示第6号）第1第4項による公表）',
        page: PAGE,
        asOf: page.asOf,
        license: LICENSE.name,
        licenseUrl: LICENSE.url,
        credit: credit(PAGE),
        files,
        rows: blocks.length,
    },
    services: serviceSpecs.map((s) => ({ ...s, designated: page.designated[s.prefix] })),
    fixed: {
        kind: 'fixed',
        label: '固定電話',
        length: 10,
        /*
         * 市外局番の次（市内局番の頭）に来てよい数字。0 は使わない。
         * 1 も今は割り当てが無いが、「03-1234-5678」のような見本の番号に広く使われるので通す
         */
        subscriberFirstDigits: '123456789',
        areaCodes: [...new Set(blocks.map((b) => b.areaCode))].sort(),
        areaCodeLength: compress(blocks),
    },
};

const errors = validate(table);
if (errors.length) {
    for (const e of errors) console.error(`  ✗ ${e}`);
    throw new Error('できた表が決まりに合いません');
}

// 4. 書き出す
await mkdir(outDir, { recursive: true });
const jsonPath = join(outDir, 'jp_phone_number.json');
await writeFile(jsonPath, `${JSON.stringify(table, null, 2)}\n`);
await copyFile(join(here, 'jp_phone_number.schema.json'), join(outDir, 'jp_phone_number.schema.json'));

const dbPath = join(outDir, 'jp_phone_number.db');
await rm(dbPath, { force: true });
writeDatabase(dbPath, table, blocks);

const sums = [];
for (const name of ['jp_phone_number.json', 'jp_phone_number.db', 'jp_phone_number.schema.json']) {
    const hash = createHash('sha256').update(await readFile(join(outDir, name))).digest('hex');
    sums.push(`${hash}  ${name}`);
}
await writeFile(join(outDir, 'SHA256SUMS'), `${sums.join('\n')}\n`);

console.log(`版 ${table.version}（ページの時点）: 市外局番 ${table.fixed.areaCodes.length} 個・番号ブロック ${blocks.length} 行 → 頭の決まり ${Object.keys(table.fixed.areaCodeLength).length} 個`);
for (const f of files) console.log(`  ${f.title}: ${f.asOf}（${f.rows} 行） ${f.url}`);
for (const s of table.services) console.log(`  ${s.prefix} ${s.label}: ${s.designated ? '指定あり' : '指定なし'}`);

function writeDatabase(path, t, rows) {
    const db = new DatabaseSync(path);
    db.exec(`
        PRAGMA journal_mode = OFF;
        CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL) WITHOUT ROWID;
        CREATE TABLE source_files (
            digit TEXT PRIMARY KEY, title TEXT NOT NULL, url TEXT NOT NULL,
            as_of TEXT NOT NULL, date TEXT NOT NULL, rows INTEGER NOT NULL
        ) WITHOUT ROWID;
        CREATE TABLE services (
            prefix TEXT PRIMARY KEY, kind TEXT NOT NULL, label TEXT NOT NULL,
            length INTEGER NOT NULL, groups TEXT NOT NULL, designated INTEGER NOT NULL
        ) WITHOUT ROWID;
        CREATE TABLE area_code_rules (prefix TEXT PRIMARY KEY, area_code_length INTEGER NOT NULL) WITHOUT ROWID;
        CREATE TABLE number_blocks (
            number TEXT PRIMARY KEY, area_code TEXT NOT NULL, local_code TEXT NOT NULL,
            ma_code TEXT NOT NULL, carrier TEXT NOT NULL, status TEXT NOT NULL, note TEXT NOT NULL
        ) WITHOUT ROWID;
        CREATE INDEX number_blocks_area_code ON number_blocks (area_code);
        CREATE INDEX number_blocks_ma_code ON number_blocks (ma_code);
    `);
    db.exec('BEGIN');
    const meta = db.prepare('INSERT INTO meta VALUES (?, ?)');
    for (const [k, v] of Object.entries({
        format: String(t.format), version: t.version, generated_at: t.generatedAt, source_page: t.source.page,
        source_as_of: t.source.asOf, license: t.source.license, license_url: t.source.licenseUrl, credit: t.source.credit,
    })) meta.run(k, v);
    const file = db.prepare('INSERT INTO source_files VALUES (?, ?, ?, ?, ?, ?)');
    for (const f of t.source.files) file.run(f.title[0], f.title, f.url, f.asOf, f.date, f.rows);
    const service = db.prepare('INSERT INTO services VALUES (?, ?, ?, ?, ?, ?)');
    for (const s of t.services) service.run(s.prefix, s.kind, s.label, s.length, s.groups.join('-'), s.designated ? 1 : 0);
    const rule = db.prepare('INSERT INTO area_code_rules VALUES (?, ?)');
    for (const [k, v] of Object.entries(t.fixed.areaCodeLength)) rule.run(k, v);
    const block = db.prepare('INSERT INTO number_blocks VALUES (?, ?, ?, ?, ?, ?, ?)');
    for (const b of rows) block.run(b.number, b.areaCode, b.localCode, b.maCode, b.carrier, b.status, b.note);
    db.exec('COMMIT');
    db.exec('VACUUM');
    db.close();
}
