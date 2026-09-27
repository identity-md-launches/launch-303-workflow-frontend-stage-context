import assert from 'node:assert/strict';
import { stat, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { web, dist, json, inventory, abiHash } from './shared.mjs';
const h = await json(resolve(web, 'config/handoff.json'));
const n = await json(resolve(web, 'config/network.json'));
const m = await json(resolve(dist, 'imd-deployment.json'));
for (const key of ['version', 'launchId', 'chainId', 'sourceCommit', 'attestationHash']) assert.equal(m[key], h[key]);
assert.deepEqual(m.network, n.network);
assert.deepEqual(m.walletAddChain, n.walletAddChain);
assert.deepEqual(m.pool, h.manifest.pool);
assert.deepEqual(m.contracts.map(({ name, address, abiHash }) => ({ name, address, abiHash })), h.contracts.map(({ name, address, abiHash }) => ({ name, address, abiHash })));
assert.deepEqual(m.assets, await inventory());
assert(m.assets.some(a => a.path === 'index.html'));
assert(m.assets.length <= 128);
let total = (await stat(resolve(dist, 'imd-deployment.json'))).size;
for (const asset of m.assets) {
  assert(/^[a-zA-Z0-9_./-]+$/.test(asset.path) && !asset.path.split('/').includes('..') && !asset.path.startsWith('/'));
  assert(/^[a-f0-9]{64}$/.test(asset.sha256));
  const size = (await stat(resolve(dist, asset.path))).size;
  assert(size <= 8388608); total += size;
}
for (const c of m.contracts) assert.equal(abiHash(await json(resolve(dist, c.abiPath))), c.abiHash);
assert(total < 32 * 1024 * 1024);
const html = await readFile(resolve(dist, 'index.html'), 'utf8');
assert(!/(?:src|href)="\/(?!\/)/.test(html), 'Export must use relative resources');
console.log(`PASS: deployment, unchanged network, ABI hashes, exact inventory, relative assets; ${m.assets.length} assets, ${total} export bytes.`);
