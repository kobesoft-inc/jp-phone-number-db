/** 和暦の日付（「令和６年９月１日」）を YYYY-MM-DD にする */

const ERAS = { 令和: 2018, 平成: 1988 };

export function warekiToIso(text) {
    const s = String(text).normalize('NFKC').replace(/\s+/g, '');
    const m = /(令和|平成)(元|\d+)年(\d+)月(\d+)日/.exec(s);
    if (!m) throw new Error(`和暦の日付が読めません: ${text}`);
    const year = ERAS[m[1]] + (m[2] === '元' ? 1 : Number(m[2]));
    const month = Number(m[3]);
    const day = Number(m[4]);
    if (month < 1 || month > 12 || day < 1 || day > 31) throw new Error(`和暦の日付が読めません: ${text}`);

    return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}
