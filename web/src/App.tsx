import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Address } from 'viem';
import { createService, type Snapshot, type WindowEvent } from './chain';
import { loadRuntime, type Runtime } from './config';
import { compactAmount, explainError, poolId, remainingBlocks, shortAddress } from './trade';
import { switchNetwork, walletState } from './wallet';
import { TradeForm } from './TradeForm';

function Arrow({ className = '' }: { className?: string }) { return <svg className={className} aria-hidden="true" viewBox="0 0 32 32" fill="none"><path d="M6 16h20M17 7l9 9-9 9" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>; }
function ContractLink({ runtime, address, children }: { runtime: Runtime; address: Address; children: React.ReactNode }) {
  return <a href={`${runtime.manifest.network.explorer}/address/${address}`} target="_blank" rel="noreferrer">{children} <span aria-hidden="true">↗</span></a>;
}

export default function App() {
  const [runtime, setRuntime] = useState<Runtime>();
  const [error, setError] = useState('');
  useEffect(() => { loadRuntime().then(setRuntime).catch(error => setError(explainError(error))); }, []);
  if (!runtime) return <main className="startup"><span className="brand-mark"><Arrow /></span><h1>Oneway Launch</h1><p role={error ? 'alert' : 'status'}>{error || 'Loading deployment and checking contract interfaces…'}</p>{error && <button className="secondary" onClick={() => location.reload()}>Reload deployment</button>}</main>;
  return <Launch runtime={runtime} />;
}

