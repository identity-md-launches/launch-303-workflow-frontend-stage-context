import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { parseAbi } from 'viem';
import { web, root, json, abiHash } from './shared.mjs';

const handoff = await json(resolve(web, 'config/handoff.json'));
const network = await json(resolve(web, 'config/network.json'));
if (handoff.chainId !== network.network.chainId || Number(network.walletAddChain.chainId) !== handoff.chainId) throw Error('Network/handoff mismatch');
await mkdir(resolve(web, 'public/abi'), { recursive: true });
for (const contract of handoff.contracts) {
  const sourcePath = `docs/abi/${contract.name}.json`;
  const bytes = await readFile(resolve(root, sourcePath));
  // If this is a Git checkout, require the implementation-derived ABI at the attested commit.
  let inGit = false;
  try { inGit = execFileSync('git', ['rev-parse', '--is-inside-work-tree'], { cwd: root, stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim() === 'true'; } catch { /* source archives still verify the attested hash below */ }
  if (inGit) {
    const pinned = execFileSync('git', ['show', `${handoff.sourceCommit}:${sourcePath}`], { cwd: root });
    if (!pinned.equals(bytes)) throw Error(`${sourcePath} differs from pinned commit`);
  }
  const abi = JSON.parse(bytes);
  if (!Array.isArray(abi) || abiHash(abi) !== contract.abiHash) throw Error(`ABI hash mismatch: ${contract.name}`);
  await writeFile(resolve(web, 'public/abi', contract.name + '.json'), bytes);
  console.log(`Verified ${contract.name}: ${contract.abiHash}`);
}
// Minimal protocol interfaces. Sources/version rationale are recorded in docs/FRONTEND.md.
const key = '(address currency0,address currency1,uint24 fee,int24 tickSpacing,address hooks)';
const interfaces = {
  StateView: ['function poolManager() view returns (address)', 'function getSlot0(bytes32 poolId) view returns (uint160 sqrtPriceX96,int24 tick,uint24 protocolFee,uint24 lpFee)', 'function getLiquidity(bytes32 poolId) view returns (uint128 liquidity)'],
  V4Quoter: [`function quoteExactInputSingle((${key} poolKey,bool zeroForOne,uint128 exactAmount,bytes hookData) params) returns (uint256 amountOut,uint256 gasEstimate)`],
  UniversalRouter: ['function execute(bytes commands,bytes[] inputs,uint256 deadline) payable', 'error ExecutionFailed(uint256 commandIndex,bytes message)', 'error V4TooLittleReceived(uint256 minAmountOutReceived,uint256 amountReceived)', 'error TransactionDeadlinePassed()'],
  Permit2: ['function allowance(address owner,address token,address spender) view returns (uint160 amount,uint48 expiration,uint48 nonce)', 'function approve(address token,address spender,uint160 amount,uint48 expiration)'],
};
for (const [name, signatures] of Object.entries(interfaces)) await writeFile(resolve(web, 'public/abi', name + '.json'), JSON.stringify(parseAbi(signatures), null, 2) + '\n');
