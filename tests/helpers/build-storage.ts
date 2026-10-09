/**
 * Builds a small CASC storage in memory, from nothing but the format: the
 * tests need real archives to open, and no file of Blizzard's can be committed.
 */
import { zlibSync } from 'fflate';
import { md5 } from '../../src/md5';

export interface StoredFile {
    name: string;
    bytes: Uint8Array;
    /** How the file is wrapped: one bare chunk, or a chunk table of raw and zlib chunks. */
    encoding?: 'bare' | 'raw' | 'zlib' | 'mixed';
    /** Listed by the build but left out of the data files, like another language's files. */
    installed?: boolean;
}

export interface BuiltStorage {
    files: Record<string, Uint8Array>;
    buildKey: string;
}

const hex = (bytes: Uint8Array) => [...bytes].map(b => b.toString(16).padStart(2, '0')).join('');
const text = (value: string) => new TextEncoder().encode(value);

function concat(parts: Uint8Array[]): Uint8Array {
    const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
    let o = 0;
    for (const part of parts) {
        out.set(part, o);
        o += part.length;
    }
    return out;
}

function be(value: number, bytes: number): Uint8Array {
    const out = new Uint8Array(bytes);
    for (let i = bytes - 1; i >= 0; i--) {
        out[i] = value % 256;
        value = Math.floor(value / 256);
    }
    return out;
}

function le32(value: number): Uint8Array {
    return new Uint8Array([value & 255, (value >>> 8) & 255, (value >>> 16) & 255, (value >>> 24) & 255]);
}

/** Wraps bytes in BLTE and returns the stream with its encoding key. */
export function encodeBlte(bytes: Uint8Array, encoding: StoredFile['encoding'] = 'zlib'): { blte: Uint8Array; key: Uint8Array } {
    if (encoding === 'bare') {
        const blte = concat([text('BLTE'), be(0, 4), text('N'), bytes]);
        return { blte, key: md5(blte) };
    }
    const cut = encoding === 'mixed' ? Math.ceil(bytes.length / 2) : bytes.length;
    const pieces = encoding === 'mixed' ? [bytes.subarray(0, cut), bytes.subarray(cut)] : [bytes];
    const chunks = pieces.map((piece, i) => {
        const zlib = encoding === 'zlib' || (encoding === 'mixed' && i === 1);
        return { size: piece.length, stored: concat([text(zlib ? 'Z' : 'N'), zlib ? zlibSync(piece) : piece]) };
    });
    const headerSize = 12 + chunks.length * 24;
    const header = concat([
        text('BLTE'),
        be(headerSize, 4),
        new Uint8Array([0x0f]),
        be(chunks.length, 3),
        ...chunks.map(chunk => concat([be(chunk.stored.length, 4), be(chunk.size, 4), md5(chunk.stored)])),
    ]);
    // The encoding key of a chunked stream is the hash of its header.
    return { blte: concat([header, ...chunks.map(chunk => chunk.stored)]), key: md5(header) };
}

function indexFile(bucket: number, entries: { key: Uint8Array; archive: number; offset: number; size: number }[]): Uint8Array {
    const body = concat(
        entries.map(entry => {
            const packed = entry.archive * 2 ** 30 + entry.offset;
            return concat([entry.key.subarray(0, 9), be(packed, 5), le32(entry.size)]);
        }),
    );
    const header = new Uint8Array(0x28);
    header.set(le32(0x10), 0);
    header.set([7, 0, bucket, 0, 4, 5, 9, 30], 8);
    header.set(le32(body.length), 0x20);
    return concat([header, body]);
}

