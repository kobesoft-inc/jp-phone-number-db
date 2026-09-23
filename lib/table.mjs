/**
 * 出すもの（jp_phone_number.json）の形・中身の指紋・前回との比べ方。
 */
import { createHash } from 'node:crypto';
import { verify } from './areaCodes.mjs';

export const FORMAT = 1;
export const LICENSE = {
    name: '公共データ利用規約（第1.0版）',
    url: 'https://www.digital.go.jp/resources/open_data/public_data_license_v1.0',
};

/** 出典の書き方（総務省の「公共データ利用規約（第1.0版）に関する重要情報」の加工した場合の例に合わせる） */
export function credit(page) {
    return `「電気通信番号指定状況」（総務省）（${page}）を加工して作成`;
}

/**
 * 中身の指紋。取ってきた時刻・ページの時点・版は入れない
 * （総務省はページの時点を毎月進めるが、更新のない番号種別のファイルはそのままなので、
 * 中身が変わっていないのに出し直さないようにする）。
 */
export function digest(table) {
    const stable = {
        files: table.source.files.map(({ title, url, asOf, rows }) => ({ title, url, asOf, rows })),
        rows: table.source.rows,
        services: table.services,
        fixed: table.fixed,
    };

    return createHash('sha256').update(JSON.stringify(stable)).digest('hex');
}

/** よく知られた番号の市外局番（表が壊れていないかの目安） */
export const ANCHORS = [
    ['0312345678', '03'],
    ['0612345678', '06'],
    ['0112345678', '011'],
    ['0452345678', '045'],
    ['0781234567', '078'],
    ['0922345678', '092'],
    ['0467234567', '0467'],
    ['0154234567', '0154'],
    ['0154123456', '015'],
    ['0126723456', '01267'],
    ['0499223456', '04992'],
    ['0980234567', '09802'],
    ['0980523456', '0980'],
];

const sortedKeys = new WeakMap();

function areaCodeOf(areaCodeLength, digits) {
    if (!sortedKeys.has(areaCodeLength)) sortedKeys.set(areaCodeLength, Object.keys(areaCodeLength).sort((a, b) => b.length - a.length));
    const hit = sortedKeys.get(areaCodeLength).find((k) => digits.startsWith(k));

    return hit === undefined ? null : digits.slice(0, areaCodeLength[hit]);
}

/**
 * 形と中身の決まりを確かめる。誤りの一覧を返す（空なら良い）。
 * JSON Schema（jp_phone_number.schema.json）と同じことを、依存ライブラリ無しで見る。
 */
export function validate(table) {
    const errors = [];
    const expect = (ok, message) => {
        if (!ok) errors.push(message);
    };
    const isDate = (v) => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v);

    expect(table.format === FORMAT, `format が ${FORMAT} ではありません`);
    expect(isDate(table.version), 'version が YYYY-MM-DD ではありません');
    expect(typeof table.generatedAt === 'string' && !Number.isNaN(Date.parse(table.generatedAt)), 'generatedAt が日時ではありません');

    const s = table.source ?? {};
    expect(s.publisher === '総務省', 'source.publisher が総務省ではありません');
    expect(typeof s.page === 'string' && s.page.startsWith('https://www.soumu.go.jp/'), 'source.page が総務省のページではありません');
    expect(isDate(s.asOf), 'source.asOf が YYYY-MM-DD ではありません');
    expect(typeof s.credit === 'string' && s.credit.includes('総務省') && s.credit.includes('加工して作成'), 'source.credit に出典の書き方がありません');
    expect(Array.isArray(s.files) && s.files.length === 9, 'source.files が 9 つではありません');
    for (const f of s.files ?? []) {
        expect(/^[1-9]から始まる市外局番$/.test(f.title), `source.files の title が違います: ${f.title}`);
        expect(typeof f.url === 'string' && /^https:\/\/www\.soumu\.go\.jp\/.+\.xls$/.test(f.url), `source.files の url が違います: ${f.url}`);
        expect(isDate(f.date), `source.files の date が違います: ${f.title}`);
        expect(Number.isInteger(f.rows) && f.rows > 0, `source.files の rows が違います: ${f.title}`);
    }
    expect(Number.isInteger(s.rows) && s.rows === (s.files ?? []).reduce((n, f) => n + f.rows, 0), 'source.rows がファイルの行の合計ではありません');

    const kinds = ['mobile', 'ip', 'm2m', 'fmc', 'toll_free', 'shared_cost', 'mass_calling', 'premium'];
    const prefixes = new Set();
    for (const v of table.services ?? []) {
        expect(/^0\d{2,3}$/.test(v.prefix), `services の prefix が違います: ${v.prefix}`);
        expect(!prefixes.has(v.prefix), `services の prefix が重なっています: ${v.prefix}`);
        prefixes.add(v.prefix);
        expect(kinds.includes(v.kind), `services の kind が違います: ${v.kind}`);
        expect(typeof v.label === 'string' && v.label !== '', `services の label がありません: ${v.prefix}`);
        expect(Number.isInteger(v.length) && v.length >= 10 && v.length <= 14, `services の length が違います: ${v.prefix}`);
        expect(Array.isArray(v.groups) && v.groups.reduce((n, g) => n + g, 0) === v.length, `services の groups の合計が length になりません: ${v.prefix}`);
        expect(typeof v.designated === 'boolean', `services の designated がありません: ${v.prefix}`);
    }
    for (const p of ['070', '080', '090', '050', '0120']) expect(prefixes.has(p), `services に ${p} がありません`);

    const x = table.fixed ?? {};
    expect(x.kind === 'fixed' && x.length === 10, 'fixed の kind・length が違います');
    expect(typeof x.subscriberFirstDigits === 'string' && /^[1-9]+$/.test(x.subscriberFirstDigits), 'fixed.subscriberFirstDigits が違います');
    expect(Array.isArray(x.areaCodes) && x.areaCodes.every((a) => /^0\d{1,4}$/.test(a)), 'fixed.areaCodes が違います');
    const rules = Object.entries(x.areaCodeLength ?? {});
    expect(rules.length > 0 && rules.every(([k, v]) => /^0\d{0,5}$/.test(k) && Number.isInteger(v) && v >= 2 && v <= 5), 'fixed.areaCodeLength が違います');

    // どの市外局番も、その市外局番の桁で区切れる頭を少なくとも 1 つ持つ
    if (errors.length === 0) {
        const reachable = new Set();
        const walk = (prefix) => {
            if (prefix.length === 6) {
                const area = areaCodeOf(x.areaCodeLength, prefix);
                if (area) reachable.add(area);
                return;
            }
            for (const d of '0123456789') walk(prefix + d);
        };
        for (const d of '123456789') walk(`0${d}`);
        for (const area of x.areaCodes) expect(reachable.has(area), `市外局番 ${area} で区切れる番号がありません`);
        for (const [digits, area] of ANCHORS) {
            expect(areaCodeOf(x.areaCodeLength, digits) === area, `${digits} の市外局番が ${area} になりません`);
        }
    }

    return errors;
}

