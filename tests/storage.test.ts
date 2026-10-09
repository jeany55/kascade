import { describe, it } from 'node:test';
import * as assert from 'node:assert';
import { CascError, Storage, decodeBlte, md5, memorySource } from '../src/index';
import { buildStorage, encodeBlte } from './helpers/build-storage';
import type { StoredFile } from './helpers/build-storage';

const text = (value: string) => new TextEncoder().encode(value);
const hex = (bytes: Uint8Array) => [...bytes].map(b => b.toString(16).padStart(2, '0')).join('');

function noise(length: number, seed: number): Uint8Array {
    const out = new Uint8Array(length);
    for (let i = 0; i < length; i++) {
        seed = (seed * 1103515245 + 12345) >>> 0;
        out[i] = (seed >>> 16) % 23;
    }
    return out;
}

const FILES: StoredFile[] = [
    { name: 'arr/units.dat', bytes: noise(19876, 1), encoding: 'zlib' },
    { name: 'sound/Misc/Buzz.wav', bytes: noise(5000, 2), encoding: 'raw' },
    { name: 'tileset/jungle.cv5', bytes: noise(70001, 3), encoding: 'mixed' },
    { name: 'rez/stat_txt.tbl', bytes: text('plain'), encoding: 'bare' },
    { name: 'locales/enUS/Assets/rez/stat_txt.tbl', bytes: text('english') },
    { name: 'locales/koKR/Assets/rez/stat_txt.tbl', bytes: text('korean'), installed: false },
    { name: 'glue/empty.txt', bytes: new Uint8Array(0), installed: false },
    // Enough small files that the encoding table runs to a second page.
    ...Array.from({ length: 150 }, (_, i) => ({ name: `many/file${i}.bin`, bytes: noise(40 + i, 100 + i) })),
];

async function open(files = FILES, options?: Parameters<typeof buildStorage>[1]) {
    const built = buildStorage(files, options);
    return { built, storage: await Storage.open(memorySource(built.files)) };
}

async function rejectsWith(pending: Promise<unknown>, kind: string) {
    await assert.rejects(pending, (error: unknown) => error instanceof CascError && error.kind === kind);
}

describe('md5', () => {
    it('matches the RFC 1321 test vectors', () => {
        assert.strictEqual(hex(md5(text(''))), 'd41d8cd98f00b204e9800998ecf8427e');
        assert.strictEqual(hex(md5(text('abc'))), '900150983cd24fb0d6963f7d28e17f72');
        assert.strictEqual(
            hex(md5(text('12345678901234567890123456789012345678901234567890123456789012345678901234567890'))),
            '57edf4a22be3c955ac49da2e2107b67a',
        );
    });

    it('handles lengths around the padding boundary', () => {
        assert.strictEqual(hex(md5(text('a'.repeat(55)))), 'ef1772b6dff9a122358552954ad0df65');
        assert.strictEqual(hex(md5(text('a'.repeat(56)))), '3b0c8ac703f828b04c6c197006d17218');
        assert.strictEqual(hex(md5(text('a'.repeat(64)))), '014842d480b571495a4a0363793f7367');
    });
});

describe('BLTE', () => {
    for (const encoding of ['bare', 'raw', 'zlib', 'mixed'] as const) {
        it(`decodes a ${encoding} stream`, () => {
            const bytes = noise(9001, 7);
            assert.deepStrictEqual(decodeBlte(encodeBlte(bytes, encoding).blte), bytes);
        });
    }

    it('refuses encrypted chunks by name', () => {
        const blte = new Uint8Array([0x42, 0x4c, 0x54, 0x45, 0, 0, 0, 0, 0x45, 1, 2, 3]);
        assert.throws(() => decodeBlte(blte), (error: unknown) => error instanceof CascError && error.kind === 'UnsupportedEncoding');
    });

    it('rejects a stream that is not BLTE', () => {
        assert.throws(() => decodeBlte(text('RIFF....WAVE')), (error: unknown) => error instanceof CascError && error.kind === 'Corrupted');
    });
});

