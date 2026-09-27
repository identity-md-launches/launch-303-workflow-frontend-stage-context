import { readFile, readdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { keccak256, toHex } from 'viem';

export const web = fileURLToPath(new URL('../', import.meta.url));
export const root = resolve(web, '..');
export const dist = resolve(root, 'dist');
export const json = async path => JSON.parse(await readFile(path, 'utf8'));
export const canonical = value => Array.isArray(value) ? value.map(canonical)
  : value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value;
export const abiHash = abi => keccak256(toHex(JSON.stringify(canonical(abi)))).slice(2);
export const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
export async function inventory(dir = dist, prefix = '') {
  const files = [];
  for (const item of await readdir(dir, { withFileTypes: true })) {
    const path = prefix + item.name;
    if (item.isSymbolicLink()) throw Error(`Symlink is not allowed: ${path}`);
    if (item.isDirectory()) files.push(...await inventory(resolve(dir, item.name), path + '/'));
    else if (path !== 'imd-deployment.json') files.push({ path, sha256: sha256(await readFile(resolve(dist, path))) });
  }
  return files.sort((a, b) => a.path.localeCompare(b.path));
}
