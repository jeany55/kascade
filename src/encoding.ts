/**
 * The encoding file: content key (the MD5 of a file's bytes) to encoding key
 * (what the index knows the stored, BLTE-wrapped copy by).
 */
import { toHex, u16be, u32be, u40be } from './bytes';
import { CascError } from './error';

export interface EncodingEntry {
    /** Hex encoding key of the stored copy. */
    encodingKey: string;
    /** Size of the file once decoded. */
    size: number;
}

export function parseEncoding(bytes: Uint8Array): Map<string, EncodingEntry> {
    if (bytes.length < 22 || bytes[0] !== 0x45 || bytes[1] !== 0x4e) {
        throw new CascError('Corrupted', 'not an encoding file');
    }
    if (bytes[2] !== 1) throw new CascError('UnsupportedVersion', `encoding file version ${bytes[2]}`);
    const contentKeySize = bytes[3];
    const encodingKeySize = bytes[4];
    const pageSize = u16be(bytes, 5) * 1024;
    const pageCount = u32be(bytes, 9);
    const specSize = u32be(bytes, 18);

    // Header, the encoding-spec strings, a page index (first key + page hash), then the pages.
    const pages = 22 + specSize + pageCount * (contentKeySize + 16);
    if (pages + pageCount * pageSize > bytes.length) throw new CascError('Corrupted', 'encoding file is truncated');

    const out = new Map<string, EncodingEntry>();
    for (let page = 0; page < pageCount; page++) {
        let p = pages + page * pageSize;
        const end = p + pageSize;
        while (p + 6 + contentKeySize <= end) {
            const keyCount = bytes[p];
            if (keyCount === 0) break; // the rest of the page is padding
            const size = u40be(bytes, p + 1);
            const contentKey = toHex(bytes, p + 6, p + 6 + contentKeySize);
            const first = p + 6 + contentKeySize;
            // A file can be stored under several encodings; any of them decodes to it.
            out.set(contentKey, { encodingKey: toHex(bytes, first, first + encodingKeySize), size });
            p = first + keyCount * encodingKeySize;
        }
    }
    return out;
}