function encodingFile(entries: { contentKey: Uint8Array; encodingKey: Uint8Array; size: number }[]): Uint8Array {
    const pageSize = 4096;
    const sorted = [...entries].sort((a, b) => (hex(a.contentKey) < hex(b.contentKey) ? -1 : 1));
    const pages: Uint8Array[] = [];
    let page: Uint8Array[] = [];
    let used = 0;
    const flush = () => {
        const full = new Uint8Array(pageSize);
        full.set(concat(page));
        pages.push(full);
        page = [];
        used = 0;
    };
    for (const entry of sorted) {
        const row = concat([new Uint8Array([1]), be(entry.size, 5), entry.contentKey, entry.encodingKey]);
        if (used + row.length > pageSize) flush();
        page.push(row);
        used += row.length;
    }
    if (page.length > 0 || pages.length === 0) flush();
    const spec = text('z\0');
    const header = concat([
        text('EN'),
        new Uint8Array([1, 16, 16]),
        be(pageSize / 1024, 2),
        be(pageSize / 1024, 2),
        be(pages.length, 4),
        be(0, 4),
        new Uint8Array([0]),
        be(spec.length, 4),
    ]);
    const pageIndex = pages.map(full => concat([full.subarray(6, 22), md5(full)]));
    return concat([header, spec, ...pageIndex, ...pages]);
}

/**
 * A storage holding `stored`, split across two data files and sixteen index
 * buckets, with a stale generation of one bucket left on disk as a patcher
 * leaves them.
 */
export function buildStorage(stored: StoredFile[], options: { product?: string; root?: Uint8Array } = {}): BuiltStorage {
    const archives: Uint8Array[][] = [[], []];
    const sizes = [0, 0];
    const index: { key: Uint8Array; archive: number; offset: number; size: number }[] = [];
    const encoding: { contentKey: Uint8Array; encodingKey: Uint8Array; size: number }[] = [];
    let next = 0;

    const store = (bytes: Uint8Array, how: StoredFile['encoding'], installed = true) => {
        const contentKey = md5(bytes);
        const { blte, key } = encodeBlte(bytes, how);
        if (installed) {
            const archive = next++ % 2;
            const size = 30 + blte.length;
            const header = new Uint8Array(30);
            header.set([...key].reverse(), 0);
            header.set(le32(size), 16);
            index.push({ key, archive, offset: sizes[archive], size });
            archives[archive].push(header, blte);
            sizes[archive] += size;
        }
        return { contentKey, encodingKey: key, size: bytes.length };
    };

    const rootLines: string[] = [];
    for (const file of stored) {
        const entry = store(file.bytes, file.encoding, file.installed ?? true);
        if (file.bytes.length > 0) encoding.push(entry);
        rootLines.push(`${file.name}|${hex(entry.contentKey)}`);
    }
    const root = store(options.root ?? text(rootLines.join('\r\n') + '\r\n'), 'zlib');
    encoding.push(root);
    const encodingBytes = encodingFile(encoding);
    const encodingEntry = store(encodingBytes, 'mixed');

    const config = text(
        [
            '# Build Configuration',
            '',
            `root = ${hex(root.contentKey)}`,
            `encoding = ${hex(encodingEntry.contentKey)} ${hex(encodingEntry.encodingKey)}`,
            `encoding-size = ${encodingBytes.length} 0`,
            'build-name = 1.0.0.1-test',
            'build-uid = t1',
            `build-product = ${options.product ?? 'Test1'}`,
            '',
        ].join('\n'),
    );
    const buildKey = hex(md5(config));

    const files: Record<string, Uint8Array> = {
        '.build.info': text(
            'Branch!STRING:0|Active!DEC:1|Build Key!HEX:16|CDN Key!HEX:16|Version!STRING:0|Product!STRING:0\r\n' +
                `us|1|${buildKey}|${'0'.repeat(32)}|1.0.0.1|\r\n`,
        ),
        [`Data/config/${buildKey.slice(0, 2)}/${buildKey.slice(2, 4)}/${buildKey}`]: config,
        'Data/data/data.000': concat(archives[0]),
        'Data/data/data.001': concat(archives[1]),
        'Data/data/shmem': new Uint8Array(16),
    };
    for (let bucket = 0; bucket < 16; bucket++) {
        const entries = index.filter(entry => {
            const x = entry.key.subarray(0, 9).reduce((a, b) => a ^ b, 0);
            return ((x & 15) ^ (x >> 4)) === bucket;
        });
        files[`Data/data/${bucket.toString(16).padStart(2, '0')}00000002.idx`] = indexFile(bucket, entries);
    }
    // An older generation of bucket 0, pointing nowhere useful.
    files['Data/data/0000000001.idx'] = indexFile(0, index.map(entry => ({ ...entry, offset: 0, size: 30 })));
    return { files, buildKey };
}
