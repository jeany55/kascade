/**
 * Against a real install, when one is named: `KASCADE_INSTALL=/path/to/StarCraft npm test`.
 * Skipped otherwise — CI has no game, and none of its files can be committed.
 */
import { describe, it } from 'node:test';
import * as assert from 'node:assert';
import { Storage } from '../src/index';
import { nodeSource } from '../src/node';

const install = process.env.KASCADE_INSTALL;

describe('a real install', { skip: !install && 'KASCADE_INSTALL is not set' }, () => {
    it('opens, lists and reads files that hash to their content keys', async () => {
        const storage = await Storage.open(nodeSource(install!));
        const files = storage.files();
        assert.ok(files.length > 1000, `${files.length} files`);

        const installed = files.filter(name => storage.fileInfo(name)!.installed);
        assert.ok(installed.length > 1000, `${installed.length} installed files`);

        // A spread of the install, largest files left out to keep this quick.
        const step = Math.max(1, Math.floor(installed.length / 300));
        let read = 0;
        for (let i = 0; i < installed.length; i += step) {
            const info = storage.fileInfo(installed[i])!;
            if (info.size > 8 * 1024 * 1024) continue;
            const bytes = await storage.readFile(installed[i], { verify: true });
            assert.strictEqual(bytes.length, info.size, installed[i]);
            read++;
        }
        assert.ok(read > 100, `${read} files read`);
    });
});
