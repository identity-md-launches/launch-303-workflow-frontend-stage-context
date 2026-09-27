import { createWalletClient, custom, getAbiItem, type Address, type Hex } from 'viem';
import { networkChain, publicClient, type Provider, type Runtime } from './config.ts';
import { assertWallet } from './wallet.ts';
import { direction, poolId, poolKey, swapPlan, type Side } from './trade.ts';

export interface Snapshot {
  block: bigint; timestamp: bigint; opensAt: bigint; sellsOpen: boolean; window: bigint;
  sqrtPrice: bigint; tick: number; lpFee: number; liquidity: bigint; decimals: number; symbol: string;
  totalSupply: bigint; ethBalance?: bigint; tokenBalance?: bigint; secondsPerBlock: number; blockTimeSampled: boolean;
  fetchedAt: number;
}
export interface WindowEvent { blockNumber: bigint; transactionHash: Hex; opensAt: bigint }
export function createService(runtime: Runtime, provider?: Provider) {
  const client = publicClient(runtime, provider);
  const m = runtime.manifest;
  const protocol = m.network.uniswapV4;
  const id = poolId(runtime);
  const hookAbi = runtime.abis[runtime.hook.name];
  const tokenAbi = runtime.abis[runtime.token.name];
  async function verify() {
    if (await client.getChainId() !== m.chainId) throw Error('RPC chain ID disagrees with the deployment. Trading is unavailable.');
    const addresses = [...m.contracts.map(c => c.address), protocol.poolManager, protocol.stateView, protocol.quoter, protocol.universalRouter, protocol.permit2];
    const codes = await Promise.all(addresses.map(address => client.getCode({ address })));
    if (codes.some(code => !code || code === '0x')) throw Error('A configured contract has no deployed code. Trading is unavailable.');
    const [manager, viewManager] = await Promise.all([
      client.readContract({ address: runtime.hook.address, abi: hookAbi, functionName: 'poolManager' }),
      client.readContract({ address: protocol.stateView, abi: runtime.abis.stateView, functionName: 'poolManager' }),
    ]);
    if (String(manager).toLowerCase() !== protocol.poolManager.toLowerCase() || String(viewManager).toLowerCase() !== protocol.poolManager.toLowerCase()) throw Error('PoolManager binding does not match the deployment. Trading is unavailable.');
  }
  async function snapshot(account?: Address): Promise<Snapshot> {
    const block = await client.getBlock({ blockTag: 'latest' });
    const blockNumber = block.number;
    const hookRead = (functionName: string, args: readonly unknown[] = []) => client.readContract({ address: runtime.hook.address, abi: hookAbi, functionName, args, blockNumber });
    const tokenRead = (functionName: string, args: readonly unknown[] = []) => client.readContract({ address: runtime.token.address, abi: tokenAbi, functionName, args, blockNumber });
    const values = await Promise.all([
      hookRead('opensAt', [id]), hookRead('sellsOpen', [id]), hookRead('WINDOW_BLOCKS'),
      client.readContract({ address: protocol.stateView, abi: runtime.abis.stateView, functionName: 'getSlot0', args: [id], blockNumber }),
      client.readContract({ address: protocol.stateView, abi: runtime.abis.stateView, functionName: 'getLiquidity', args: [id], blockNumber }),
      tokenRead('decimals'), tokenRead('symbol'), tokenRead('totalSupply'),
      account ? client.getBalance({ address: account, blockNumber }) : undefined,
      account ? tokenRead('balanceOf', [account]) : undefined,
      client.getBlock({ blockNumber: blockNumber > 100n ? blockNumber - 100n : 0n }).catch(() => undefined),
    ]);
    const [opensAt, sellsOpen, window, slot, liquidity, decimals, symbol, totalSupply, ethBalance, tokenBalance, old] = values;
    const [sqrtPrice, tick, , lpFee] = slot as readonly [bigint, number, number, number];
    if (Number(decimals) !== m.token.decimals || symbol !== m.token.symbol) throw Error('Token metadata differs from the deployment. Trading is unavailable.');
    if (Boolean(sellsOpen) !== (blockNumber >= (opensAt as bigint))) throw Error('Hook views disagree at this block. Refresh before trading.');
    return { block: blockNumber, timestamp: block.timestamp, opensAt: opensAt as bigint, sellsOpen: sellsOpen as boolean,
      window: window as bigint, sqrtPrice, tick, lpFee, liquidity: liquidity as bigint, decimals: Number(decimals), symbol: String(symbol),
      totalSupply: totalSupply as bigint, ethBalance: ethBalance as bigint | undefined, tokenBalance: tokenBalance as bigint | undefined,
      secondsPerBlock: old && blockNumber > old.number ? Number(block.timestamp - old.timestamp) / Number(blockNumber - old.number) : 12,
      blockTimeSampled: !!old && blockNumber > old.number,
      fetchedAt: Date.now() };
  }
  async function windowEvents(state: Snapshot): Promise<WindowEvent[]> {
    if (state.opensAt === 0n || state.opensAt < state.window) return [];
    const initBlock = state.opensAt - state.window;
    const event = getAbiItem({ abi: hookAbi, name: 'WindowSet' });
    if (!event || event.type !== 'event') throw Error('WindowSet event ABI is missing.');
    const logs = await client.getLogs({ address: runtime.hook.address, event, args: { poolId: id }, fromBlock: initBlock, toBlock: initBlock });
    return logs.map(log => ({ blockNumber: log.blockNumber, transactionHash: log.transactionHash, opensAt: (log.args as { opensAt: bigint }).opensAt }));
  }
  async function quote(side: Side, amount: bigint, account: Address) {
    const result = await client.simulateContract({ address: protocol.quoter, abi: runtime.abis.quoter,
      functionName: 'quoteExactInputSingle', args: [{ poolKey: poolKey(runtime), zeroForOne: direction(runtime, side), exactAmount: amount, hookData: '0x' }], account });
    return (result.result as readonly [bigint, bigint])[0];
  }
  async function allowances(account: Address) {
    const [token, permit] = await Promise.all([
      client.readContract({ address: runtime.token.address, abi: tokenAbi, functionName: 'allowance', args: [account, protocol.permit2] }),
      client.readContract({ address: protocol.permit2, abi: runtime.abis.permit2, functionName: 'allowance', args: [account, runtime.token.address, protocol.universalRouter] }),
    ]);
    const [amount, expiration] = permit as readonly [bigint, number, number];
    return { token: token as bigint, permit: amount, expiration };
  }
  async function transact(kind: 'token' | 'permit' | 'swap', side: Side, amount: bigint, minimum: bigint, account: Address, onHash: (hash: Hex) => void, beforeSign: () => void) {
    if (!provider) throw Error('Connect a browser wallet to continue.');
    await assertWallet(provider, runtime, account);
    // Re-read contract state and deployment prerequisites immediately before every signature.
    await verify();
    const fresh = await snapshot(account);
    if (fresh.sqrtPrice === 0n || fresh.opensAt === 0n) throw Error('The launch pool has not initialized. Trading is unavailable.');
    if (side === 'sell' && !fresh.sellsOpen) throw Error(`Sells are locked until block ${fresh.opensAt}. Wait and refresh.`);
    const deadline = BigInt(Math.floor(Date.now() / 1000) + 300);
    const plan = kind === 'token' ? { address: runtime.token.address, abi: tokenAbi, functionName: 'approve', args: [protocol.permit2, amount], value: 0n }
      : kind === 'permit' ? { address: protocol.permit2, abi: runtime.abis.permit2, functionName: 'approve', args: [runtime.token.address, protocol.universalRouter, amount, Number(deadline) + 300], value: 0n }
      : swapPlan(runtime, side, amount, minimum, deadline);
    const simulated = await client.simulateContract({ ...plan, account });
    await assertWallet(provider, runtime, account);
    beforeSign();
    const wallet = createWalletClient({ account, chain: networkChain(runtime), transport: custom(provider) });
    const hash = await wallet.writeContract(simulated.request);
    onHash(hash);
    const receipt = await client.waitForTransactionReceipt({ hash, timeout: 180000 });
    if (receipt.status !== 'success') throw Error('The transaction reverted on-chain. Review its explorer receipt before trying again.');
    return hash;
  }
  return { client, verify, snapshot, windowEvents, quote, allowances, transact };
}
export type Service = ReturnType<typeof createService>;
