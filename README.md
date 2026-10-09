# kascade

Read files out of Blizzard CASC storage in JavaScript and TypeScript.

CASC is how Blizzard's launcher stores a game on disk: a `Data` folder of large
`data.NNN` files in place of the MPQ archives older games shipped. This library
opens such an install and reads files from it by name.

It reads **StarCraft: Remastered** installs, which is what it was written for
and tested against. See [What it reads](#what-it-reads) for other games.

[![npm](https://img.shields.io/npm/v/kascade.svg)](https://www.npmjs.com/package/kascade)
[![CI](https://github.com/jeany55/kascade/actions/workflows/ci.yml/badge.svg)](https://github.com/jeany55/kascade/actions/workflows/ci.yml)
[![license](https://img.shields.io/npm/l/kascade.svg)](./LICENSE)

The main entry contains no Node built-ins, so the same build runs in Node 18+,
browsers, Deno and Bun. It is read-only: nothing here writes to an install.

## Install

```bash
npm install kascade
```

## Reading from an install

```typescript
import { Storage } from 'kascade';
import { nodeSource } from 'kascade/node';

const storage = await Storage.open(nodeSource('C:/Program Files (x86)/StarCraft'));

storage.build.version;                         // '1.23.10.13515'
storage.files();                               // ['arr/units.dat', 'sound/Misc/Buzz.wav', ...]
await storage.readFile('arr/units.dat');       // Uint8Array
```

The folder is the install folder, the one holding `.build.info`. Opening reads
the build's description, its index and its two manifests, a few megabytes in
all. File contents are read from the data files when you ask for them, one
byte range per file.

Names compare without case, and either slash separates folders, so
`arr\\units.dat` and `Arr/Units.dat` are the same file.

## In the browser

A page cannot read a folder until the user picks it. With the File System
Access API (Chromium browsers):

```typescript
import { Storage, directoryHandleSource } from 'kascade';

const folder = await window.showDirectoryPicker();
const storage = await Storage.open(directoryHandleSource(folder));
const wav = await storage.readFile('sound/Terran/Marine/TMaRdy00.wav');
```

## Installed and not installed

A build lists every file of every language, and an install holds only part of
that. `files()` returns the whole list; `fileInfo` says whether a file is
actually there.

```typescript
storage.fileInfo('arr/units.dat');
// { name: 'arr/units.dat', contentKey: '…', size: 19876, installed: true }

storage.fileInfo('no/such/file');  // null
```

Reading a file the build does not list rejects with a `FileNotFound` error.
Reading one that is listed but not on disk rejects with `NotInstalled`.

## Locales

Localized files sit under `locales/<locale>/Assets/`, beside a copy at the
plain path. Pass a locale to get the localized file when there is one:

```typescript
storage.locales();                                           // ['deDE', 'enUS', 'koKR', ...]
await storage.readFile('rez/stat_txt.tbl', { locale: 'koKR' });
```

That reads `locales/koKR/Assets/rez/stat_txt.tbl` if the build lists it, and
`rez/stat_txt.tbl` otherwise.

## Checking what was read

A file's content key is the MD5 of its bytes. `verify` hashes what was read
and rejects with `ChecksumMismatch` when it differs:

```typescript
await storage.readFile('arr/units.dat', { verify: true });

// or for every read
const storage = await Storage.open(source, { verify: true });
```

It is off by default because hashing is the larger part of the cost of a read.

## Other sources

`Storage.open` takes anything with these two methods, so a storage can be read
from wherever its files are:

```typescript
interface StorageSource {
  /** A file's bytes by path from the install folder; a byte range when offset and length are given. */
  read(path: string, offset?: number, length?: number): Promise<Uint8Array>;
  /** The names of the files in a folder. */
  list(path: string): Promise<string[]>;
}
```

`nodeSource(directory)` (from `kascade/node`), `directoryHandleSource(handle)`
and `memorySource(files)` are the ones provided.

## Reading by key

Files the manifest does not name can be read by content key or encoding key,
both as hex:

```typescript
await storage.readByContentKey('b96213f265684e16db5a8552eba1be09');
await storage.readByEncodingKey('d60c75462f683e2db2');
```

`storage.config` is the build config, which names the build's own files
(`root`, `encoding`, `install`, …) by these keys.

## Errors

Everything the library throws is a `CascError` with a `kind`:

| `kind` | Meaning |
|--------|---------|
| `NoBuildInfo` | The folder has no `.build.info`, or no build in it matches `product`. |
| `IoError` | The source could not supply a file or byte range. |
| `FileNotFound` | The build does not list the file. |
| `NotInstalled` | The build lists the file; this install does not hold it. |
| `Corrupted` | A file of the storage does not parse, or a record is not where the index says. |
| `ChecksumMismatch` | `verify` was on and the bytes do not hash to the content key. |
| `UnsupportedVersion` | An index or encoding file in a version this library does not read. |
| `UnsupportedEncoding` | The file is stored encrypted, or as nested frames. |
| `UnsupportedRoot` | The build's manifest of names is not text. See below. |

## What it reads

- Local installs: `.build.info`, the build config, version 7 index files, the
  encoding file, and BLTE streams of raw and zlib chunks.
- Names from a text manifest, which is what StarCraft: Remastered has.

What it does not:

- **Other games' manifests.** Warcraft III, World of Warcraft, Diablo and the
  rest keep binary manifests in several formats. Such a storage still opens:
  `storage.hasNames` is `false`, `files()` and `readFile()` throw
  `UnsupportedRoot`, and `readByContentKey` works if you have keys from
  elsewhere. This has not been tried against those games.
- **Encrypted files.** None were met in StarCraft: Remastered.
- **Downloading.** A file that is not installed is not fetched from the CDN.
- **Writing.**

The game's files belong to Blizzard. This library reads an install you have;
it contains none of them and fetches none.

## License

MIT
