import { decodeErrorResult, encodeAbiParameters, formatUnits, keccak256, parseAbi, parseAbiParameters, parseUnits, type Address, type Hex } from 'viem';
import type { Runtime } from './config.ts';

export type Side = 'buy' | 'sell';
export const poolKeyType = parseAbiParameters('(address currency0,address currency1,uint24 fee,int24 tickSpacing,address hooks)');
export function poolKey(runtime: Runtime) {
  const m = runtime.manifest;
  const currencies = [m.pool.pairedCurrency, runtime.token.address].sort((a, b) => BigInt(a) < BigInt(b) ? -1 : 1);
  return { currency0: currencies[0], currency1: currencies[1], fee: m.pool.fee, tickSpacing: m.pool.tickSpacing, hooks: runtime.hook.address };
}
export const poolId = (runtime: Runtime) => keccak256(encodeAbiParameters(poolKeyType, [poolKey(runtime)]));
export function direction(runtime: Runtime, side: Side) {
  const input = side === 'buy' ? runtime.manifest.pool.pairedCurrency : runtime.token.address;
  return input.toLowerCase() === poolKey(runtime).currency0.toLowerCase();
}
export function parseAmount(value: string, decimals: number) {
  if (!/^(?:\d+)(?:\.\d*)?$/.test(value.trim())) throw Error('Enter a positive amount using digits and a decimal point.');
  if ((value.split('.')[1]?.length ?? 0) > decimals) throw Error(`Use at most ${decimals} decimal places.`);
  const amount = parseUnits(value.trim(), decimals);
  if (amount <= 0n) throw Error('Enter an amount greater than zero.');
  if (amount >= 2n ** 128n) throw Error('This amount exceeds the router limit. Enter a smaller amount.');
  return amount;
}
export function slippageBps(value: string) {
  if (!/^\d+(\.\d{1,2})?$/.test(value)) throw Error('Use a slippage between 0.01% and 5%, with at most two decimal places.');
  const bps = Math.round(Number(value) * 100);
  if (bps < 1 || bps > 500) throw Error('Use a slippage between 0.01% and 5%.');
  return BigInt(bps);
}
export function minimumOut(out: bigint, bps: bigint) {
  if (out <= 0n || out >= 2n ** 128n || bps < 1n || bps > 500n) throw Error('No usable quote. Try a different amount.');
  const minimum = out * (10000n - bps) / 10000n;
  if (minimum === 0n) throw Error('This amount is too small to protect with slippage. Increase it.');
  return minimum;
}
export function swapPlan(runtime: Runtime, side: Side, amount: bigint, minimum: bigint, deadline: bigint) {
  const key = poolKey(runtime);
  const zeroForOne = direction(runtime, side);
  const input = zeroForOne ? key.currency0 : key.currency1;
  const output = zeroForOne ? key.currency1 : key.currency0;
  const params = [
    encodeAbiParameters(parseAbiParameters('((address currency0,address currency1,uint24 fee,int24 tickSpacing,address hooks) poolKey,bool zeroForOne,uint128 amountIn,uint128 amountOutMinimum,bytes hookData)'), [{ poolKey: key, zeroForOne, amountIn: amount, amountOutMinimum: minimum, hookData: '0x' }]),
    encodeAbiParameters(parseAbiParameters('address,uint256'), [input, amount]),
    encodeAbiParameters(parseAbiParameters('address,uint256'), [output, minimum]),
  ];
  return { address: runtime.manifest.network.uniswapV4.universalRouter, abi: runtime.abis.universalRouter,
    functionName: 'execute' as const, args: ['0x10', [encodeAbiParameters(parseAbiParameters('bytes,bytes[]'), ['0x060c0f', params])], deadline] as const,
    value: BigInt(input) === 0n ? amount : 0n };
}
export const amountText = (amount: bigint, decimals: number) => formatUnits(amount, decimals);
export function compactAmount(amount: bigint, decimals: number) {
  const n = Number(formatUnits(amount, decimals));
  if (n > 0 && n < 0.000001) return '<0.000001';
  return new Intl.NumberFormat('en-US', { maximumFractionDigits: 6 }).format(n);
}
export const shortAddress = (address: Address | Hex) => address.slice(0, 6) + '…' + address.slice(-4);
export function remainingBlocks(block: bigint, opensAt: bigint) { return opensAt > block ? opensAt - block : 0n; }

const errors = parseAbi(['error SellsLocked(uint256 opensAt)', 'error WrappedError(address target,bytes4 selector,bytes reason,bytes details)', 'error ExecutionFailed(uint256 commandIndex,bytes message)', 'error V4TooLittleReceived(uint256 minAmountOutReceived,uint256 amountReceived)']);
export function errorCode(error: unknown): number | undefined {
  if (!error || typeof error !== 'object') return;
  const e = error as { code?: number; cause?: unknown; data?: { originalError?: unknown } };
  return e.code ?? errorCode(e.cause) ?? errorCode(e.data?.originalError);
}
export function explainError(error: unknown): string {
  if (errorCode(error) === 4001) return 'Request declined in your wallet. Nothing was submitted. You can try again.';
  let current: unknown = error;
  for (let depth = 0; current && depth < 10; depth++) {
    const e = current as { data?: Hex | { errorName?: string; args?: unknown[] }; cause?: unknown };
    if (typeof e.data === 'string' && e.data.startsWith('0x')) {
      try {
        let decoded = decodeErrorResult({ abi: errors, data: e.data });
        for (let i = 0; i < 4; i++) {
          if (decoded.errorName === 'SellsLocked') return `Sells are locked until block ${decoded.args[0]}. Wait for the opening block and refresh.`;
          if (decoded.errorName === 'V4TooLittleReceived') return 'The price moved beyond your slippage limit. Refresh the quote and review it again.';
          const nested = decoded.errorName === 'WrappedError' ? decoded.args[2] : decoded.errorName === 'ExecutionFailed' ? decoded.args[1] : undefined;
          if (typeof nested !== 'string') break;
          decoded = decodeErrorResult({ abi: errors, data: nested as Hex });
        }
      } catch { /* fall through to the wallet or RPC error */ }
    }
    if (typeof e.data === 'object' && e.data.errorName === 'SellsLocked') return `Sells are locked until block ${e.data.args?.[0]}. Wait and refresh.`;
    current = e.cause;
  }
  if (error && typeof error === 'object' && 'shortMessage' in error) return `${String(error.shortMessage).slice(0, 550)} Refresh and try again.`;
  return error instanceof Error ? error.message.slice(0, 650) : 'Request failed. Check your wallet and connection, then try again.';
}
