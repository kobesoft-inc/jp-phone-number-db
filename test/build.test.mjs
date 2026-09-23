import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { warekiToIso } from '../lib/wareki.mjs';
import { compress, readSheet } from '../lib/areaCodes.mjs';
import { parsePage } from '../lib/soumu.mjs';
import { compare, digest, validate } from '../lib/table.mjs';

const committed = JSON.parse(readFileSync(new URL('../jp_phone_number.json', import.meta.url), 'utf8'));

test('和暦の日付を読む', () => {
    assert.equal(warekiToIso('令和６年９月１日現在'), '2024-09-01');
    assert.equal(warekiToIso('令和元年5月1日'), '2019-05-01');
    assert.equal(warekiToIso('平成31年4月30日'), '2019-04-30');
    assert.throws(() => warekiToIso('2024年9月1日'));
});

test('シートの行を読む（見出しが違えば止める）', () => {
    const header = ['番号区画コード', '番号', '市外局番', '市内局番', '事業者', '使用状況', '備考'];
    const sheet = readSheet([
        [undefined, undefined, undefined, undefined, undefined, undefined, '(令和８年９月１日現在)'],
        header,
        ['001', '011200', '011', '200', '東日本電信電話株式会社', '使用中'],
    ]);
    assert.equal(sheet.date, '2026-09-01');
    assert.deepEqual(sheet.blocks[0], {
        number: '011200', areaCode: '011', localCode: '200', maCode: '001', carrier: '東日本電信電話株式会社', status: '使用中', note: '',
    });
    assert.throws(() => readSheet([['(令和８年９月１日現在)'], ['番号', ...header.slice(1)]]));
    assert.throws(() => readSheet([['(令和８年９月１日現在)'], header, ['001', '011200', '012', '200', '', '']]));
});

test('015 と 0154 のように頭が重なる市外局番も縮めた表で引ける', () => {
    const blocks = [];
    for (const d of '0123456789') blocks.push({ number: `0154${d}0`.slice(0, 6), areaCode: '0154' });
    for (const d of '0123456789') blocks.push({ number: `01541${d}`, areaCode: '015' });
    for (const d of '23') blocks.push({ number: `0152${d}0`, areaCode: '015' });
    const table = compress(blocks.filter((b, i, all) => all.findIndex((o) => o.number === b.number) === i));
    const find = (n) => table[Object.keys(table).sort((a, b) => b.length - a.length).find((k) => n.startsWith(k))];
    assert.equal(find('015412'), 3);
    assert.equal(find('015423'), 4);
    assert.equal(find('015230'), 3);
});

test('ページから時点・Excel の場所・指定なしを読む', () => {
    const items = [...'12345678'].map((d) => `<li>${d}から始まる市外局番[<a href="/main_content/00000${d}.pdf">PDF形式</a>、<a href="/main_content/10000${d}.xls">Excel形式</a>]</li>`);
    const html = `
        <p>本ページに掲載している電気通信番号の指定状況は、令和8年9月1日時点のものです。</p>
        <li>着信課金機能（0120） [<a href="/a.pdf">PDF形式</a>]</li>
        <li>大量呼受付機能（0180） 　　指定なし</li>
        ${items.join('\n')}
        <li>9から始まる市外局番[<a href="/main_content/200009.pdf">PDF形式</a>、<a href="/main_content/200009.xls">Excel形式</a><a href="/main_content/100009.xls"><img></a>]</li>`;
    const page = parsePage(html, ['0120', '0180']);
    assert.equal(page.asOf, '2026-09-01');
    assert.equal(page.fixed.length, 9);
    assert.deepEqual(page.fixed[8].candidates, ['https://www.soumu.go.jp/main_content/200009.xls', 'https://www.soumu.go.jp/main_content/100009.xls']);
    assert.deepEqual(page.designated, { '0120': true, '0180': false });
    assert.throws(() => parsePage(html, ['0990']));
    assert.throws(() => parsePage(html.replace('時点', ''), ['0120']));
});

test('置いてある表は決まりに合う', () => {
    assert.deepEqual(validate(committed), []);
});

test('大きく減ったら止める・時刻とページの時点だけの違いは変わったことにしない', () => {
    const shrunk = structuredClone(committed);
    shrunk.fixed.areaCodes = shrunk.fixed.areaCodes.slice(0, 300);
    assert.ok(compare(committed, shrunk).errors.length > 0);

    const fewerRules = structuredClone(committed);
    fewerRules.fixed.areaCodeLength = Object.fromEntries(Object.entries(committed.fixed.areaCodeLength).slice(0, 150));
    assert.ok(compare(committed, fewerRules).errors.length > 0);

    const later = { ...structuredClone(committed), generatedAt: '2099-01-01T00:00:00Z', version: '2099-01-01' };
    later.source.asOf = '2099-01-01';
    assert.deepEqual(compare(committed, later).errors, []);
    assert.equal(digest(later), digest(committed));

    const changed = structuredClone(committed);
    changed.source.files[0].asOf = '令和99年1月1日現在';
    assert.notEqual(digest(changed), digest(committed));
});
