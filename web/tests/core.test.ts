import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { decodeAbiParameters, encodeAbiParameters, encodeErrorResult, parseAbi, parseAbiParameters, type Abi, type Address } from 'viem';
import { canonical, hashAbi, safePath, type Runtime, type Provider } from '../src/config.ts';
import { direction, explainError, minimumOut, parseAmount, poolId, remainingBlocks, slippageBps, swapPlan } from '../src/trade.ts';
import { assertWallet, switchNetwork } from '../src/wallet.ts';

const manifest = JSON.parse(readFileSync(new URL('../../dist/imd-deployment.json', import.meta.url), 'utf8'));
const abis: Record<string, Abi> = {};
for (const c of manifest.contracts) abis[c.name] = JSON.parse(readFileSync(new URL('../../dist/' + c.abiPath, import.meta.url), 'utf8'));
const runtime: Runtime = { manifest, abis, token: manifest.contracts[0], hook: manifest.contracts[1] };
const account = '0x1111111111111111111111111111111111111111' as Address;

test('pinned implementation ABI hashes match independently loaded files', () => {
  for (const c of manifest.contracts) assert.equal(hashAbi(abis[c.name]), c.abiHash);
  assert.deepEqual(canonical({ z: { b: 1, a: 2 }, a: [2, 1] }), { a: [2, 1], z: { a: 2, b: 1 } });
});
test('asset paths reject traversal and external origins', () => {
  for (const path of ['../abi.json', '/abi.json', 'https://bad.example/a', 'a/../b', 'a%2fb', './a']) assert.throws(() => safePath(path));
  assert.equal(safePath('abi/OWLN.json'), 'abi/OWLN.json');
});
test('pool ID matches live initialization event and exact ABI encoding', () => {
  assert.equal(poolId(runtime), '0x952f9be5d434ae962ee6744968896438fbb0b1cca96159fca56ec094ec0745ed');
  assert.equal(direction(runtime, 'buy'), true); assert.equal(direction(runtime, 'sell'), false);
});
test('amount parsing rejects zero, negative, exponent, dust precision, rounding and overflow', () => {
  assert.equal(parseAmount('0.000000000000000001', 18), 1n);
  assert.equal(parseAmount('123.123456', 6), 123123456n);
  for (const value of ['', '0', '-1', '1e3', 'NaN', '1,000', '0.0000001']) assert.throws(() => parseAmount(value, 6));
  assert.throws(() => parseAmount((2n ** 128n).toString(), 0));
});
test('slippage is integer basis points and minimum output rounds down', () => {
  assert.equal(slippageBps('0.5'), 50n); assert.equal(slippageBps('0.01'), 1n);
  assert.equal(minimumOut(10001n, 50n), 9950n);
  for (const value of ['0', '5.01', '-1', '1e0', '0.001']) assert.throws(() => slippageBps(value));
  assert.throws(() => minimumOut(1n, 50n));
});
test('window boundary is exact, including one block before, at, and after opensAt', () => {
  assert.equal(remainingBlocks(999n, 1000n), 1n);
  assert.equal(remainingBlocks(1000n, 1000n), 0n);
  assert.equal(remainingBlocks(1001n, 1000n), 0n);
});
test('buy and sell wire payloads enforce slippage, settle the input and take the output', () => {
  for (const side of ['buy', 'sell'] as const) {
    const plan = swapPlan(runtime, side, 10000n, 9950n, 123456789n);
    assert.equal(plan.address, manifest.network.uniswapV4.universalRouter);
    assert.equal(plan.value, side === 'buy' ? 10000n : 0n);
    assert.equal(plan.args[0], '0x10'); assert.equal(plan.args[2], 123456789n);
    const [actions, params] = decodeAbiParameters(parseAbiParameters('bytes,bytes[]'), plan.args[1][0]);
    assert.equal(actions, '0x060c0f'); assert.equal(params.length, 3);
    const [swap] = decodeAbiParameters(parseAbiParameters('((address currency0,address currency1,uint24 fee,int24 tickSpacing,address hooks) poolKey,bool zeroForOne,uint128 amountIn,uint128 amountOutMinimum,bytes hookData)'), params[0]);
    assert.equal(swap.poolKey.hooks.toLowerCase(), runtime.hook.address);
    assert.equal(swap.zeroForOne, side === 'buy'); assert.equal(swap.amountIn, 10000n); assert.equal(swap.amountOutMinimum, 9950n); assert.equal(swap.hookData, '0x');
    const [input, inputAmount] = decodeAbiParameters(parseAbiParameters('address,uint256'), params[1]);
    const [output, minimum] = decodeAbiParameters(parseAbiParameters('address,uint256'), params[2]);
    assert.equal(input.toLowerCase(), side === 'buy' ? manifest.pool.pairedCurrency : runtime.token.address);
    assert.equal(output.toLowerCase(), side === 'buy' ? runtime.token.address : manifest.pool.pairedCurrency);
    assert.equal(inputAmount, 10000n); assert.equal(minimum, 9950n);
    assert.equal(encodeAbiParameters(parseAbiParameters('address,uint256'), [input, inputAmount]), params[1]);
  }
});
test('unknown wallet chain is added with the supplied parameters, then switched', async () => {
  const calls: unknown[] = []; let first = true;
  const provider = { request: async (request: { method: string }) => { calls.push(request); if (request.method === 'wallet_switchEthereumChain' && first) { first = false; throw { code: 4902 }; } } } as unknown as Provider;
  await switchNetwork(provider, runtime);
  assert.deepEqual(calls, [{ method: 'wallet_switchEthereumChain', params: [{ chainId: manifest.walletAddChain.chainId }] }, { method: 'wallet_addEthereumChain', params: [manifest.walletAddChain] }, { method: 'wallet_switchEthereumChain', params: [{ chainId: manifest.walletAddChain.chainId }] }]);
});
test('user rejection never adds a network and account/chain drift prevents signing', async () => {
  let calls = 0;
  await assert.rejects(switchNetwork({ request: async () => { calls++; throw { code: 4001 }; } } as unknown as Provider, runtime));
  assert.equal(calls, 1);
  await assert.rejects(assertWallet({ request: async ({ method }: { method: string }) => method === 'eth_accounts' ? [account] : '0x1' } as unknown as Provider, runtime, account), /Switch your wallet/);
  await assert.rejects(assertWallet({ request: async ({ method }: { method: string }) => method === 'eth_accounts' ? [runtime.token.address] : manifest.walletAddChain.chainId } as unknown as Provider, runtime, account), /account changed/);
});
test('nested router and manager errors expose the sell opening block', () => {
  const abi = parseAbi(['error SellsLocked(uint256 opensAt)', 'error WrappedError(address target,bytes4 selector,bytes reason,bytes details)', 'error ExecutionFailed(uint256 commandIndex,bytes message)']);
  const locked = encodeErrorResult({ abi, errorName: 'SellsLocked', args: [1000n] });
  const wrapped = encodeErrorResult({ abi, errorName: 'WrappedError', args: [runtime.hook.address, '0x12345678', locked, '0x'] });
  const router = encodeErrorResult({ abi, errorName: 'ExecutionFailed', args: [0n, wrapped] });
  assert.match(explainError({ cause: { data: router } }), /locked until block 1000/);
  assert.match(explainError({ cause: { code: 4001 } }), /Nothing was submitted/);
});
