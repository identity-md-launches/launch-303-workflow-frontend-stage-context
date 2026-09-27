import { createPublicClient, custom, defineChain, fallback, http, isAddress, keccak256, toHex, type Abi, type Address, type EIP1193Provider } from 'viem';

export interface Manifest {
  version: number;
  launchId: string;
  chainId: number;
  sourceCommit: string;
  attestationHash: string;
  contracts: { name: string; address: Address; abiHash: string; abiPath: string }[];
  assets: { path: string; sha256: string }[];
  network: {
    chainId: number; name: string; testnet: boolean; rpcUrls: string[]; explorer: string;
    nativeCurrency: { name: string; symbol: string; decimals: number };
    faucets: string[];
    uniswapV4: Record<'poolManager' | 'universalRouter' | 'quoter' | 'stateView' | 'positionManager' | 'permit2', Address>;
  };
  walletAddChain: { chainId: `0x${string}`; chainName: string; rpcUrls: string[]; nativeCurrency: { name: string; symbol: string; decimals: number }; blockExplorerUrls: string[] };
  pool: { pairedCurrency: Address; fee: number; tickSpacing: number; initialPrice: string };
  token: { contract: string; name: string; symbol: string; decimals: number };
  hook: { contract: string };
  deploymentBlock: number;
  protocolAbis: Record<'stateView' | 'quoter' | 'universalRouter' | 'permit2', string>;
}
export interface Runtime { manifest: Manifest; abis: Record<string, Abi>; token: Manifest['contracts'][number]; hook: Manifest['contracts'][number] }
export type Provider = EIP1193Provider;
declare global { interface Window { ethereum?: Provider } }

export function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical((value as Record<string, unknown>)[key])]));
  return value;
}
export const hashAbi = (abi: Abi) => keccak256(toHex(JSON.stringify(canonical(abi)))).slice(2);
export function safePath(path: string) {
  if (!/^[a-zA-Z0-9_./-]+$/.test(path) || path.startsWith('/') || path.split('/').some(p => p === '..' || p === '.')) throw Error('Unsafe deployment asset path');
  return path;
}
async function fetchFile(path: string) {
  const response = await fetch(new URL(safePath(path), document.baseURI), { cache: 'no-cache', signal: AbortSignal.timeout(15000) });
  if (!response.ok) throw Error(`Cannot load ${path} (${response.status}). Reload or check the site export.`);
  return response.text();
}
export async function loadRuntime(): Promise<Runtime> {
  const m = JSON.parse(await fetchFile('imd-deployment.json')) as Manifest;
  if (m.version !== 1 || m.chainId !== m.network?.chainId || Number(m.walletAddChain?.chainId) !== m.chainId || !m.network.testnet) throw Error('Deployment network configuration is invalid. Trading is unavailable.');
  if (!m.network.rpcUrls.length || m.network.rpcUrls.some(url => new URL(url).protocol !== 'https:')) throw Error('Public RPC configuration is invalid.');
  if (JSON.stringify(m.walletAddChain.rpcUrls) !== JSON.stringify(m.network.rpcUrls) || m.walletAddChain.chainName !== m.network.name) throw Error('Wallet network configuration disagrees with deployment.');
  if (!/^[a-f0-9]{64}$/.test(m.attestationHash) || !/^[a-f0-9]{40}$/.test(m.sourceCommit)) throw Error('Deployment identifiers are invalid.');
  const token = m.contracts.find(c => c.name === m.token.contract);
  const hook = m.contracts.find(c => c.name === m.hook.contract);
  if (!token || !hook || m.contracts.some(c => !isAddress(c.address)) || Object.values(m.network.uniswapV4).some(a => !isAddress(a))) throw Error('Deployment addresses are invalid.');
  const files = [...m.contracts.map(c => [c.name, c.abiPath] as const), ...Object.entries(m.protocolAbis)];
  const abis: Record<string, Abi> = {};
  await Promise.all(files.map(async ([name, path]) => {
    const text = await fetchFile(path);
    const expected = m.assets.find(a => a.path === path)?.sha256;
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
    const actual = [...new Uint8Array(digest)].map(x => x.toString(16).padStart(2, '0')).join('');
    if (expected !== actual) throw Error(`Asset hash mismatch: ${name}. Trading is unavailable.`);
    const abi = JSON.parse(text) as Abi;
    if (!Array.isArray(abi)) throw Error(`Invalid ABI: ${name}`);
    const contract = m.contracts.find(c => c.name === name);
    if (contract && hashAbi(abi) !== contract.abiHash) throw Error(`Attested ABI mismatch: ${name}`);
    abis[name] = abi;
  }));
  return { manifest: m, abis, token, hook };
}
export function networkChain(runtime: Runtime) {
  const n = runtime.manifest.network;
  return defineChain({ id: n.chainId, name: n.name, nativeCurrency: n.nativeCurrency, testnet: n.testnet,
    rpcUrls: { default: { http: n.rpcUrls } }, blockExplorers: { default: { name: n.name + ' explorer', url: n.explorer } } });
}
export function publicClient(runtime: Runtime, provider?: Provider) {
  const transports = runtime.manifest.network.rpcUrls.map(url => http(url, { timeout: 6500, retryCount: 0, batch: false }));
  return createPublicClient({ chain: networkChain(runtime), transport: fallback([...transports, ...(provider ? [custom(provider, { retryCount: 0 })] : [])], { rank: false, retryCount: 0 }), pollingInterval: 12000 });
}
