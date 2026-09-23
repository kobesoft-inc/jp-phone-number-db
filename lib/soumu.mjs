/**
 * 総務省「電気通信番号指定状況」のページを読む。
 *
 * - ページの時点（「令和8年9月1日時点のものです」）
 * - 「N から始まる市外局番」の .xls の場所（N = 1〜9。1 つの項目に新旧 2 つ並ぶことがある）
 * - 市外局番を使わない番号（0120・050 など）が「指定なし」かどうか
 *
 * xls の番号（main_content/000697543.xls など）はファイルを差し替えるたびに変わるので、
 * 決め打ちにせず毎回ページから拾う。
 */
import { warekiToIso } from './wareki.mjs';

export const PAGE = 'https://www.soumu.go.jp/main_sosiki/joho_tsusin/top/tel_number/number_shitei.html';
export const ORIGIN = 'https://www.soumu.go.jp';
export const USER_AGENT = 'jp-phone-number-db (+https://github.com/kobesoft-inc/jp-phone-number-db)';

/** HTML を「文字 + [[href:…]]」の並びにする（リンクの場所だけ残してタグを消す） */
export function flatten(html) {
    return html
        .replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, '')
        .replace(/<a\s[^>]*?href="([^"]+)"[^>]*>/gi, ' [[href:$1]] ')
        .replace(/<[^>]*>/g, '')
        .replace(/&nbsp;/g, ' ')
        .replace(/&amp;/g, '&')
        .replace(/[ \t\r\n　]+/g, ' ');
}

/**
 * ページを読む。
 *
 * @param {string} html
 * @param {string[]} servicePrefixes 「指定なし」かを見る頭（'0120' など）
 */
export function parsePage(html, servicePrefixes) {
    const text = flatten(html);

    const asOfMatch = /指定状況は、?\s*((?:令和|平成)\s*[0-9０-９元]+\s*年\s*[0-9０-９]+\s*月\s*[0-9０-９]+\s*日)\s*時点/.exec(text);
    if (!asOfMatch) throw new Error('ページの時点（「…時点のものです」）が見つかりません。ページの形が変わったかもしれません');
    const asOf = warekiToIso(asOfMatch[1]);

    // 「N から始まる市外局番」から次の「…から始まる市外局番」（か 800 字）までの .xls を拾う
    const fixed = [];
    const marks = [...text.matchAll(/([1-9])から始まる市外局番/g)];
    for (let i = 0; i < marks.length; i++) {
        const from = marks[i].index;
        const to = Math.min(marks[i + 1]?.index ?? Infinity, from + 800);
        const urls = [...text.slice(from, to).matchAll(/\[\[href:([^\]]+?\.xls)\]\]/g)].map((m) => new URL(m[1], ORIGIN).href);
        if (urls.length === 0) continue;
        const digit = marks[i][1];
        if (fixed.some((f) => f.digit === digit)) continue;
        fixed.push({ digit, title: `${digit}から始まる市外局番`, candidates: [...new Set(urls)] });
    }
    if (fixed.length !== 9) {
        throw new Error(`市外局番の Excel が 9 項目見つかりません（${fixed.length} 項目）。ページの形が変わったかもしれません`);
    }

    // 「（0120） [PDF形式、Excel形式]」なら指定あり、「（0180） 指定なし」なら指定なし
    const designated = {};
    for (const prefix of servicePrefixes) {
        const m = new RegExp(`[（(]${prefix}(?![0-9])`).exec(text);
        if (!m) throw new Error(`ページに（${prefix}）の項目が見つかりません。ページの形が変わったかもしれません`);
        const after = text.slice(m.index, m.index + 60);
        const link = after.indexOf('[[href:');
        const none = after.indexOf('指定なし');
        if (link < 0 && none < 0) throw new Error(`（${prefix}）が指定ありか指定なしか読めません`);
        designated[prefix] = link >= 0 && (none < 0 || link < none);
    }

    return { asOf, fixed: fixed.sort((a, b) => a.digit.localeCompare(b.digit)), designated };
}

/** 総務省のサイトから取ってくる（失敗したら少し待って 3 回まで） */
export async function fetchBuffer(url) {
    let lastError;
    for (let attempt = 1; attempt <= 3; attempt++) {
        try {
            const res = await fetch(url, { headers: { 'user-agent': USER_AGENT } });
            if (!res.ok) throw new Error(`${url} が読めません（${res.status}）`);
            return Buffer.from(await res.arrayBuffer());
        } catch (e) {
            lastError = e;
            await new Promise((r) => setTimeout(r, attempt * 2000));
        }
    }
    throw lastError;
}

/** ページは Shift_JIS */
export function decodePage(buf) {
    return new TextDecoder('shift_jis').decode(buf);
}
