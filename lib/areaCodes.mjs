/**
 * 市外局番の Excel の行を読み、「この頭なら市外局番は何桁か」の表に縮める。
 *
 * Excel の 1 行は「0 + 市外局番 + 市内局番」の 6 桁の番号ブロックで、
 * 列は 番号区画コード・番号・市外局番・市内局番・事業者・使用状況・備考。
 * 使っていない（未使用）の行も載っているので、それも含めて表にする
 * （あとで使い始めても、区切り方は変わらない）。
 */
import { warekiToIso } from './wareki.mjs';

const HEADER = ['番号区画コード', '番号', '市外局番', '市内局番', '事業者', '使用状況'];

const cell = (v) => (v === undefined || v === null ? '' : String(v).trim());

/**
 * 1 つのファイルのシートを読む。
 *
 * @param {(string|number|undefined)[][]} rows シートの行
 * @returns {{ asOf: string, date: string, blocks: Block[] }}
 *
 * @typedef {{ number: string, areaCode: string, localCode: string, maCode: string, carrier: string, status: string, note: string }} Block
 */
export function readSheet(rows) {
    const asOfCell = (rows[0] ?? []).map(cell).filter(Boolean).join('');
    const asOf = asOfCell.normalize('NFKC').replace(/[()（）]/g, '');
    const date = warekiToIso(asOf);

    const header = (rows[1] ?? []).map(cell);
    for (let i = 0; i < HEADER.length; i++) {
        if (header[i] !== HEADER[i]) throw new Error(`見出しが違います（${i + 1} 列目: ${header[i]}）。ファイルの形が変わったかもしれません`);
    }

    const blocks = [];
    for (const r of rows.slice(2)) {
        const number = cell(r[1]);
        const areaCode = cell(r[2]);
        if (number === '' && areaCode === '') continue;
        if (!/^0\d{5}$/.test(number) || !/^0\d{1,4}$/.test(areaCode)) {
            throw new Error(`番号・市外局番の形が違います: ${number} / ${areaCode}`);
        }
        if (!number.startsWith(areaCode)) throw new Error(`番号と市外局番が合いません: ${number} / ${areaCode}`);
        const localCode = cell(r[3]);
        if (areaCode + localCode !== number) throw new Error(`市外局番 + 市内局番が番号になりません: ${number}`);
        blocks.push({
            number,
            areaCode,
            localCode,
            maCode: cell(r[0]),
            carrier: cell(r[4]),
            status: cell(r[5]),
            note: cell(r[6]),
        });
    }

    return { asOf, date, blocks };
}

/**
 * 6 桁の番号の木から「この頭なら市外局番は何桁か」を、いちばん短い頭で言える形に縮める。
 * 引く側は、その頭の中から最も長く当たるものを使う。
 *
 * 市外局番は「前の字が同じなら長い方が勝つ」だけでは決まらない。
 * 例えば 015 と 0154 はどちらも市外局番で、015-41 は 015、0154-2 は 0154。
 *
 * @param {{ number: string, areaCode: string }[]} blocks
 * @returns {Record<string, number>}
 */
export function compress(blocks) {
    const root = { children: {}, count: {} };

    for (const { number, areaCode } of blocks) {
        let node = root;
        const len = areaCode.length;
        node.count[len] = (node.count[len] ?? 0) + 1;

        for (const d of number.slice(1)) {
            node = node.children[d] ??= { children: {}, count: {} };
            node.count[len] = (node.count[len] ?? 0) + 1;
        }
    }

    const out = {};
    // 多い方を既定にする（同じ数なら短い方）
    const major = (node) => Number(Object.entries(node.count).sort((a, b) => b[1] - a[1] || Number(a[0]) - Number(b[0]))[0][0]);
    const walk = (node, prefix, inherited) => {
        const mine = major(node);
        if (mine !== inherited) out[`0${prefix}`] = mine;
        for (const d of Object.keys(node.children).sort()) walk(node.children[d], prefix + d, mine);
    };
    walk(root, '', -1);

    const table = Object.fromEntries(Object.keys(out).sort().map((k) => [k, out[k]]));
    const miss = verify(table, blocks);
    if (miss) throw new Error(`縮めた表が合いません: ${miss}`);

    return table;
}

/** 表で、どの番号ブロックも元の市外局番の桁になるか。合わない最初の番号を返す */
export function verify(areaCodeLength, blocks) {
    const keys = Object.keys(areaCodeLength).sort((a, b) => b.length - a.length);
    for (const { number, areaCode } of blocks) {
        const hit = keys.find((k) => number.startsWith(k));
        if (hit === undefined || areaCodeLength[hit] !== areaCode.length) return number;
    }

    return null;
}
