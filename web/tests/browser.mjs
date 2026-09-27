import { chromium, expect } from '@playwright/test';
import { createServer } from 'node:http';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, extname } from 'node:path';
import { decodeFunctionData, decodeAbiParameters, encodeFunctionResult, encodeAbiParameters, encodeEventTopics, encodeErrorResult, parseAbi, parseAbiParameters, toHex } from 'viem';
import { dist, root, json } from '../scripts/shared.mjs';

const manifest = await json(resolve(dist, 'imd-deployment.json'));
const abis = {};
for (const contract of manifest.contracts) abis[contract.name] = await json(resolve(dist, contract.abiPath));
for (const [name, path] of Object.entries(manifest.protocolAbis)) abis[name] = await json(resolve(dist, path));
const token = manifest.contracts.find(c => c.name === manifest.token.contract);
const hook = manifest.contracts.find(c => c.name === manifest.hook.contract);
const network = manifest.network.uniswapV4;
const account = '0x1111111111111111111111111111111111111111';
const hash = '0x' + 'ab'.repeat(32);
const eventHash = '0x' + 'cd'.repeat(32);
const errorAbi = parseAbi(['error SellsLocked(uint256 opensAt)']);
const contentTypes = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.json': 'application/json' };
const server = createServer(async (req, res) => {
  try {
    const pathname = new URL(req.url, 'http://localhost').pathname;
    if (!pathname.startsWith('/preview/')) { res.writeHead(404).end(); return; }
    const path = resolve(dist, pathname.slice('/preview/'.length) || 'index.html');
    if (!path.startsWith(dist + '/')) { res.writeHead(403).end(); return; }
    res.setHeader('Content-Type', contentTypes[extname(path)] ?? 'application/octet-stream');
    res.end(await readFile(path));
  } catch { res.writeHead(404).end(); }
});
await new Promise(resolve => server.listen(0, '0.0.0.0', resolve));
const url = `http://127.0.0.1:${server.address().port}/preview/`;
console.log(`Production export preview: ${url}`);
const browser = await chromium.launch({ headless: true, ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE } : {}) });
const results = [];
const screens = resolve(root, 'docs/evidence');
await mkdir(screens, { recursive: true });

function block(number, timestamp) {
  return { number: toHex(number), hash, parentHash: hash, nonce: '0x0000000000000000', sha3Uncles: hash,
    logsBloom: '0x' + '00'.repeat(256), transactionsRoot: hash, stateRoot: hash, receiptsRoot: hash,
    miner: account, difficulty: '0x0', totalDifficulty: '0x0', extraData: '0x', size: '0x200',
    gasLimit: '0x1c9c380', gasUsed: '0x0', timestamp: toHex(timestamp), transactions: [], uncles: [],
    baseFeePerGas: '0x3b9aca00', mixHash: hash, withdrawals: [] };
}

