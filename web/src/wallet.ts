import { isAddress, type Address } from 'viem';
import type { Provider, Runtime } from './config.ts';
import { errorCode } from './trade.ts';

export async function switchNetwork(provider: Provider, runtime: Runtime) {
  const chainId = runtime.manifest.walletAddChain.chainId;
  try { await provider.request({ method: 'wallet_switchEthereumChain', params: [{ chainId }] }); }
  catch (error) {
    if (errorCode(error) !== 4902 && !/unknown chain|unrecognized chain|chain.+not.+added/i.test(String((error as Error)?.message))) throw error;
    await provider.request({ method: 'wallet_addEthereumChain', params: [runtime.manifest.walletAddChain] });
    await provider.request({ method: 'wallet_switchEthereumChain', params: [{ chainId }] });
  }
}
export async function walletState(provider: Provider, request = false) {
  const accounts = await provider.request({ method: request ? 'eth_requestAccounts' : 'eth_accounts' });
  const chainId = Number(await provider.request({ method: 'eth_chainId' }));
  return { account: accounts[0] && isAddress(accounts[0]) ? accounts[0] as Address : undefined, chainId };
}
export async function assertWallet(provider: Provider, runtime: Runtime, account: Address) {
  const state = await walletState(provider);
  if (state.chainId !== runtime.manifest.chainId) throw Error(`Switch your wallet to ${runtime.manifest.network.name} and try again.`);
  if (state.account?.toLowerCase() !== account.toLowerCase()) throw Error('The wallet account changed. Review a new quote before continuing.');
}
