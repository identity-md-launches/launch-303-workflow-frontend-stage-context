import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { web, dist, json, inventory } from './shared.mjs';

const h = await json(resolve(web, 'config/handoff.json'));
const n = await json(resolve(web, 'config/network.json'));
const manifest = {
  version: 1, launchId: h.launchId, chainId: h.chainId, sourceCommit: h.sourceCommit, attestationHash: h.attestationHash,
  contracts: h.contracts.map(({ name, address, abiHash }) => ({ name, address, abiHash, abiPath: `abi/${name}.json` })),
  assets: await inventory(),
  network: n.network,
  walletAddChain: n.walletAddChain,
  pool: h.manifest.pool,
  token: h.manifest.token,
  hook: { contract: h.manifest.hook.contract },
  deploymentBlock: Math.min(...h.contracts.map(c => c.blockNumber)),
  protocolAbis: { stateView: 'abi/StateView.json', quoter: 'abi/V4Quoter.json', universalRouter: 'abi/UniversalRouter.json', permit2: 'abi/Permit2.json' },
};
await writeFile(resolve(dist, 'imd-deployment.json'), JSON.stringify(manifest, null, 2) + '\n');
console.log(`Manifest generated after export: ${manifest.assets.length} assets`);