async function setup({ wallet = true, chain = manifest.chainId, locked = false, missing = false, rpcError = false, reject = false, tamperAbi = false, uninitialized = false, eventError = false, simulationError = false, holdRpc = false } = {}) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1080 } });
  const page = await context.newPage();
  await page.clock.install();
  const state = { block: BigInt(manifest.deploymentBlock + (locked ? 180 : 301)), opensAt: uninitialized ? 0n : BigInt(manifest.deploymentBlock + 300), rpcError, eventError, missing, simulationError, allowance: 0n, permit: 0n, expiration: 0, calls: [], transportRequests: [], requestErrors: [], consoleErrors: [] };
  const hold = holdRpc ? new Promise(resolve => state.release = resolve) : undefined;
  page.on('pageerror', error => state.consoleErrors.push(error.message));
  page.on('response', response => { if (response.url().startsWith(url) && response.status() >= 400) state.requestErrors.push(response.url()); });
  if (wallet) await page.addInitScript(({ account, chain, reject }) => {
    const listeners = {};
    window.mockWallet = { chain, account, connected: false, reject, unknown: true, requests: [], sent: [], emit: (event, args) => (listeners[event] ?? []).forEach(callback => callback(args)) };
    window.ethereum = {
      request: async ({ method, params }) => {
        const w = window.mockWallet;
        w.requests.push({ method, params });
        if (method === 'eth_accounts') return w.connected ? [w.account] : [];
        if (method === 'eth_requestAccounts') { if (w.reject) throw { code: 4001, message: 'User rejected the request' }; w.connected = true; return [w.account]; }
        if (method === 'eth_chainId') return '0x' + w.chain.toString(16);
        if (method === 'wallet_switchEthereumChain') {
          if (w.unknown) throw { code: 4902, message: 'Unknown chain' };
          w.chain = Number(params[0].chainId); w.emit('chainChanged', params[0].chainId); return null;
        }
        if (method === 'wallet_addEthereumChain') { w.unknown = false; return null; }
        if (method === 'eth_sendTransaction') {
          if (w.reject) throw { code: 4001, message: 'User rejected the transaction' };
          w.sent.push(params[0]); return '0x' + w.sent.length.toString(16).padStart(64, '0');
        }
        throw Error('Unexpected wallet method: ' + method);
      },
      on: (name, fn) => { (listeners[name] ??= []).push(fn); },
      removeListener: (name, fn) => { listeners[name] = (listeners[name] ?? []).filter(x => x !== fn); },
    };
  }, { account, chain, reject });

  async function rpc(request) {
    state.calls.push(request);
    if (hold) await hold;
    const { method, params = [] } = request;
    if (state.rpcError) return { error: { code: -32000, message: 'Fixture RPC unavailable' } };
    if (method === 'eth_chainId') return { result: toHex(manifest.chainId) };
    if (method === 'eth_getCode') return { result: state.missing ? '0x' : '0x6001600055' };
    if (method === 'eth_blockNumber') return { result: toHex(state.block) };
    if (method === 'eth_getBlockByNumber') {
      const number = params[0] === 'latest' ? state.block : BigInt(params[0]);
      return { result: block(number, BigInt(Math.floor(Date.now() / 1000)) - (state.block - number) * 12n) };
    }
    if (method === 'eth_getBalance') return { result: toHex(10n ** 19n) };
    if (method === 'eth_getLogs') {
      if (state.eventError) return { error: { code: -32000, message: 'Fixture event unavailable' } };
      if (state.opensAt === 0n) return { result: [] };
      const event = abis[hook.name].find(item => item.type === 'event' && item.name === 'WindowSet');
      return { result: [{ address: hook.address, topics: [encodeEventTopics({ abi: [event], eventName: 'WindowSet' })[0], params[0].topics[1]], data: encodeAbiParameters(parseAbiParameters('uint256'), [state.opensAt]), blockNumber: toHex(state.opensAt - 300n), blockHash: hash, transactionHash: eventHash, transactionIndex: '0x0', logIndex: '0x0', removed: false }] };
    }
    if (method === 'eth_getTransactionReceipt') {
      const index = Number(BigInt(params[0])) - 1;
      const sent = await page.evaluate(index => window.mockWallet.sent[index], index);
      if (!sent) return { result: null };
      const to = sent.to.toLowerCase();
      if (to === token.address) state.allowance = decodeFunctionData({ abi: abis[token.name], data: sent.data }).args[1];
      if (to === network.permit2) { const { args } = decodeFunctionData({ abi: abis.permit2, data: sent.data }); state.permit = args[2]; state.expiration = args[3]; }
      return { result: { transactionHash: params[0], transactionIndex: '0x0', blockHash: hash, blockNumber: toHex(state.block), from: account, to: sent.to, cumulativeGasUsed: '0x5208', gasUsed: '0x5208', contractAddress: null, logs: [], logsBloom: '0x' + '00'.repeat(256), status: '0x1', effectiveGasPrice: '0x3b9aca00', type: '0x2' } };
    }
    if (method === 'eth_call') {
      const tx = params[0]; const address = tx.to.toLowerCase();
      const abi = address === token.address ? abis[token.name] : address === hook.address ? abis[hook.name]
        : address === network.stateView ? abis.stateView : address === network.quoter ? abis.quoter
          : address === network.permit2 ? abis.permit2 : address === network.universalRouter ? abis.universalRouter : undefined;
      if (!abi) throw Error('Unexpected call address ' + address);
      const { functionName, args } = decodeFunctionData({ abi, data: tx.data });
      let result;
      if (functionName === 'poolManager') result = network.poolManager;
      else if (functionName === 'opensAt') result = state.opensAt;
      else if (functionName === 'sellsOpen') result = state.block >= state.opensAt;
      else if (functionName === 'WINDOW_BLOCKS') result = 300n;
      else if (functionName === 'getSlot0') result = [state.opensAt ? 1000n * 2n ** 96n : 0n, 138162, 0, 3000];
      else if (functionName === 'getLiquidity') result = 0n; // A boundary with zero active liquidity must still be quotable.
      else if (functionName === 'decimals') result = 18;
      else if (functionName === 'symbol') result = manifest.token.symbol;
      else if (functionName === 'totalSupply') result = 10n ** 27n;
      else if (functionName === 'balanceOf') result = 10000n * 10n ** 18n;
      else if (functionName === 'allowance') result = address === token.address ? state.allowance : [state.permit, state.expiration, 0];
      else if (functionName === 'approve') result = address === token.address ? true : undefined;
      else if (functionName === 'quoteExactInputSingle') {
        if (!args[0].zeroForOne && state.block < state.opensAt) return { error: { code: 3, message: 'SellsLocked', data: encodeErrorResult({ abi: errorAbi, errorName: 'SellsLocked', args: [state.opensAt] }) } };
        result = [args[0].zeroForOne ? args[0].exactAmount * 997000n : args[0].exactAmount / 1003000n, 150000n];
      } else if (functionName === 'execute') {
        if (state.simulationError) return { error: { code: 3, message: 'Fixture simulation reverted: slippage', data: '0x' } };
        result = undefined;
      } else throw Error('Unexpected function ' + functionName);
      return { result: encodeFunctionResult({ abi, functionName, result }) };
    }
    throw Error('Unexpected RPC method ' + method);
  }
  for (const endpoint of manifest.network.rpcUrls) await page.route(endpoint, async route => {
    try {
      const request = route.request().postDataJSON();
      state.transportRequests.push({ endpoint, request });
      const response = async item => ({ jsonrpc: '2.0', id: item.id, ...await rpc(item) });
      await route.fulfill({ contentType: 'application/json', body: JSON.stringify(Array.isArray(request) ? await Promise.all(request.map(response)) : await response(request)) });
    } catch (error) { state.requestErrors.push(error.message); await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ jsonrpc: '2.0', id: 1, error: { code: -32000, message: error.message } }) }); }
  });
  if (tamperAbi) await page.route('**/abi/OWLN.json', route => route.fulfill({ contentType: 'application/json', body: '[]' }));
  await page.goto(url);
  return { context, page, state, close: () => context.close() };
}
async function ready(page) { await expect(page.getByText(/Updated \d+s ago/)).toBeVisible({ timeout: 10000 }); }
async function connect(page) { await page.getByRole('button', { name: 'Connect wallet', exact: true }).click(); await expect(page.getByRole('button', { name: /^Disconnect wallet/ })).toBeVisible(); await ready(page); }
async function review(page, amount) { await page.getByLabel('You pay').fill(amount); await page.getByRole('button', { name: 'Review quote', exact: true }).click(); await expect(page.getByText('Minimum received', { exact: true })).toBeVisible(); }
async function sent(page) { return page.evaluate(() => window.mockWallet.sent); }
async function test(name, run) {
  const start = Date.now();
  try { await run(); results.push({ name, result: 'PASS', durationMs: Date.now() - start }); console.log('PASS ' + name); }
  catch (error) { results.push({ name, result: 'FAIL', error: error.message, durationMs: Date.now() - start }); console.error('FAIL ' + name + '\n' + error.stack); }
}