describe('Storage', () => {
    it('describes the build it opened', async () => {
        const { built, storage } = await open();
        assert.strictEqual(storage.build.buildKey, built.buildKey);
        assert.strictEqual(storage.build.version, '1.0.0.1');
        assert.deepStrictEqual(storage.config['build-product'], ['Test1']);
        assert.strictEqual(storage.hasNames, true);
    });

    it('lists every file of the build', async () => {
        const { storage } = await open();
        assert.deepStrictEqual(storage.files().sort(), FILES.map(file => file.name).sort());
        assert.deepStrictEqual(storage.locales(), ['enUS', 'koKR']);
    });

    it('reads every installed file back, checked against its content key', async () => {
        const { storage } = await open();
        for (const file of FILES.filter(file => file.installed !== false)) {
            assert.deepStrictEqual(await storage.readFile(file.name, { verify: true }), file.bytes, file.name);
        }
    });

    it('matches names without case and with either slash', async () => {
        const { storage } = await open();
        assert.deepStrictEqual(await storage.readFile('SOUND\\misc\\buzz.WAV'), FILES[1].bytes);
        assert.ok(storage.has('Arr\\Units.dat'));
        assert.strictEqual(storage.fileInfo('ARR/UNITS.DAT')?.name, 'arr/units.dat');
    });

    it('reports size, key and whether the file is installed', async () => {
        const { storage } = await open();
        assert.deepStrictEqual(storage.fileInfo('arr/units.dat'), {
            name: 'arr/units.dat',
            contentKey: hex(md5(FILES[0].bytes)),
            size: 19876,
            installed: true,
        });
        assert.strictEqual(storage.fileInfo('locales/koKR/Assets/rez/stat_txt.tbl')?.installed, false);
        assert.strictEqual(storage.fileInfo('no/such/file'), null);
        assert.strictEqual(storage.has('no/such/file'), false);
    });

    it('tells a file the install lacks from one the build does not list', async () => {
        const { storage } = await open();
        await rejectsWith(storage.readFile('locales/koKR/Assets/rez/stat_txt.tbl'), 'NotInstalled');
        await rejectsWith(storage.readFile('no/such/file'), 'FileNotFound');
    });

    it('reads an empty file, which no archive stores', async () => {
        const { storage } = await open();
        assert.strictEqual(storage.fileInfo('glue/empty.txt')?.installed, true);
        assert.deepStrictEqual(await storage.readFile('glue/empty.txt', { verify: true }), new Uint8Array(0));
    });

    it('prefers the locale copy when a locale is given', async () => {
        const { storage } = await open();
        assert.deepStrictEqual(await storage.readFile('rez/stat_txt.tbl'), text('plain'));
        assert.deepStrictEqual(await storage.readFile('rez/stat_txt.tbl', { locale: 'enUS' }), text('english'));
        assert.deepStrictEqual(await storage.readFile('arr/units.dat', { locale: 'enUS' }), FILES[0].bytes);
        assert.strictEqual(storage.fileInfo('rez/stat_txt.tbl', { locale: 'enus' })?.name, 'locales/enUS/Assets/rez/stat_txt.tbl');
    });

    it('reads by content key', async () => {
        const { storage } = await open();
        const key = hex(md5(FILES[2].bytes));
        assert.deepStrictEqual(await storage.readByContentKey(key.toUpperCase(), { verify: true }), FILES[2].bytes);
        await rejectsWith(storage.readByContentKey('0'.repeat(32)), 'FileNotFound');
    });

    it('picks a build by product', async () => {
        const built = buildStorage(FILES, { product: 'StarCraft1' });
        const source = memorySource(built.files);
        assert.strictEqual((await Storage.open(source, { product: 'starcraft1' })).build.buildKey, built.buildKey);
        assert.strictEqual((await Storage.open(source, { product: 't1' })).build.buildKey, built.buildKey);
        await rejectsWith(Storage.open(source, { product: 'wow' }), 'NoBuildInfo');
    });

    it('opens a storage whose manifest is not text, for reading by key', async () => {
        const { storage } = await open(FILES, { root: new Uint8Array([0x4d, 0x46, 0x53, 0x54, 0, 1, 2, 3, 0xff, 0xfe]) });
        assert.strictEqual(storage.hasNames, false);
        assert.throws(() => storage.files(), (error: unknown) => error instanceof CascError && error.kind === 'UnsupportedRoot');
        assert.deepStrictEqual(await storage.readByContentKey(hex(md5(FILES[0].bytes))), FILES[0].bytes);
    });

    it('says so when the folder is not an install', async () => {
        await rejectsWith(Storage.open(memorySource({})), 'NoBuildInfo');
    });

    it('notices damaged data', async () => {
        const built = buildStorage(FILES);
        const storage = await Storage.open(memorySource(built.files));
        // Flip bytes throughout both data files, after the storage has its tables.
        for (const name of ['Data/data/data.000', 'Data/data/data.001']) {
            const bytes = built.files[name];
            for (let i = 40; i < bytes.length; i += 97) bytes[i] ^= 0xff;
        }
        // With verify on, a read either fails or returns the right bytes — never wrong ones.
        let caught = 0;
        for (const file of FILES.filter(file => file.installed !== false)) {
            let bytes: Uint8Array;
            try {
                bytes = await storage.readFile(file.name, { verify: true });
            } catch (error) {
                assert.ok(error instanceof CascError, String(error));
                assert.ok(['Corrupted', 'ChecksumMismatch', 'UnsupportedEncoding'].includes(error.kind), error.kind);
                caught++;
                continue;
            }
            assert.deepStrictEqual(bytes, file.bytes, file.name);
        }
        assert.ok(caught > 50, `only ${caught} damaged files were caught`);
    });

    it('reads only the ranges it needs from the data files', async () => {
        const built = buildStorage(FILES);
        const inner = memorySource(built.files);
        const reads: { path: string; length?: number }[] = [];
        const storage = await Storage.open({
            read: (path, offset, length) => {
                if (path.startsWith('Data/data/data.')) reads.push({ path, length });
                return inner.read(path, offset, length);
            },
            list: path => inner.list(path),
        });
        reads.length = 0;
        await storage.readFile('rez/stat_txt.tbl');
        assert.strictEqual(reads.length, 1);
        assert.ok(reads[0].length !== undefined && reads[0].length < 100);
    });
});
