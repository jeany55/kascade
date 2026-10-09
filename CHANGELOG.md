# Changelog

## 0.1.0

First version.

- `Storage.open(source)` opens a local CASC install: `.build.info`, the build
  config, version 7 index files, the encoding file and a text root manifest.
- `files()`, `has()`, `fileInfo()`, `readFile()`, `locales()`, and reading by
  content key or encoding key.
- BLTE decoding of raw and zlib chunks; `verify` checks a file against its
  content key.
- Sources: `nodeSource` (`kascade/node`), `directoryHandleSource` for a folder
  picked in the browser, and `memorySource`.
- Read against StarCraft: Remastered 1.23.10.