try {
  await test('Gateway subpath, disconnected live reads, event and responsive reflow', async () => {
    const s = await setup({ locked: true }); const { page, state } = s;
    try {
      await ready(page);
      await expect(page.getByRole('button', { name: 'Sell OWLN' })).toBeDisabled();
      await expect(page.getByText('120', { exact: true })).toBeVisible();
      await expect(page.getByText(/About 24 minutes remaining/)).toBeVisible();
      await expect(page.getByRole('link', { name: /Initialization at block/ })).toBeVisible();
      for (const width of [1440, 900, 768, 390, 320]) {
        await page.setViewportSize({ width, height: 1080 });
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
        await expect(page.getByRole('button', { name: 'Connect wallet to trade' })).toBeVisible();
        if ([1440, 390, 320].includes(width)) await page.screenshot({ path: resolve(screens, `mock-locked-${width}.png`), fullPage: true, animations: 'disabled' });
      }
      await page.setViewportSize({ width: 390, height: 844 });
      await page.evaluate(() => document.documentElement.style.fontSize = '200%');
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      expect(state.consoleErrors).toEqual([]); expect(state.requestErrors).toEqual([]);
    } finally { await s.close(); }
  });
  await test('Missing wallet and wallet rejection are visible and recoverable', async () => {
    const noWallet = await setup({ wallet: false });
    try { await ready(noWallet.page); await noWallet.page.getByRole('button', { name: 'Connect wallet', exact: true }).click(); await expect(noWallet.page.getByRole('alert').filter({ hasText: 'No browser wallet found' })).toBeVisible(); } finally { await noWallet.close(); }
    const s = await setup({ reject: true });
    try { await ready(s.page); await s.page.getByRole('button', { name: 'Connect wallet', exact: true }).click(); await expect(s.page.getByRole('alert').filter({ hasText: 'Request declined' })).toBeVisible(); expect(await sent(s.page)).toHaveLength(0); } finally { await s.close(); }
  });
  await test('Unknown chain: switch, exact wallet_addEthereumChain, switch again', async () => {
    const s = await setup({ chain: 1 });
    try {
      await ready(s.page); await connect(s.page);
      await expect(s.page.getByText('Your wallet is on another network.')).toBeVisible();
      await s.page.getByRole('button', { name: 'Switch to Sepolia' }).click();
      await expect(s.page.getByRole('button', { name: 'Review quote', exact: true })).toBeEnabled();
      const requests = await s.page.evaluate(() => window.mockWallet.requests.filter(r => r.method.startsWith('wallet_')));
      expect(requests.map(r => r.method)).toEqual(['wallet_switchEthereumChain', 'wallet_addEthereumChain', 'wallet_switchEthereumChain']);
      expect(requests[1].params).toEqual([manifest.walletAddChain]);
    } finally { await s.close(); }
  });
  await test('Locked buy: input validation, acknowledgement, simulation and native ETH send', async () => {
    const s = await setup({ locked: true });
    try {
      await ready(s.page); await connect(s.page);
      await s.page.getByLabel('You pay').fill('-1'); await s.page.getByRole('button', { name: 'Review quote', exact: true }).click();
      await expect(s.page.getByLabel('You pay')).toHaveAttribute('aria-invalid', 'true'); await expect(s.page.getByLabel('You pay')).toBeFocused();
      await review(s.page, '0.001');
      await expect(s.page.getByRole('button', { name: 'Confirm buy OWLN' })).toBeDisabled();
      await s.page.getByRole('checkbox').check(); await s.page.getByRole('button', { name: 'Confirm buy OWLN' }).click();
      await expect(s.page.getByText('Buy confirmed. Your balances are updating.')).toBeVisible({ timeout: 10000 });
      const transactions = await sent(s.page); expect(transactions).toHaveLength(1);
      expect(transactions[0].to.toLowerCase()).toBe(network.universalRouter); expect(BigInt(transactions[0].value)).toBe(10n ** 15n);
      const decoded = decodeFunctionData({ abi: abis.universalRouter, data: transactions[0].data });
      expect(decoded.functionName).toBe('execute'); expect(decoded.args[0]).toBe('0x10');
      expect(s.state.calls.some(c => c.method === 'eth_call' && c.params[0].to.toLowerCase() === network.universalRouter)).toBe(true);
      expect(transactions.some(t => t.to.toLowerCase() === network.permit2 || t.to.toLowerCase() === token.address)).toBe(false);
    } finally { await s.close(); }
  });
  await test('Sell: exact ERC20 approval, exact expiring Permit2 approval, then swap', async () => {
    const s = await setup();
    try {
      await ready(s.page); await connect(s.page); await s.page.getByRole('button', { name: 'Sell OWLN' }).click(); await review(s.page, '12.5');
      await s.page.getByRole('button', { name: '1. Approve OWLN' }).click();
      await expect(s.page.getByRole('button', { name: '2. Authorize router' })).toBeEnabled({ timeout: 10000 }); await s.page.getByRole('button', { name: '2. Authorize router' }).click();
      await expect(s.page.getByRole('button', { name: 'Confirm sell OWLN' })).toBeEnabled({ timeout: 10000 }); await s.page.getByRole('button', { name: 'Confirm sell OWLN' }).click();
      await expect(s.page.getByText('Sell confirmed. Your balances are updating.')).toBeVisible({ timeout: 10000 });
      const transactions = await sent(s.page); expect(transactions).toHaveLength(3);
      expect(transactions.map(t => t.to.toLowerCase())).toEqual([token.address, network.permit2, network.universalRouter]);
      const erc20 = decodeFunctionData({ abi: abis[token.name], data: transactions[0].data });
      expect(erc20.args[0].toLowerCase()).toBe(network.permit2); expect(erc20.args[1]).toBe(125n * 10n ** 17n);
      const permit = decodeFunctionData({ abi: abis.permit2, data: transactions[1].data });
      expect(permit.args[0].toLowerCase()).toBe(token.address); expect(permit.args[1].toLowerCase()).toBe(network.universalRouter); expect(permit.args[2]).toBe(125n * 10n ** 17n);
      expect(permit.args[3]).toBeGreaterThan(Date.now() / 1000); expect(permit.args[3]).toBeLessThanOrEqual(Date.now() / 1000 + 601);
      expect(BigInt(transactions[2].value ?? 0)).toBe(0n);
      const payload = decodeFunctionData({ abi: abis.universalRouter, data: transactions[2].data });
      const [, params] = decodeAbiParameters(parseAbiParameters('bytes,bytes[]'), payload.args[1][0]);
      const [output, minimum] = decodeAbiParameters(parseAbiParameters('address,uint256'), params[2]); expect(BigInt(output)).toBe(0n); expect(minimum).toBeGreaterThan(0n);
    } finally { await s.close(); }
  });
  await test('Sells become enabled at exactly opensAt and zero active liquidity does not mask a quote', async () => {
    const s = await setup({ locked: true });
    try {
      await ready(s.page); await connect(s.page); s.state.block = s.state.opensAt - 1n;
      await s.page.getByRole('button', { name: 'Refresh pool' }).click(); await expect(s.page.getByText('1', { exact: true })).toBeVisible(); await expect(s.page.getByRole('button', { name: 'Sell OWLN' })).toBeDisabled();
      s.state.block = s.state.opensAt; await s.page.getByRole('button', { name: 'Refresh pool' }).click(); await expect(s.page.getByRole('button', { name: 'Sell OWLN' })).toBeEnabled();
      await s.page.getByRole('button', { name: 'Sell OWLN' }).click(); await review(s.page, '1');
      await expect(s.page.getByText('Minimum received', { exact: true })).toBeVisible();
    } finally { await s.close(); }
  });
  await test('Quote invalidates on amount, slippage, account and chain changes; expired quotes cannot sign', async () => {
    const s = await setup();
    try {
      await ready(s.page); await connect(s.page); await review(s.page, '0.001');
      await s.page.getByLabel('You pay').fill('0.002'); await expect(s.page.getByRole('button', { name: 'Confirm buy OWLN' })).toHaveCount(0);
      await s.page.getByRole('button', { name: 'Review quote', exact: true }).click(); await expect(s.page.getByText('Minimum received', { exact: true })).toBeVisible();
      await s.page.getByLabel('Slippage tolerance').fill('1'); await expect(s.page.getByRole('button', { name: 'Confirm buy OWLN' })).toHaveCount(0);
      await s.page.getByRole('button', { name: 'Review quote', exact: true }).click(); await expect(s.page.getByText('Minimum received', { exact: true })).toBeVisible();
      await s.page.evaluate(() => { window.mockWallet.account = '0x2222222222222222222222222222222222222222'; window.mockWallet.emit('accountsChanged', [window.mockWallet.account]); });
      await expect(s.page.getByRole('button', { name: 'Confirm buy OWLN' })).toHaveCount(0); await ready(s.page);
      await review(s.page, '0.002'); await s.page.clock.fastForward(30000);
      await expect(s.page.getByText(/Updated 0s ago/)).toBeVisible();
      await s.page.clock.fastForward(16000);
      await expect(s.page.getByRole('button', { name: 'Confirm buy OWLN' })).toBeDisabled(); await expect(s.page.getByText('Expired — refresh below')).toBeVisible();
      await s.page.evaluate(() => { window.mockWallet.chain = 1; window.mockWallet.emit('chainChanged', '0x1'); });
      await expect(s.page.getByRole('button', { name: 'Confirm buy OWLN' })).toHaveCount(0); await expect(s.page.getByRole('button', { name: 'Switch to Sepolia' })).toBeVisible();
      expect(await sent(s.page)).toHaveLength(0);
    } finally { await s.close(); }
  });
  await test('Failed simulation and rejected signature never broadcast', async () => {
    const s = await setup({ simulationError: true });
    try {
      await ready(s.page); await connect(s.page); await review(s.page, '0.001'); await s.page.getByRole('button', { name: 'Confirm buy OWLN' }).click();
      await expect(s.page.locator('#trade-error')).not.toBeEmpty(); expect(await sent(s.page)).toHaveLength(0);
      s.state.simulationError = false; await s.page.evaluate(() => window.mockWallet.reject = true);
      await s.page.getByRole('button', { name: 'Confirm buy OWLN' }).click(); await expect(s.page.locator('#trade-error')).toContainText('Request declined'); expect(await sent(s.page)).toHaveLength(0);
    } finally { await s.close(); }
  });
  await test('Missing code, uninitialized pool, failed RPC and ABI tampering fail closed', async () => {
    for (const options of [{ missing: true }, { uninitialized: true }, { rpcError: true }, { tamperAbi: true }]) {
      const s = await setup(options);
      try {
        if (options.tamperAbi) { await expect(s.page.getByRole('alert')).toContainText('Asset hash mismatch'); await expect(s.page.getByRole('button', { name: 'Reload deployment' })).toBeVisible(); }
        else {
          await s.page.getByRole('button', { name: 'Connect wallet', exact: true }).click();
          await expect(s.page.getByRole('button', { name: /^Disconnect wallet/ })).toBeVisible();
          await expect(s.page.getByRole('button', { name: 'Refresh pool' })).toBeEnabled();
          await expect(s.page.getByRole('button', { name: 'Review quote', exact: true })).toBeDisabled();
          await expect(s.page.getByRole('button', { name: 'Sell OWLN' })).toBeDisabled();
          if (options.rpcError) { s.state.rpcError = false; await s.page.getByRole('button', { name: 'Refresh pool' }).click(); await ready(s.page); await expect(s.page.getByRole('button', { name: 'Review quote', exact: true })).toBeEnabled(); }
          expect(await sent(s.page)).toHaveLength(0);
        }
      } finally { await s.close(); }
    }
  });
  await test('Event failure is distinguished from absent events and can be retried', async () => {
    const s = await setup({ eventError: true });
    try { await ready(s.page); await expect(s.page.getByText(/Event history unavailable:/)).toBeVisible(); s.state.eventError = false; await s.page.getByRole('button', { name: 'Retry event' }).click(); await expect(s.page.getByRole('link', { name: /Initialization at block/ })).toBeVisible(); } finally { await s.close(); }
  });
  await test('Keyboard path, visible focus, reduced motion and measured rendered contrast', async () => {
    const s = await setup();
    try {
      await ready(s.page); await s.page.keyboard.press('Tab'); await expect(s.page.getByRole('link', { name: 'Skip to content' })).toBeFocused(); await s.page.keyboard.press('Enter');
      // Exercise native controls without pointer activation.
      await s.page.getByRole('button', { name: 'Connect wallet to trade' }).focus(); await s.page.keyboard.press('Enter'); await expect(s.page.getByRole('button', { name: /^Disconnect wallet/ })).toBeVisible();
      await s.page.getByLabel('You pay').focus(); await s.page.keyboard.type('0.001'); await s.page.keyboard.press('Tab'); await expect(s.page.getByLabel('Slippage tolerance')).toBeFocused();
      await s.page.keyboard.press('Tab'); await expect(s.page.getByRole('button', { name: 'Review quote', exact: true })).toBeFocused(); await s.page.keyboard.press('Enter'); await expect(s.page.getByText('Minimum received', { exact: true })).toBeVisible();
      await s.page.getByRole('button', { name: 'Confirm buy OWLN' }).focus(); await s.page.screenshot({ path: resolve(screens, 'mock-keyboard-focus.png'), fullPage: true, animations: 'disabled' });
      await s.page.emulateMedia({ reducedMotion: 'reduce' }); expect(await s.page.getByRole('button', { name: 'Confirm buy OWLN' }).evaluate(el => getComputedStyle(el).transitionDuration)).toBe('0s');
      const contrast = await s.page.evaluate(() => {
        const rgb = color => color.match(/[\d.]+/g).slice(0, 3).map(Number);
        const luminance = channels => channels.map(c => { c /= 255; return c <= .04045 ? c / 12.92 : ((c + .055) / 1.055) ** 2.4; }).reduce((sum, c, i) => sum + c * [.2126, .7152, .0722][i], 0);
        return ['.intro-copy', '.risk-note p', '.window-panel h2', '.estimate', '.form-hint', '.primary', '.quote-review', '.metrics p'].map(selector => {
          const element = document.querySelector(selector); const color = getComputedStyle(element).color; let parent = element; let background;
          while (parent) { background = getComputedStyle(parent).backgroundColor; if (background !== 'rgba(0, 0, 0, 0)') break; parent = parent.parentElement; }
          const values = [luminance(rgb(color)), luminance(rgb(background))].sort((a, b) => a - b);
          return { selector, color, background, ratio: Number(((values[1] + .05) / (values[0] + .05)).toFixed(2)) };
        });
      });
      for (const pair of contrast) expect(pair.ratio).toBeGreaterThanOrEqual(4.5);
      await writeFile(resolve(screens, 'contrast.json'), JSON.stringify(contrast, null, 2) + '\n');
      expect(s.state.consoleErrors).toEqual([]); expect(s.state.requestErrors).toEqual([]);
    } finally { await s.close(); }
  });
  await test('Slow RPC reads do not overlap polling cycles or suppress completed results', async () => {
    const s = await setup({ holdRpc: true, wallet: false });
    try {
      const firstEndpointReads = () => s.state.transportRequests.filter(c => c.endpoint === manifest.network.rpcUrls[0] && c.request.method === 'eth_chainId');
      await expect.poll(() => firstEndpointReads().length).toBe(1);
      await s.page.clock.fastForward(31000);
      expect(firstEndpointReads()).toHaveLength(1);
      s.state.release(); await ready(s.page);
      expect(s.state.consoleErrors).toEqual([]);
    } finally { s.state.release(); await s.close(); }
  });
} finally {
  await writeFile(resolve(screens, 'browser-results.json'), JSON.stringify({ executedAt: new Date().toISOString(), browser: await browser.version(), mode: 'Built production export under /preview/; mocked wallet and RPC; no broadcast', results }, null, 2) + '\n');
  await browser.close();
  await new Promise(resolve => server.close(resolve));
}
console.log(`${results.filter(r => r.result === 'PASS').length}/${results.length} browser scenarios passed`);
if (results.some(r => r.result === 'FAIL')) process.exitCode = 1;
