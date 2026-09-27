import { resolve } from 'node:path';
import { writeFile } from 'node:fs/promises';
import { dist, root, json } from './shared.mjs';
import { createService } from '../src/chain.ts';
import { poolId, minimumOut, swapPlan } from '../src/trade.ts';

const manifest = await json(resolve(dist, 'imd-deployment.json'));
const abis = {};
for (const c of manifest.contracts) abis[c.name] = await json(resolve(dist, c.abiPath));
for (const [name, path] of Object.entries(manifest.protocolAbis)) abis[name] = await json(resolve(dist, path));
const runtime = { manifest, abis, token: manifest.contracts.find(c => c.name === manifest.token.contract), hook: manifest.contracts.find(c => c.name === manifest.hook.contract) };
const service = createService(runtime);
const result = { checkedAt: new Date().toISOString(), mode: 'Read-only public RPC; no wallet; no broadcast', chainId: manifest.chainId, poolId: poolId(runtime) };
try {
  await service.verify();
  result.verification = 'Chain ID, code presence on both attested contracts and required protocol contracts, hook/StateView PoolManager bindings passed';
  const snapshot = await service.snapshot();
  result.snapshot = snapshot;
  result.events = await service.windowEvents(snapshot);
  // Quoter simulations do not use funds or broadcast a transaction.
  result.buyQuote = { inputWei: '1000000000000', output: await service.quote('buy', 1000000000000n, runtime.token.address) };
  try {
    const handoff = await json(resolve(root, 'web/config/handoff.json'));
    const deploymentTx = await service.client.getTransaction({ hash: handoff.contracts[0].txHash });
    const plan = swapPlan(runtime, 'buy', 1000000000000n, minimumOut(result.buyQuote.output, 50n), BigInt(Math.floor(Date.now() / 1000) + 300));
    await service.client.simulateContract({ ...plan, account: deploymentTx.from });
    result.buyExecutionSimulation = { result: 'PASS', method: 'eth_call only', from: deploymentTx.from, router: plan.address, valueWei: plan.value, slippageBps: 50 };
  } catch (error) { result.buyExecutionSimulation = { result: 'NOT VERIFIED', error: error.shortMessage ?? error.message }; }
} catch (error) { result.error = error.shortMessage ?? error.message; }
const text = JSON.stringify(result, (_, value) => typeof value === 'bigint' ? value.toString() : value, 2) + '\n';
await writeFile(resolve(root, 'docs/evidence/live-read.json'), text);
console.log(text);
if (result.error) process.exitCode = 1;
