/**
 * The two text files that say which build a storage holds: `.build.info` at
 * the top of the install, and the build config it points at.
 */
import { CascError } from './error';

/** One row of `.build.info`: an installed build of one product. */
export interface BuildInfo {
    /** Hex key of the build config, under `Data/config/`. */
    buildKey: string;
    /** For example `1.23.10.13515`. */
    version: string;
    /** The product code where the launcher wrote one; often empty. */
    product: string;
    branch: string;
    active: boolean;
    /** Every column of the row by its header name (`Build Key`, `CDN Path`, …). */
    fields: Record<string, string>;
}

/**
 * `.build.info` is a pipe-separated table. The header cells are
 * `Name!TYPE:size`; only the name matters here.
 */
export function parseBuildInfo(text: string): BuildInfo[] {
    const lines = text.split(/\r?\n/).filter(line => line.trim() !== '');
    if (lines.length === 0) return [];
    const names = lines[0].split('|').map(cell => cell.split('!')[0].trim());
    if (!names.includes('Build Key')) throw new CascError('Corrupted', '.build.info has no Build Key column');
    return lines.slice(1).map(line => {
        const cells = line.split('|');
        const fields: Record<string, string> = {};
        names.forEach((name, i) => (fields[name] = cells[i] ?? ''));
        return {
            buildKey: fields['Build Key'].toLowerCase(),
            version: fields['Version'] ?? '',
            product: fields['Product'] ?? '',
            branch: fields['Branch'] ?? '',
            active: (fields['Active'] ?? '1') === '1',
            fields,
        };
    });
}

/** A config file is `name = value value …` lines; `#` starts a comment. */
export function parseConfig(text: string): Record<string, string[]> {
    const out: Record<string, string[]> = {};
    for (const line of text.split(/\r?\n/)) {
        const trimmed = line.trim();
        if (trimmed === '' || trimmed.startsWith('#')) continue;
        const eq = trimmed.indexOf('=');
        if (eq < 0) continue;
        out[trimmed.slice(0, eq).trim()] = trimmed
            .slice(eq + 1)
            .trim()
            .split(/\s+/)
            .filter(Boolean);
    }
    return out;
}

/** Where a config lives: `Data/config/ab/cd/abcd…`. */
export function configPath(key: string): string {
    return `Data/config/${key.slice(0, 2)}/${key.slice(2, 4)}/${key}`;
}
