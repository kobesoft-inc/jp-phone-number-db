#!/usr/bin/env node
/**
 * できた表（dist/）を確かめ、前回（リポジトリに置いてある jp_phone_number.json）と比べる。
 *
 *   node check.mjs                          # dist/ と ./jp_phone_number.json を比べる
 *   node check.mjs --allow-large-change     # 大きな変わり方でも止めない（中身を目で見たあとに）
 *
 * - 形と中身の決まり（lib/table.mjs の validate）に合わないときは失敗する
 * - 前回から市外局番・頭の決まり・番号ブロックが大きく減った・変わったときは失敗する
 *   （総務省のファイルの形が変わって読み損ねたまま出さないため）
 * - SHA256SUMS がファイルと合わないときは失敗する
 * - 中身が前回と同じかどうか（取ってきた時刻・ページの時点は見ない）を
 *   GitHub Actions の出力 changed=true|false に書く
 */
import { appendFile, readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { compare, digest, validate } from './lib/table.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const dist = join(here, 'dist');
const previousPath = join(here, 'jp_phone_number.json');
const allowLargeChange = args.includes('--allow-large-change');

const next = JSON.parse(await readFile(join(dist, 'jp_phone_number.json'), 'utf8'));
const previous = existsSync(previousPath) ? JSON.parse(await readFile(previousPath, 'utf8')) : null;

let failed = false;
const fail = (message) => {
    console.error(`✗ ${message}`);
    failed = true;
};

for (const e of validate(next)) fail(e);

for (const line of (await readFile(join(dist, 'SHA256SUMS'), 'utf8')).trim().split('\n')) {
    const [hash, name] = line.split(/\s+/);
    const actual = createHash('sha256').update(await readFile(join(dist, name))).digest('hex');
    if (actual !== hash) fail(`SHA256SUMS が ${name} と合いません`);
}

const { errors, notes } = compare(previous, next);
for (const n of notes) console.log(`- ${n}`);
for (const e of errors) {
    if (allowLargeChange) console.warn(`! ${e}（--allow-large-change のため続ける）`);
    else fail(e);
}

const changed = previous === null || digest(previous) !== digest(next);
console.log(changed ? `中身が変わりました（版 ${next.version}）` : '中身は前回と同じです');

if (process.env.GITHUB_OUTPUT) {
    await appendFile(process.env.GITHUB_OUTPUT, `changed=${changed}\nversion=${next.version}\n`);
}

if (failed) process.exit(1);
