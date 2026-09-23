/**
 * Excel 97-2003（.xls, BIFF8）の最初のシートを、文字と数の 2 次元配列として読む。
 *
 * 総務省の番号指定状況の .xls を読むためだけの、依存ライブラリ無しの小さな読み手。
 * 書式・結合セル・数式の中身などは読まない（セルの値だけ）。
 *
 * 1. 複合ファイル（OLE / CFB）から「Workbook」ストリームを取り出す
 * 2. BIFF8 のレコードを順に読み、共有文字列（SST）と最初のワークシートのセルを拾う
 */

const ENDOFCHAIN = 0xfffffffe;
const FREESECT = 0xffffffff;

/**
 * 複合ファイルから名前のストリームを取り出す。
 *
 * @param {Buffer} buf
 * @param {string[]} names 探す名前（最初に見つかったもの）
 * @returns {Buffer}
 */
export function readCfbStream(buf, names) {
    if (buf.readUInt32LE(0) !== 0xe011cfd0 || buf.readUInt32LE(4) !== 0xe11ab1a1) {
        throw new Error('.xls（複合ファイル）ではありません');
    }

    const sectorSize = 1 << buf.readUInt16LE(30);
    const miniSectorSize = 1 << buf.readUInt16LE(32);
    const fatCount = buf.readUInt32LE(44);
    const dirStart = buf.readUInt32LE(48);
    const miniCutoff = buf.readUInt32LE(56);
    const miniFatStart = buf.readUInt32LE(60);
    let difatSector = buf.readUInt32LE(68);

    const sector = (id) => buf.subarray((id + 1) * sectorSize, (id + 2) * sectorSize);

    // FAT のあるセクタの一覧（ヘッダの 109 個 + DIFAT の鎖）
    const fatSectors = [];
    for (let i = 0; i < 109 && fatSectors.length < fatCount; i++) {
        const id = buf.readUInt32LE(76 + i * 4);
        if (id !== FREESECT) fatSectors.push(id);
    }
    while (difatSector !== ENDOFCHAIN && difatSector !== FREESECT && fatSectors.length < fatCount) {
        const s = sector(difatSector);
        const per = sectorSize / 4 - 1;
        for (let i = 0; i < per && fatSectors.length < fatCount; i++) {
            const id = s.readUInt32LE(i * 4);
            if (id !== FREESECT) fatSectors.push(id);
        }
        difatSector = s.readUInt32LE(per * 4);
    }

    const fat = [];
    for (const id of fatSectors) {
        const s = sector(id);
        for (let i = 0; i < sectorSize; i += 4) fat.push(s.readUInt32LE(i));
    }

    const chain = (start, table) => {
        const ids = [];
        const seen = new Set();
        for (let id = start; id !== ENDOFCHAIN && id !== FREESECT; id = table[id]) {
            if (seen.has(id) || id === undefined) throw new Error('複合ファイルの鎖が壊れています');
            seen.add(id);
            ids.push(id);
        }
        return ids;
    };
    const readChain = (start) => Buffer.concat(chain(start, fat).map(sector));

    const dir = readChain(dirStart);
    const entries = [];
    for (let at = 0; at + 128 <= dir.length; at += 128) {
        const nameLength = dir.readUInt16LE(at + 64);
        const type = dir[at + 66];
        if (type === 0) continue;
        entries.push({
            name: dir.subarray(at, at + Math.max(0, nameLength - 2)).toString('utf16le'),
            type,
            start: dir.readUInt32LE(at + 116),
            size: dir.readUInt32LE(at + 120),
        });
    }

    const entry = entries.find((e) => e.type === 2 && names.includes(e.name));
    if (!entry) throw new Error(`ストリーム ${names.join(' / ')} がありません`);

    if (entry.size >= miniCutoff) return readChain(entry.start).subarray(0, entry.size);

    // 小さいストリームはルートの持つミニストリームの中にある
    const root = entries.find((e) => e.type === 5);
    const miniStream = readChain(root.start);
    const miniFat = [];
    const miniFatBuf = miniFatStart === ENDOFCHAIN ? Buffer.alloc(0) : readChain(miniFatStart);
    for (let i = 0; i + 4 <= miniFatBuf.length; i += 4) miniFat.push(miniFatBuf.readUInt32LE(i));
    const parts = chain(entry.start, miniFat).map((id) => miniStream.subarray(id * miniSectorSize, (id + 1) * miniSectorSize));

    return Buffer.concat(parts).subarray(0, entry.size);
}

/** BIFF のレコードを順に返す */
function* records(stream, from = 0) {
    let at = from;
    while (at + 4 <= stream.length) {
        const type = stream.readUInt16LE(at);
        const length = stream.readUInt16LE(at + 2);
        yield { type, data: stream.subarray(at + 4, at + 4 + length), at };
        at += 4 + length;
    }
}

/**
 * 共有文字列の表（SST + CONTINUE）を読む。
 * 文字列は CONTINUE の境目で割れることがあり、割れた先の頭には 1 バイトの「2 バイト文字か」が付く。
 */
