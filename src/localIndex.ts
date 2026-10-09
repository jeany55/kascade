/**
 * The local index: `Data/data/*.idx`. Sixteen bucket files map the first nine
 * bytes of an encoding key to where its record sits in the `data.NNN` files.
 */
import { toHex, u32le } from './bytes';
import { CascError } from './error';

/** Where one record is in the data files. */
export interface IndexEntry {
    /** The `NNN` of `data.NNN`. */
    archive: number;
    /** Byte offset of the record's header in that file. */
    offset: number;
    /** Size of the record, its 30-byte header included. */
    size: number;
}

/** Length of the truncated encoding key the index stores. */
export const INDEX_KEY_BYTES = 9;

const INDEX_NAME = /^([0-9a-f]{2})([0-9a-f]{8})\.idx$/i;

/**
 * Each bucket can have several generations on disk while the launcher is
 * patching; the highest-numbered file of a bucket is the current one.
 */
export function currentIndexFiles(names: string[]): string[] {
    const newest = new Map<string, { version: number; name: string }>();
    for (const name of names) {
        const match = INDEX_NAME.exec(name);
        if (!match) continue;
        const bucket = match[1].toLowerCase();
        const version = parseInt(match[2], 16);
        const seen = newest.get(bucket);
        if (!seen || version > seen.version) newest.set(bucket, { version, name });
    }
    return [...newest.values()].map(entry => entry.name).sort();
}

/** Adds one `.idx` file's entries to `into`, keyed by the hex of the truncated key. */
export function parseIndexFile(bytes: Uint8Array, into: Map<string, IndexEntry>, name = 'index'): void {
    if (bytes.length < 0x28) throw new CascError('Corrupted', `${name} is too short`);
    const headerSize = u32le(bytes, 0);
    const version = bytes[8] | (bytes[9] << 8);
    if (version !== 7) throw new CascError('UnsupportedVersion', `${name} is index version ${version}`);
    const sizeBytes = bytes[12];
    const offsetBytes = bytes[13];
    const keyBytes = bytes[14];
    const offsetBits = bytes[15];
    if (sizeBytes !== 4 || offsetBytes !== 5 || keyBytes !== INDEX_KEY_BYTES) {
        throw new CascError(
            'UnsupportedVersion',
            `${name} has ${keyBytes}-byte keys, ${offsetBytes}-byte offsets and ${sizeBytes}-byte sizes`,
        );
    }

    // The header block (its size and hash, then the body) is padded to 16 bytes;
    // the entries block follows with its own size and hash.
    const block = (8 + headerSize + 15) & ~15;
    const entriesSize = u32le(bytes, block);
    const start = block + 8;
    const entrySize = keyBytes + offsetBytes + sizeBytes;
    if (start + entriesSize > bytes.length) throw new CascError('Corrupted', `${name} is truncated`);

    const offsetRange = 2 ** offsetBits;
    for (let p = start; p + entrySize <= start + entriesSize; p += entrySize) {
        // Five bytes, big-endian: the archive number above the offset.
        const packed = bytes[p + 9] * 0x100000000 + (((bytes[p + 10] << 24) | (bytes[p + 11] << 16) | (bytes[p + 12] << 8) | bytes[p + 13]) >>> 0);
        const key = toHex(bytes, p, p + keyBytes);
        // The first entry for a key is the live one.
        if (into.has(key)) continue;
        into.set(key, {
            archive: Math.floor(packed / offsetRange),
            offset: packed % offsetRange,
            size: u32le(bytes, p + 14),
        });
    }
}

/** `data.007` for archive 7. */
export function archiveName(archive: number): string {
    return `data.${String(archive).padStart(3, '0')}`;
}
