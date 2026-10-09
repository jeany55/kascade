/**
 * The root file: the build's manifest of file names. StarCraft: Remastered
 * keeps it as text, one `path|contentKey` line per file. Other games use
 * binary manifests, which this library does not read.
 */
import { decodeText } from './bytes';
import { CascError } from './error';

export interface RootEntry {
    /** The path as the manifest spells it, with forward slashes. */
    name: string;
    /** Hex content key: the MD5 of the file's bytes. */
    contentKey: string;
}

const LINE = /^([^|\r\n]+)\|([0-9a-fA-F]{32})(?:\|.*)?$/;

/** Names compare without case and with either slash. */
export function normalizeName(name: string): string {
    return name.replace(/\\/g, '/').replace(/^\/+/, '').toLowerCase();
}

export function parseRoot(bytes: Uint8Array): Map<string, RootEntry> {
    const out = new Map<string, RootEntry>();
    const lines = decodeText(bytes).split(/\r?\n/);
    for (const line of lines) {
        if (line === '') continue;
        const match = LINE.exec(line);
        if (!match) {
            throw new CascError('UnsupportedRoot', 'the root file is not a text manifest of path|key lines');
        }
        const name = match[1].replace(/\\/g, '/');
        const key = normalizeName(name);
        if (!out.has(key)) out.set(key, { name, contentKey: match[2].toLowerCase() });
    }
    return out;
}
