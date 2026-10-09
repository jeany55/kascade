/**
 * Where the storage's bytes come from. A CASC install is a folder holding
 * gigabytes, so the library never asks for it whole: it lists one folder and
 * reads byte ranges, and anything that can do those two things is a source.
 */
import { CascError } from './error';

export interface StorageSource {
    /**
     * Bytes of a file, by its path from the install folder with forward slashes
     * (`Data/data/data.000`). With `offset` and `length`, that range only;
     * without them, the whole file. Rejects when the file is absent.
     */
    read(path: string, offset?: number, length?: number): Promise<Uint8Array>;
    /** The names of the files in a folder (`Data/data`). */
    list(path: string): Promise<string[]>;
}

/**
 * A source over files already in memory, keyed by path from the install
 * folder. For tests, and for a storage small enough to have been fetched whole.
 */
export function memorySource(files: Record<string, Uint8Array> | Map<string, Uint8Array>): StorageSource {
    const map = files instanceof Map ? files : new Map(Object.entries(files));
    return {
        async read(path, offset, length) {
            const bytes = map.get(path);
            if (!bytes) throw new CascError('IoError', `no such file: ${path}`);
            if (offset === undefined) return bytes;
            return bytes.subarray(offset, length === undefined ? undefined : offset + length);
        },
        async list(path) {
            const prefix = path.replace(/\/+$/, '') + '/';
            const names: string[] = [];
            for (const name of map.keys()) {
                if (name.startsWith(prefix) && !name.slice(prefix.length).includes('/')) {
                    names.push(name.slice(prefix.length));
                }
            }
            return names;
        },
    };
}

/** The parts of the browser's `FileSystemDirectoryHandle` this library uses. */
export interface DirectoryHandleLike {
    getDirectoryHandle(name: string): Promise<DirectoryHandleLike>;
    getFileHandle(name: string): Promise<FileHandleLike>;
    keys(): AsyncIterable<string>;
}

export interface FileHandleLike {
    getFile(): Promise<BlobLike>;
}

export interface BlobLike {
    slice(start?: number, end?: number): BlobLike;
    arrayBuffer(): Promise<ArrayBuffer>;
}

/**
 * A source over a folder the user picked in the browser
 * (`await showDirectoryPicker()`), which must be the install folder — the one
 * holding `.build.info`.
 */
export function directoryHandleSource(root: DirectoryHandleLike): StorageSource {
    const folders = new Map<string, Promise<DirectoryHandleLike>>();
    const files = new Map<string, Promise<BlobLike>>();

    function folder(path: string): Promise<DirectoryHandleLike> {
        if (path === '') return Promise.resolve(root);
        let found = folders.get(path);
        if (!found) {
            const cut = path.lastIndexOf('/');
            found = folder(cut < 0 ? '' : path.slice(0, cut)).then(parent =>
                parent.getDirectoryHandle(path.slice(cut + 1)),
            );
            folders.set(path, found);
        }
        return found;
    }

    function file(path: string): Promise<BlobLike> {
        let found = files.get(path);
        if (!found) {
            const cut = path.lastIndexOf('/');
            found = folder(cut < 0 ? '' : path.slice(0, cut))
                .then(parent => parent.getFileHandle(path.slice(cut + 1)))
                .then(handle => handle.getFile());
            files.set(path, found);
            // A failed lookup is not remembered: the file may appear later.
            found.catch(() => files.delete(path));
        }
        return found;
    }

    return {
        async read(path, offset, length) {
            const blob = await file(path);
            const part =
                offset === undefined ? blob : blob.slice(offset, length === undefined ? undefined : offset + length);
            return new Uint8Array(await part.arrayBuffer());
        },
        async list(path) {
            const names: string[] = [];
            for await (const name of (await folder(path.replace(/\/+$/, ''))).keys()) names.push(name);
            return names;
        },
    };
}
