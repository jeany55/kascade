/**
 * CASC error types.
 */

export type CascErrorKind =
    /** The folder has no `.build.info`, or no build in it matches. */
    | 'NoBuildInfo'
    /** The source could not supply a file or a byte range the storage needs. */
    | 'IoError'
    | 'UnsupportedVersion'
    | 'Corrupted'
    | 'FileNotFound'
    /** The build lists the file but this install does not hold it (another language, an optional download). */
    | 'NotInstalled'
    /** A BLTE chunk uses a mode this library does not decode (encrypted or nested frames). */
    | 'UnsupportedEncoding'
    /** The root file is not the text manifest this library reads; files can still be read by key. */
    | 'UnsupportedRoot'
    /** `verify` was asked for and the content does not hash to its content key. */
    | 'ChecksumMismatch';

export class CascError extends Error {
    public readonly kind: CascErrorKind;
    public readonly detail?: string;

    constructor(kind: CascErrorKind, detail?: string) {
        super(detail ? `${kind}: ${detail}` : kind);
        this.kind = kind;
        this.detail = detail;
        this.name = 'CascError';
    }
}
