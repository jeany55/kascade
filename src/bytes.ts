/**
 * Small byte helpers shared by the parsers. CASC mixes byte orders: the local
 * index files are little-endian, BLTE and the encoding file are big-endian.
 */

const HEX: string[] = [];
for (let i = 0; i < 256; i++) HEX.push(i.toString(16).padStart(2, '0'));

export function toHex(bytes: Uint8Array, start = 0, end = bytes.length): string {
    let out = '';
    for (let i = start; i < end; i++) out += HEX[bytes[i]];
    return out;
}

export function fromHex(hex: string): Uint8Array {
    if (hex.length % 2 !== 0 || /[^0-9a-f]/i.test(hex)) throw new TypeError(`not a hex string: ${hex}`);
    const out = new Uint8Array(hex.length / 2);
    for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.substr(i * 2, 2), 16);
    return out;
}

export function u16be(b: Uint8Array, o: number): number {
    return (b[o] << 8) | b[o + 1];
}

export function u24be(b: Uint8Array, o: number): number {
    return (b[o] << 16) | (b[o + 1] << 8) | b[o + 2];
}

export function u32be(b: Uint8Array, o: number): number {
    return ((b[o] << 24) | (b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3]) >>> 0;
}

export function u32le(b: Uint8Array, o: number): number {
    return (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0;
}

/** A 40-bit big-endian integer; exact in a double. */
export function u40be(b: Uint8Array, o: number): number {
    return b[o] * 0x100000000 + u32be(b, o + 1);
}

export function decodeText(bytes: Uint8Array): string {
    return new TextDecoder('utf-8').decode(bytes);
}