/**
 * 前回と比べて、ありえない変わり方をしていないかを見る。
 * 総務省のファイルの形が変わって読み損ねたときに、そのまま出してしまわないため。
 *
 * @returns {{ errors: string[], notes: string[] }}
 */
export function compare(previous, next) {
    const errors = [];
    const notes = [];
    if (!previous) return { errors, notes: ['前回の表がありません（初回）'] };

    const ratio = (a, b) => (a === 0 ? 1 : b / a);
    const rules = [Object.keys(previous.fixed.areaCodeLength).length, Object.keys(next.fixed.areaCodeLength).length];
    const areas = [previous.fixed.areaCodes.length, next.fixed.areaCodes.length];
    const rows = [previous.source.rows, next.source.rows];

    notes.push(`市外局番 ${areas[0]} → ${areas[1]}・頭の決まり ${rules[0]} → ${rules[1]}・番号ブロック ${rows[0]} → ${rows[1]}`);

    if (ratio(areas[0], areas[1]) < 0.98) errors.push(`市外局番が 2% より多く減りました（${areas[0]} → ${areas[1]}）`);
    if (Math.abs(1 - ratio(rules[0], rules[1])) > 0.15) errors.push(`頭の決まりの数が 15% より多く変わりました（${rules[0]} → ${rules[1]}）`);
    if (ratio(rows[0], rows[1]) < 0.95) errors.push(`番号ブロックが 5% より多く減りました（${rows[0]} → ${rows[1]}）`);

    const removed = previous.fixed.areaCodes.filter((a) => !next.fixed.areaCodes.includes(a));
    const added = next.fixed.areaCodes.filter((a) => !previous.fixed.areaCodes.includes(a));
    if (removed.length) notes.push(`無くなった市外局番: ${removed.join(', ')}`);
    if (added.length) notes.push(`増えた市外局番: ${added.join(', ')}`);

    const changedRules = [];
    for (const k of new Set([...Object.keys(previous.fixed.areaCodeLength), ...Object.keys(next.fixed.areaCodeLength)])) {
        if (previous.fixed.areaCodeLength[k] !== next.fixed.areaCodeLength[k]) {
            changedRules.push(`${k}: ${previous.fixed.areaCodeLength[k] ?? '-'} → ${next.fixed.areaCodeLength[k] ?? '-'}`);
        }
    }
    if (changedRules.length) notes.push(`変わった頭の決まり: ${changedRules.join(' / ')}`);

    const services = (t) => Object.fromEntries(t.services.map((s) => [s.prefix, JSON.stringify(s)]));
    const [ps, ns] = [services(previous), services(next)];
    for (const p of new Set([...Object.keys(ps), ...Object.keys(ns)])) {
        if (ps[p] !== ns[p]) notes.push(`番号の種類 ${p}: ${ps[p] ?? '-'} → ${ns[p] ?? '-'}`);
    }

    for (const f of next.source.files) {
        const old = previous.source.files.find((o) => o.title === f.title);
        if (!old || old.url !== f.url || old.asOf !== f.asOf) notes.push(`${f.title}: ${old?.asOf ?? '-'} → ${f.asOf}`);
    }

    return { errors, notes };
}

export { verify };
