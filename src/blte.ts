/**
 * BLTE, the container every stored file is wrapped in: a table of chunks, each
 * either kept as it is or compressed with zlib.
 */
import { unzlibSync } from 'fflate';
import { u24be, u32be } from './bytes';
import { CascError } from './error';

const MAGIC = 0x424c5445; // 'BLTE'

export function decodeBlte(bytes: Uint8Array): Uint8Array {
    if (bytes.length < 8 || u32be(bytes, 0) !== MAGIC) throw new CascError('Corrupted', 'not a BLTE stream');
    const headerSize = u32be(bytes, 4);

    // Without a chunk table the rest of the stream is one chunk.
    if (headerSize === 0) return decodeChunk(bytes.subarray(8));

    if (headerSize > bytes.length || headerSize < 12) throw new CascError('Corrupted', 'BLTE header is truncated');
    const count = u24be(bytes, 9);
    if (count === 0) throw new CascError('Corrupted', 'BLTE stream has no chunks');
    // 24 bytes a chunk (two sizes and a hash); a wider table has more hashes after them.
    const entrySize = Math.floor((headerSize - 12) / count);
    if (entrySize < 24) throw new CascError('Corrupted', 'BLTE chunk table is too small');

    const chunks: Uint8Array[] = [];
    let total = 0;
    let p = headerSize;
    for (let i = 0; i < count; i++) {
        const entry = 12 + i * entrySize;
        const storedSize = u32be(bytes, entry);
        const size = u32be(bytes, entry + 4);
        if (p + storedSize > bytes.length) throw new CascError('Corrupted', `BLTE chunk ${i} runs past the end`);
        const chunk = decodeChunk(bytes.subarray(p, p + storedSize));
        if (chunk.length !== size) {
            throw new CascError('Corrupted', `BLTE chunk ${i} is ${chunk.length} bytes, expected ${size}`);
        }
        chunks.push(chunk);
        total += chunk.length;
        p += storedSize;
    }
    if (chunks.length === 1) return chunks[0];

    const out = new Uint8Array(total);
    let o = 0;
    for (const chunk of chunks) {
        out.set(chunk, o);
        o += chunk.length;
    }
    return out;
}

function decodeChunk(chunk: Uint8Array): Uint8Array {
    if (chunk.length === 0) throw new CascError('Corrupted', 'empty BLTE chunk');
    const body = chunk.subarray(1);
    switch (chunk[0]) {
        case 0x4e: // 'N': as it is
            return body;
        case 0x5a: // 'Z': zlib
            try {
                return unzlibSync(body);
            } catch (error) {
                throw new CascError('Corrupted', `BLTE chunk does not inflate: ${(error as Error).message}`);
            }
        case 0x45: // 'E'
            throw new CascError('UnsupportedEncoding', 'encrypted BLTE chunk');
        case 0x46: // 'F'
            throw new CascError('UnsupportedEncoding', 'nested BLTE frame');
        default:
            throw new CascError('UnsupportedEncoding', `BLTE chunk mode 0x${chunk[0].toString(16)}`);
    }
}