function readSst(chunks) {
    let index = 0;
    let at = 8; // 全体の数・固有の数
    const strings = [];
    const unique = chunks[0].readUInt32LE(4);

    const ensure = () => {
        while (index < chunks.length && at >= chunks[index].length) {
            index++;
            at = 0;
        }
        if (index >= chunks.length) throw new Error('共有文字列の表が途中で切れています');
    };
    const u8 = () => {
        ensure();
        return chunks[index][at++];
    };
    const u16 = () => u8() | (u8() << 8);
    const u32 = () => (u16() | (u16() << 16)) >>> 0;
    const skip = (n) => {
        while (n > 0) {
            ensure();
            const take = Math.min(n, chunks[index].length - at);
            at += take;
            n -= take;
        }
    };

    for (let i = 0; i < unique; i++) {
        ensure();
        const count = u16();
        const flags = u8();
        let high = (flags & 0x01) !== 0;
        const runs = flags & 0x08 ? u16() : 0;
        const ext = flags & 0x04 ? u32() : 0;
        let text = '';
        let left = count;

        while (left > 0) {
            if (at >= chunks[index].length) {
                index++;
                at = 0;
                if (index >= chunks.length) throw new Error('共有文字列の表が途中で切れています');
                high = (chunks[index][at++] & 0x01) !== 0;
            }
            const chunk = chunks[index];
            const width = high ? 2 : 1;
            const take = Math.min(left, Math.floor((chunk.length - at) / width));
            const bytes = chunk.subarray(at, at + take * width);
            text += high ? bytes.toString('utf16le') : bytes.toString('latin1');
            at += take * width;
            left -= take;
        }

        skip(runs * 4 + ext);
        strings.push(text);
    }

    return strings;
}

/** セルの中の文字列（XLUnicodeString。長さは 2 バイト） */
function readInlineString(data, at) {
    const count = data.readUInt16LE(at);
    const high = (data[at + 2] & 0x01) !== 0;
    const bytes = data.subarray(at + 3, at + 3 + count * (high ? 2 : 1));

    return high ? bytes.toString('utf16le') : bytes.toString('latin1');
}

function rkValue(rk) {
    let value;
    if (rk & 0x02) {
        value = rk >> 2;
    } else {
        const b = Buffer.alloc(8);
        b.writeUInt32LE(0, 0);
        b.writeUInt32LE((rk & 0xfffffffc) >>> 0, 4);
        value = b.readDoubleLE(0);
    }

    return rk & 0x01 ? value / 100 : value;
}

/**
 * .xls の最初のワークシートを読む。
 *
 * @param {Buffer} buf ファイルの中身
 * @returns {{ name: string, rows: (string|number|undefined)[][] }}
 */
export function readFirstSheet(buf) {
    const stream = readCfbStream(buf, ['Workbook', 'Book']);
    const sstChunks = [];
    const sheets = [];
    let inSst = false;

    for (const { type, data } of records(stream)) {
        if (type === 0x00fc) {
            sstChunks.push(data);
            inSst = true;
            continue;
        }
        if (type === 0x003c && inSst) {
            sstChunks.push(data);
            continue;
        }
        inSst = false;

        if (type === 0x0085) {
            // BOUNDSHEET: 位置・見える/隠す・種類・名前
            sheets.push({ offset: data.readUInt32LE(0), kind: data[5], name: readShortString(data, 6) });
        }
        if (type === 0x000a) break; // 全体の部の終わり
    }

    const sst = sstChunks.length ? readSst(sstChunks) : [];
    const sheet = sheets.find((s) => s.kind === 0);
    if (!sheet) throw new Error('ワークシートがありません');

    const rows = [];
    const put = (row, col, value) => {
        (rows[row] ??= [])[col] = value;
    };
    let pendingFormula = null;

    for (const { type, data } of records(stream, sheet.offset)) {
        if (type === 0x000a) break;

        switch (type) {
            case 0x00fd: // LABELSST
                put(data.readUInt16LE(0), data.readUInt16LE(2), sst[data.readUInt32LE(6)]);
                break;
            case 0x0204: // LABEL
                put(data.readUInt16LE(0), data.readUInt16LE(2), readInlineString(data, 6));
                break;
            case 0x0203: // NUMBER
                put(data.readUInt16LE(0), data.readUInt16LE(2), data.readDoubleLE(6));
                break;
            case 0x027e: // RK
                put(data.readUInt16LE(0), data.readUInt16LE(2), rkValue(data.readUInt32LE(6)));
                break;
            case 0x00bd: { // MULRK
                const row = data.readUInt16LE(0);
                const first = data.readUInt16LE(2);
                const n = (data.length - 6) / 6;
                for (let i = 0; i < n; i++) put(row, first + i, rkValue(data.readUInt32LE(4 + i * 6 + 2)));
                break;
            }
            case 0x0006: { // FORMULA（計算の結果だけ）
                const row = data.readUInt16LE(0);
                const col = data.readUInt16LE(2);
                if (data.readUInt16LE(12) === 0xffff) {
                    if (data[6] === 0x00) pendingFormula = { row, col };
                } else {
                    put(row, col, data.readDoubleLE(6));
                }
                break;
            }
            case 0x0207: // STRING（直前の数式の文字の結果）
                if (pendingFormula) put(pendingFormula.row, pendingFormula.col, readInlineString(data, 0));
                pendingFormula = null;
                break;
        }
    }

    for (let i = 0; i < rows.length; i++) rows[i] ??= [];

    return { name: sheet.name, rows };
}

/** 長さ 1 バイトの文字列（シート名） */
function readShortString(data, at) {
    const count = data[at];
    const high = (data[at + 1] & 0x01) !== 0;
    const bytes = data.subarray(at + 2, at + 2 + count * (high ? 2 : 1));

    return high ? bytes.toString('utf16le') : bytes.toString('latin1');
}
