/**
 * An opened CASC storage: the chain from a file's name to its bytes.
 *
 *   name --root--> content key --encoding--> encoding key --index--> data.NNN --BLTE--> bytes
 */
import { decodeBlte } from './blte';
import { decodeText, fromHex, toHex, u32le } from './bytes';
import { configPath, parseBuildInfo, parseConfig } from './config';
import type { BuildInfo } from './config';
import { parseEncoding } from './encoding';
import type { EncodingEntry } from './encoding';
import { CascError } from './error';
import { archiveName, currentIndexFiles, INDEX_KEY_BYTES, parseIndexFile } from './localIndex';
import type { IndexEntry } from './localIndex';
import { md5 } from './md5';
import { normalizeName, parseRoot } from './root';
import type { RootEntry } from './root';
import type { StorageSource } from './source';

export interface OpenOptions {
    /**
     * Which build to open when `.build.info` lists several: matched against
     * the row's product code and the build config's `build-product` and
     * `build-uid`, without case. The first active build when left out.
     */
    product?: string;
    /** Check every file read against its content key. Off by default; `readFile` can ask per call. */
    verify?: boolean;
}

export interface ReadOptions {
    /** Check the bytes against the content key (an MD5 over the whole file). */
    verify?: boolean;
    /**
     * A locale such as `enUS`. The file is looked for under
     * `locales/<locale>/Assets/` first, then at the path as given.
     */
    locale?: string;
}

export interface FileInfo {
    /** The path as the manifest spells it. */
    name: string;
    /** Hex content key: the MD5 of the file's bytes. */
    contentKey: string;
    /** Size of the file once read. */
    size: number;
    /** Whether this install holds the file. A build lists every language; an install has some. */
    installed: boolean;
}

/** Records in the data files start with a header this long, then the BLTE stream. */
const RECORD_HEADER = 30;
/** The content key of a file with nothing in it, which is stored nowhere. */
const EMPTY_KEY = 'd41d8cd98f00b204e9800998ecf8427e';

export class Storage {
    /** The build that was opened. */
    public readonly build: BuildInfo;
    /** The build config, by setting name (`build-name`, `root`, `encoding`, …). */
    public readonly config: Readonly<Record<string, string[]>>;

    private readonly source: StorageSource;
    private readonly index: Map<string, IndexEntry>;
    private readonly encoding: Map<string, EncodingEntry>;
    private readonly root: Map<string, RootEntry> | null;
    private readonly verify: boolean;

    private constructor(
        source: StorageSource,
        build: BuildInfo,
        config: Record<string, string[]>,
        index: Map<string, IndexEntry>,
        encoding: Map<string, EncodingEntry>,
        root: Map<string, RootEntry> | null,
        verify: boolean,
    ) {
        this.source = source;
        this.build = build;
        this.config = config;
        this.index = index;
        this.encoding = encoding;
        this.root = root;
        this.verify = verify;
    }

    /**
     * Opens the storage in an install folder. Reads the build's description,
     * the index and the two manifests (a few megabytes); file contents are
     * read when asked for.
     */
    static async open(source: StorageSource, options: OpenOptions = {}): Promise<Storage> {
        const builds = parseBuildInfo(decodeText(await io(source.read('.build.info'), 'NoBuildInfo', '.build.info')));
        const candidates = builds.filter(build => build.active).concat(builds.filter(build => !build.active));
        if (candidates.length === 0) throw new CascError('NoBuildInfo', '.build.info lists no builds');

        let chosen: { build: BuildInfo; config: Record<string, string[]> } | undefined;
        const wanted = options.product?.toLowerCase();
        for (const build of candidates) {
            const path = configPath(build.buildKey);
            const config = parseConfig(decodeText(await io(source.read(path), 'IoError', path)));
            const names = [build.product, config['build-product']?.[0], config['build-uid']?.[0]];
            if (wanted === undefined || names.some(name => name?.toLowerCase() === wanted)) {
                chosen = { build, config };
                break;
            }
        }
        if (!chosen) throw new CascError('NoBuildInfo', `no build of ${options.product} in .build.info`);
        const { build, config } = chosen;

        const index = new Map<string, IndexEntry>();
        const names = currentIndexFiles(await io(source.list('Data/data'), 'IoError', 'Data/data'));
        if (names.length === 0) throw new CascError('Corrupted', 'Data/data holds no index files');
        const indexFiles = await Promise.all(
            names.map(name => io(source.read(`Data/data/${name}`), 'IoError', `Data/data/${name}`)),
        );
        indexFiles.forEach((bytes, i) => parseIndexFile(bytes, index, names[i]));

        // The encoding file cannot look itself up, so the config gives its encoding key outright.
        const encodingKey = config['encoding']?.[1];
        const rootKey = config['root']?.[0];
        if (!encodingKey || !rootKey) throw new CascError('Corrupted', 'the build config names no encoding or root file');

        const storage = new Storage(source, build, config, index, new Map(), null, options.verify ?? false);
        const encoding = parseEncoding(await storage.readByEncodingKey(encodingKey));

        let root: Map<string, RootEntry> | null = null;
        const rootEntry = encoding.get(rootKey.toLowerCase());
        if (rootEntry) {
            try {
                root = parseRoot(await storage.readByEncodingKey(rootEntry.encodingKey));
            } catch (error) {
                // A manifest in another game's format: the storage still reads by key.
                if (!(error instanceof CascError) || error.kind !== 'UnsupportedRoot') throw error;
            }
        }
        return new Storage(source, build, config, index, encoding, root, options.verify ?? false);
    }

