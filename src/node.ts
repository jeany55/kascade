/**
 * The Node.js source: a storage read from a folder on disk. Kept out of the
 * main entry so that entry stays free of Node built-ins.
 */
import { open, readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { StorageSource } from './source';

/**
 * A source over an install folder on disk — the folder holding `.build.info`,
 * for example `C:\Program Files (x86)\StarCraft`.
 */
export function nodeSource(directory: string): StorageSource {
    return {
        async read(path, offset, length) {
            const full = join(directory, path);
            if (offset === undefined) return new Uint8Array(await readFile(full));
            const handle = await open(full, 'r');
            try {
                const size = length ?? (await handle.stat()).size - offset;
                const out = new Uint8Array(Math.max(0, size));
                let done = 0;
                while (done < out.length) {
                    const { bytesRead } = await handle.read(out, done, out.length - done, offset + done);
                    if (bytesRead === 0) break;
                    done += bytesRead;
                }
                return done === out.length ? out : out.subarray(0, done);
            } finally {
                await handle.close();
            }
        },
        list(path) {
            return readdir(join(directory, path));
        },
    };
}
