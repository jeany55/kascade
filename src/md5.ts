/**
 * MD5 (RFC 1321). CASC names content by its MD5, so this is what `verify`
 * checks a file against. It is not used for anything security-related.
 */

const S = [
    7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20,
    4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21,
];

const K = new Int32Array(64);
for (let i = 0; i < 64; i++) K[i] = Math.floor(Math.abs(Math.sin(i + 1)) * 0x100000000) | 0;

export function md5(data: Uint8Array): Uint8Array {
    const length = data.length;
    const padded = new Uint8Array((((length + 8) >>> 6) + 1) << 6);
    padded.set(data);
    padded[length] = 0x80;
    const view = new DataView(padded.buffer);
    view.setUint32(padded.length - 8, (length << 3) >>> 0, true);
    view.setUint32(padded.length - 4, Math.floor(length / 0x20000000), true);

    let a0 = 0x67452301;
    let b0 = 0xefcdab89 | 0;
    let c0 = 0x98badcfe | 0;
    let d0 = 0x10325476;
    const m = new Int32Array(16);

    for (let block = 0; block < padded.length; block += 64) {
        for (let i = 0; i < 16; i++) m[i] = view.getInt32(block + i * 4, true);
        let a = a0;
        let b = b0;
        let c = c0;
        let d = d0;
        for (let i = 0; i < 64; i++) {
            let f: number;
            let g: number;
            if (i < 16) {
                f = (b & c) | (~b & d);
                g = i;
            } else if (i < 32) {
                f = (d & b) | (~d & c);
                g = (5 * i + 1) & 15;
            } else if (i < 48) {
                f = b ^ c ^ d;
                g = (3 * i + 5) & 15;
            } else {
                f = c ^ (b | ~d);
                g = (7 * i) & 15;
            }
            f = (f + a + K[i] + m[g]) | 0;
            a = d;
            d = c;
            c = b;
            b = (b + ((f << S[i]) | (f >>> (32 - S[i])))) | 0;
        }
        a0 = (a0 + a) | 0;
        b0 = (b0 + b) | 0;
        c0 = (c0 + c) | 0;
        d0 = (d0 + d) | 0;
    }

    const out = new Uint8Array(16);
    const outView = new DataView(out.buffer);
    outView.setInt32(0, a0, true);
    outView.setInt32(4, b0, true);
    outView.setInt32(8, c0, true);
    outView.setInt32(12, d0, true);
    return out;
}