    /** Whether the build's manifest of names could be read. Without it, files are reachable by key only. */
    get hasNames(): boolean {
        return this.root !== null;
    }

    /** Every file the build lists, installed or not, as the manifest spells them. */
    files(): string[] {
        return [...this.names().values()].map(entry => entry.name);
    }

    /** The locales the build has files for (`enUS`, `koKR`, …), from the `locales/` folder of the manifest. */
    locales(): string[] {
        const found = new Set<string>();
        for (const entry of this.names().values()) {
            const match = /^locales\/([^/]+)\//i.exec(entry.name);
            if (match) found.add(match[1]);
        }
        return [...found].sort();
    }

    /** Whether the build lists the file. It may still not be installed; see `fileInfo`. */
    has(name: string, options: Pick<ReadOptions, 'locale'> = {}): boolean {
        return this.lookup(name, options.locale) !== undefined;
    }

    /** What the manifests say about a file, or `null` when the build does not list it. */
    fileInfo(name: string, options: Pick<ReadOptions, 'locale'> = {}): FileInfo | null {
        const entry = this.lookup(name, options.locale);
        if (!entry) return null;
        const encoded = this.encoding.get(entry.contentKey);
        return {
            name: entry.name,
            contentKey: entry.contentKey,
            size: encoded?.size ?? 0,
            installed: entry.contentKey === EMPTY_KEY || (encoded !== undefined && this.located(encoded.encodingKey)),
        };
    }

    /** A file's bytes by its name. Names compare without case, and either slash separates folders. */
    async readFile(name: string, options: ReadOptions = {}): Promise<Uint8Array> {
        const entry = this.lookup(name, options.locale);
        if (!entry) throw new CascError('FileNotFound', name);
        return this.readByContentKey(entry.contentKey, options, entry.name);
    }

    /** A file's bytes by its content key (32 hex digits), for files the manifest does not name. */
    async readByContentKey(
        contentKey: string,
        options: Pick<ReadOptions, 'verify'> = {},
        label = contentKey,
    ): Promise<Uint8Array> {
        const key = contentKey.toLowerCase();
        if (key === EMPTY_KEY) return new Uint8Array(0);
        const encoded = this.encoding.get(key);
        if (!encoded) throw new CascError('FileNotFound', label);
        const bytes = await this.readByEncodingKey(encoded.encodingKey, label);
        if ((options.verify ?? this.verify) && toHex(md5(bytes)) !== key) {
            throw new CascError('ChecksumMismatch', label);
        }
        return bytes;
    }

    /** A stored record's decoded bytes by its encoding key (hex; the first nine bytes are enough). */
    async readByEncodingKey(encodingKey: string, label = encodingKey): Promise<Uint8Array> {
        const short = encodingKey.toLowerCase().slice(0, INDEX_KEY_BYTES * 2);
        const where = this.index.get(short);
        if (!where) throw new CascError('NotInstalled', label);
        if (where.size < RECORD_HEADER) throw new CascError('Corrupted', `${label}: record is too small`);

        const path = `Data/data/${archiveName(where.archive)}`;
        const record = await io(this.source.read(path, where.offset, where.size), 'IoError', path);
        if (record.length !== where.size) throw new CascError('Corrupted', `${label}: ${path} ends inside the record`);

        // The header opens with the encoding key backwards, then the record's own size.
        const expected = fromHex(short);
        for (let i = 0; i < expected.length; i++) {
            if (record[15 - i] !== expected[i]) {
                throw new CascError('Corrupted', `${label}: the index points at another record`);
            }
        }
        if (u32le(record, 16) !== where.size) throw new CascError('Corrupted', `${label}: record size disagrees with the index`);
        return decodeBlte(record.subarray(RECORD_HEADER));
    }

    private names(): Map<string, RootEntry> {
        if (!this.root) {
            throw new CascError('UnsupportedRoot', 'this build has no text manifest of names; read by content key');
        }
        return this.root;
    }

    private lookup(name: string, locale?: string): RootEntry | undefined {
        const names = this.names();
        const plain = normalizeName(name);
        if (locale) {
            const localized = names.get(`locales/${locale.toLowerCase()}/assets/${plain}`);
            if (localized) return localized;
        }
        return names.get(plain);
    }

    private located(encodingKey: string): boolean {
        return this.index.has(encodingKey.slice(0, INDEX_KEY_BYTES * 2));
    }
}

async function io<T>(pending: Promise<T>, kind: 'IoError' | 'NoBuildInfo', what: string): Promise<T> {
    try {
        return await pending;
    } catch (error) {
        if (error instanceof CascError && error.kind !== 'IoError') throw error;
        throw new CascError(kind, `${what}: ${error instanceof Error ? error.message : String(error)}`);
    }
}