function Launch({ runtime }: { runtime: Runtime }) {
  const [account, setAccount] = useState<Address>();
  const [walletChain, setWalletChain] = useState<number>();
  const [walletBusy, setWalletBusy] = useState(false);
  const [walletError, setWalletError] = useState('');
  const [state, setState] = useState<Snapshot>();
  const [events, setEvents] = useState<WindowEvent[]>([]);
  const [eventError, setEventError] = useState('');
  const [eventsLoading, setEventsLoading] = useState(true);
  const [readError, setReadError] = useState('');
  const [reading, setReading] = useState(true);
  const [verified, setVerified] = useState(false);
  const [now, setNow] = useState(Date.now());
  const [eventRetry, setEventRetry] = useState(0);
  const request = useRef(0);
  const readingService = useRef<ReturnType<typeof createService> | undefined>(undefined);
  const manualDisconnect = useRef(false);
  const m = runtime.manifest;
  const provider = window.ethereum;
  const correctChain = walletChain === m.chainId;
  const fallbackProvider = correctChain && account ? provider : undefined;
  const service = useMemo(() => createService(runtime, fallbackProvider), [runtime, fallbackProvider, account]);
  const refresh = useCallback(async () => {
    if (readingService.current === service) return;
    readingService.current = service;
    const version = ++request.current;
    setReading(true);
    try {
      const [, next] = await Promise.all([service.verify(), service.snapshot(account)]);
      if (request.current === version) { setState(next); setReadError(''); setVerified(true); }
    } catch (error) { if (request.current === version) { setReadError(explainError(error)); setVerified(false); } }
    finally {
      if (readingService.current === service) readingService.current = undefined;
      if (request.current === version) setReading(false);
    }
  }, [service, account]);
  useEffect(() => {
    let active = true;
    let timer: ReturnType<typeof setTimeout>;
    // Wait for a read to finish before polling again. Slow fallback RPCs must not
    // continually invalidate one another, and a new account must get fresh balances.
    setVerified(false); setState(undefined);
    const poll = async () => { await refresh(); if (active) timer = setTimeout(poll, 15000); };
    poll();
    return () => { active = false; clearTimeout(timer); request.current++; };
  }, [refresh]);
  useEffect(() => { const timer = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(timer); }, []);
  useEffect(() => {
    if (!provider) return;
    let active = true;
    const update = () => walletState(provider).then(s => { if (active) { setAccount(manualDisconnect.current ? undefined : s.account); setWalletChain(s.chainId); } }).catch(() => { if (active) { setAccount(undefined); setWalletChain(undefined); } });
    const disconnect = () => { setAccount(undefined); setWalletChain(undefined); };
    update(); provider.on('accountsChanged', update); provider.on('chainChanged', update); provider.on('disconnect', disconnect);
    return () => { active = false; provider.removeListener('accountsChanged', update); provider.removeListener('chainChanged', update); provider.removeListener('disconnect', disconnect); };
  }, [provider]);
  useEffect(() => {
    let active = true;
    if (!state) return;
    setEventsLoading(true); setEventError(''); setEvents([]);
    service.windowEvents(state).then(events => { if (active) setEvents(events); }).catch(error => { if (active) setEventError(explainError(error)); }).finally(() => { if (active) setEventsLoading(false); });
    return () => { active = false; };
  // Only the initialization parameters change which event block to read.
  }, [service, state?.opensAt, state?.window, eventRetry]);

  async function connect() {
    if (walletBusy) return;
    setWalletError('');
    if (!provider) { setWalletError('No browser wallet found. Install or open an Ethereum browser wallet, then reload this page. Public pool readings still work.'); return; }
    setWalletBusy(true);
    try { manualDisconnect.current = false; const s = await walletState(provider, true); setAccount(s.account); setWalletChain(s.chainId); if (!s.account) throw Error('Your wallet shared no account. Open it and try connecting again.'); }
    catch (error) { setWalletError(explainError(error)); }
    finally { setWalletBusy(false); }
  }
  async function switchChain() {
    if (!provider || walletBusy) return;
    setWalletBusy(true); setWalletError('');
    try { await switchNetwork(provider, runtime); const s = await walletState(provider); setWalletChain(s.chainId); setAccount(s.account); }
    catch (error) { setWalletError(explainError(error)); }
    finally { setWalletBusy(false); }
  }
  const stale = !!state && (now - state.fetchedAt > 45000 || now / 1000 - Number(state.timestamp) > 1800);
  const initialized = !!state && state.sqrtPrice > 0n && state.opensAt > 0n;
  const usable = verified && !!state && !stale && !readError && initialized;
  const remaining = state ? remainingBlocks(state.block, state.opensAt) : undefined;
  const progress = state && initialized ? Math.min(100, Math.max(0, 100 - Number(remaining) / Number(state.window) * 100)) : 0;
  const isOpen = usable && state?.sellsOpen;
  const price = state?.sqrtPrice ? (Number(state.sqrtPrice) / 2 ** 96) ** 2 * 10 ** (m.network.nativeCurrency.decimals - state.decimals) : undefined;
  const statusText = !state ? 'Checking the pool' : !usable ? 'Pool reading unavailable' : isOpen ? 'Two-way trading open' : 'Buy-only window';
  const id = poolId(runtime);

  return <>
    <a className="skip-link" href="#main">Skip to content</a>
    <header className="site-header shell">
      <a className="brand" href="#main" aria-label="Oneway Launch home"><span className="brand-mark"><Arrow /></span><span>oneway<span className="brand-suffix"> / launch</span></span></a>
      <nav aria-label="Page sections"><a href="#pool">The pool</a><a href="#about">How it works</a></nav>
      <div className="wallet-area"><span className="network-label"><span className="status-dot" />{m.network.name} testnet</span>{account ? <button className="wallet-button" title={account} onClick={() => { manualDisconnect.current = true; setAccount(undefined); }} aria-label={`Disconnect wallet ${account}`}>{shortAddress(account)} <span aria-hidden="true">×</span></button> : <button className="wallet-button" onClick={connect} disabled={walletBusy}>{walletBusy ? 'Connecting…' : 'Connect wallet'} <span aria-hidden="true">↗</span></button>}</div>
    </header>
    <main id="main" className="shell">
      <div className="intro"><div><p className="eyebrow">An experiment in launch-time trading</p><h1>Oneway Launch<span className="title-dot">.</span></h1><p className="intro-copy">One fixed window. All of it on-chain.</p></div><div className="pair-label"><span className="pair-coins" aria-hidden="true"><span>↗</span><span>Ξ</span></span><div><strong>{m.token.symbol} / ETH</strong><span>Uniswap v4 · {m.pool.fee / 10000}% pool fee</span></div></div></div>
      <div className={walletError ? 'error-box wallet-error' : 'empty-message'} role="alert">{walletError}</div>
      {account && !correctChain && <div className="notice"><strong>Your wallet is on another network.</strong><span>Switch to {m.network.name} using the trade panel to continue.</span></div>}
      <div className={readError || stale ? 'error-box read-error' : 'empty-message'} role="alert">{readError || (stale ? 'The pool reading is stale. Trading is paused until fresh data arrives. Use Refresh pool to retry.' : '')}</div>
      <div className="main-grid">
        <div className="pool-column" id="pool">
          <section className="window-panel" aria-labelledby="window-title">
            <div className="section-heading"><p className="eyebrow" id="window-title">The launch window</p><span className={`status-pill ${isOpen ? 'open' : ''}`}><span className="status-dot" />{statusText}</span></div>
            <h2>{isOpen ? 'The window is complete.' : 'Every block brings it closer.'}</h2>
            <div className="countdown"><strong>{usable ? remaining?.toLocaleString() : '—'}</strong><span>blocks<br />{isOpen ? 'remaining' : 'until sells open'}</span><Arrow className="countdown-arrow" /></div>
            <p className="estimate">{usable && remaining !== undefined ? isOpen ? 'The hook now allows swaps in both directions.' : `About ${Math.ceil(Number(remaining) * state!.secondsPerBlock / 60)} minutes remaining · ${state!.blockTimeSampled ? 'estimated from recent blocks' : 'using a 12-second block estimate'}` : 'Waiting for a verified on-chain reading. No estimated state is substituted.'}</p>
            <div className="window-progress" role="progressbar" aria-label="Buy-only window elapsed" aria-valuemin={0} aria-valuemax={100} aria-valuenow={usable ? Math.round(progress) : undefined} aria-valuetext={usable ? `${remaining} blocks remaining` : 'Unknown'}>{Array.from({ length: 30 }, (_, i) => <span key={i} className={usable && progress >= (i + 1) / 30 * 100 ? 'elapsed' : ''} />)}</div>
            <div className="timeline-labels"><span>Pool initialized</span><span>{state?.window.toString() ?? '300'} blocks</span><span>Both ways open</span></div>
            <div className="window-facts"><div><span>Current block</span><strong>{state?.block.toLocaleString() ?? '—'}</strong></div><div><span>Sells open at</span><strong>{initialized ? state?.opensAt.toLocaleString() : '—'}</strong></div><div><span>Window rules</span><strong>Fixed. No admin.</strong></div></div>
          </section>
          <section className="metrics" aria-label="Pool readings"><div><p>Pool price <span className="small-tag">Spot</span></p><strong>{price ? new Intl.NumberFormat('en-US', { maximumSignificantDigits: 7 }).format(price) : '—'}</strong><span>{m.token.symbol} per ETH</span></div><div><p>Hook fee</p><strong>0<span>%</span></strong><span>Both directions</span></div><div><p>Total supply</p><strong>{state ? compactAmount(state.totalSupply, state.decimals) : '—'}</strong><span>{m.token.symbol} · fixed supply</span></div></section>
          <div className="read-status"><span><span className={`status-dot ${usable ? 'live' : ''}`} />{reading ? 'Refreshing pool…' : usable ? `Updated ${Math.max(0, Math.floor((now - state!.fetchedAt) / 1000))}s ago · RPC reading` : 'Live readings unavailable'}</span><button type="button" className="text-button" disabled={reading} onClick={() => { refresh(); setEventRetry(v => v + 1); }}>Refresh pool <span aria-hidden="true">↻</span></button></div>
          <aside className="risk-note"><span className="note-symbol" aria-hidden="true">!</span><div><strong>Know the window before you buy.</strong><p>Blocking sells is the mechanism honeypots use. Here, it is a disclosed, fixed 300-block test (about an hour on Sepolia), visible on-chain before buying. Sells through this pool are blocked until the opening block. Liquidity can be removed at any time.</p></div></aside>
        </div>
        <TradeForm runtime={runtime} service={service} account={account} correctChain={correctChain} usable={usable} state={state} now={now} onRefresh={refresh} onConnect={connect} onSwitch={switchChain} walletBusy={walletBusy} />
      </div>
      <section className="how-section" id="about" aria-labelledby="how-title"><div className="section-heading"><div><p className="eyebrow">Simple rules, visible state</p><h2 id="how-title">How the window works</h2></div><span className="small-tag">No owner. No reset.</span></div><div className="how-grid"><article><span className="step-number">01</span><h3>The pool opens</h3><p>Initialization starts a 300-block window for this ETH pool. The opening block is recorded by the hook.</p></article><article><span className="step-number">02</span><h3>Buys go one way</h3><p>You can swap ETH for OWLN. OWLN-to-ETH swaps revert while the current block is below the opening block.</p></article><article><span className="step-number">03</span><h3>Both directions unlock</h3><p>At the opening block, sells become possible. No admin can shorten, extend, pause, or restart this window.</p></article></div></section>
      <section className="evidence-section" aria-labelledby="evidence-title"><div className="section-heading"><h2 id="evidence-title">Follow the on-chain evidence</h2><span className="small-tag">Read it yourself</span></div><div className="evidence-grid"><div className="event-panel"><h3>WindowSet event</h3>{eventsLoading ? <p>Reading the pool’s initialization event…</p> : eventError ? <><p role="alert">Event history unavailable: {eventError}</p><button className="secondary" onClick={() => setEventRetry(v => v + 1)}>Retry event</button></> : events.length ? events.map(event => <div key={event.transactionHash}><p>The hook set the opening block to <strong>{event.opensAt.toLocaleString()}</strong>.</p><a href={`${m.network.explorer}/tx/${event.transactionHash}`} target="_blank" rel="noreferrer">Initialization at block {event.blockNumber.toLocaleString()} ↗</a></div>) : <p>No WindowSet event was returned for this pool. Refresh to retry; this is not proof that trading is available.</p>}<p className="form-hint">The countdown uses the hook’s views. The price comes from StateView, not a trading quote.</p></div><div className="contract-panel"><h3>Deployed contracts</h3>{m.contracts.map(c => <div className="contract-row" key={c.name}><ContractLink runtime={runtime} address={c.address}>{c.name}</ContractLink><code>{c.address}</code></div>)}<div className="protocol-links">{(['poolManager', 'stateView', 'quoter', 'universalRouter', 'permit2', 'positionManager'] as const).map(name => <ContractLink key={name} runtime={runtime} address={m.network.uniswapV4[name]}>{({ poolManager: 'PoolManager', stateView: 'StateView', quoter: 'Quoter', universalRouter: 'UniversalRouter', permit2: 'Permit2', positionManager: 'PositionManager' })[name]}</ContractLink>)}</div></div></div>
      <details className="deployment-details"><summary>Pool details and deployment record</summary><dl><div><dt>Pool ID</dt><dd><code>{id}</code></dd></div><div><dt>Fee / tick spacing</dt><dd>{m.pool.fee} / {m.pool.tickSpacing}</dd></div><div><dt>Current tick / active liquidity</dt><dd>{state ? `${state.tick} / ${state.liquidity}` : 'Unavailable'}</dd></div><div><dt>Source commit</dt><dd><code>{m.sourceCommit}</code></dd></div><div><dt>Attestation hash</dt><dd><code>{m.attestationHash}</code></dd></div><div><dt>Launch ID</dt><dd><code>{m.launchId}</code></dd></div>{account && <div><dt>Connected account</dt><dd><code>{account}</code></dd></div>}<div><dt>Deployment file</dt><dd><a href="./imd-deployment.json" target="_blank" rel="noreferrer">Open configuration and asset hashes ↗</a></dd></div></dl><p className="form-hint">The interface checks ABI hashes, chain ID, contract code presence, and PoolManager bindings. These checks are not an independent contract audit. An open sell window does not guarantee liquidity or an executable trade.</p></details></section>
    </main>
    <footer className="site-footer shell"><span>oneway / <span>an on-chain experiment</span></span><div><a href={m.network.faucets[0]} target="_blank" rel="noreferrer">Get Sepolia ETH ↗</a><span>Testnet only · {m.network.name}</span></div></footer>
  </>;
}
