import { useEffect, useRef, useState } from 'react';
import type { Address, Hex } from 'viem';
import type { Runtime } from './config';
import type { Service, Snapshot } from './chain';
import { amountText, compactAmount, explainError, minimumOut, parseAmount, shortAddress, slippageBps, type Side } from './trade';

interface Props { runtime: Runtime; service: Service; account?: Address; correctChain: boolean; usable: boolean; state?: Snapshot; now: number; onRefresh: () => void; onConnect: () => void; onSwitch: () => void; walletBusy: boolean }
interface Quote { input: bigint; output: bigint; minimum: bigint; createdAt: number; tokenAllowance: bigint; permitAllowance: bigint; permitExpiration: number }

export function TradeForm({ runtime, service, account, correctChain, usable, state, now, onRefresh, onConnect, onSwitch, walletBusy }: Props) {
  const [side, setSide] = useState<Side>('buy');
  const [amount, setAmount] = useState('');
  const [slippage, setSlippage] = useState('0.5');
  const [quote, setQuote] = useState<Quote>();
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');
  const [fieldError, setFieldError] = useState<'amount' | 'slippage'>();
  const [txHash, setTxHash] = useState<Hex>();
  const [ack, setAck] = useState(false);
  const revision = useRef(0);
  const inFlight = useRef(false);
  const amountInput = useRef<HTMLInputElement>(null);
  const slipInput = useRef<HTMLInputElement>(null);
  const m = runtime.manifest;
  const symbol = state?.symbol ?? m.token.symbol;
  const inSymbol = side === 'buy' ? m.network.nativeCurrency.symbol : symbol;
  const outSymbol = side === 'buy' ? symbol : m.network.nativeCurrency.symbol;
  const inDecimals = side === 'buy' ? m.network.nativeCurrency.decimals : state?.decimals ?? m.token.decimals;
  const outDecimals = side === 'buy' ? state?.decimals ?? m.token.decimals : m.network.nativeCurrency.decimals;
  const locked = !state?.sellsOpen;
  const gate = !usable || !correctChain || !account || (side === 'sell' && locked);
  const expired = !!quote && now - quote.createdAt >= 45000;
  const needsToken = side === 'sell' && quote && quote.tokenAllowance < quote.input;
  const needsPermit = side === 'sell' && quote && (quote.permitAllowance < quote.input || quote.permitExpiration <= Math.floor(now / 1000) + 60);
  const approval = needsToken ? 'token' : needsPermit ? 'permit' : 'swap';
  const balance = side === 'buy' ? state?.ethBalance : state?.tokenBalance;

  useEffect(() => {
    revision.current++;
    setQuote(undefined); setError(''); setFieldError(undefined); setAck(false);
  }, [amount, slippage, side, account, correctChain, service, usable]);

  async function review(event: React.FormEvent) {
    event.preventDefault();
    if (inFlight.current || gate || !account) return;
    setError(''); setFieldError(undefined); setQuote(undefined); setAck(false);
    let input: bigint; let bps: bigint;
    try {
      input = parseAmount(amount, inDecimals);
      if (balance === undefined || input > balance || (side === 'buy' && input === balance)) throw Error(`Enter an amount within your ${inSymbol} balance${side === 'buy' ? ' and leave ETH for gas' : ''}.`);
    } catch (err) { setError(explainError(err)); setFieldError('amount'); amountInput.current?.focus(); return; }
    try { bps = slippageBps(slippage); }
    catch (err) { setError(explainError(err)); setFieldError('slippage'); slipInput.current?.focus(); return; }
    const request = ++revision.current;
    inFlight.current = true; setBusy(true); setStatus('Getting a quote from the pool…');
    try {
      const [output, allowances] = await Promise.all([service.quote(side, input, account), side === 'sell' ? service.allowances(account) : { token: 0n, permit: 0n, expiration: 0 }]);
      if (revision.current !== request) return;
      setQuote({ input, output, minimum: minimumOut(output, bps), createdAt: Date.now(), tokenAllowance: allowances.token, permitAllowance: allowances.permit, permitExpiration: allowances.expiration });
      setStatus('Quote ready. Review the minimum received before continuing.');
    } catch (err) { if (revision.current === request) { setError(explainError(err)); setStatus(''); } }
    finally { inFlight.current = false; setBusy(false); }
  }

  async function submit() {
    if (inFlight.current || gate || !quote || expired || !account || (side === 'buy' && locked && !ack)) return;
    const request = revision.current;
    let submitted: Hex | undefined;
    inFlight.current = true; setBusy(true); setError(''); setTxHash(undefined); setStatus('Checking the latest state and simulating this transaction…');
    try {
      await service.transact(approval, side, quote.input, quote.minimum, account,
        hash => { submitted = hash; setTxHash(hash); setStatus('Transaction submitted. Waiting for confirmation…'); },
        () => {
          if (revision.current !== request || Date.now() - quote.createdAt >= 45000) throw Error('The quote expired or the wallet changed. Review a new quote.');
          setStatus(approval === 'swap' ? `Confirm the ${side} in your wallet.` : 'Confirm this approval in your wallet.');
        });
      if (revision.current !== request) { setStatus('Transaction confirmed. Refresh the quote for the current account.'); return; }
      if (approval === 'swap') {
        setQuote(undefined); setAmount(''); setStatus(`${side === 'buy' ? 'Buy' : 'Sell'} confirmed. Your balances are updating.`);
      } else {
        const allowances = await service.allowances(account);
        if (revision.current === request) setQuote({ ...quote, tokenAllowance: allowances.token, permitAllowance: allowances.permit, permitExpiration: allowances.expiration });
        setStatus('Approval confirmed. Continue with the next step, or refresh if the quote expires.');
      }
      onRefresh();
    } catch (err) {
      setError(explainError(err));
      if (submitted) { setQuote(undefined); setStatus('A transaction was submitted. Check its explorer receipt before another trade.'); }
      else setStatus('');
    }
    finally { inFlight.current = false; setBusy(false); }
  }

  return <section className="trade-card" aria-labelledby="trade-title" id="trade">
    <div className="section-heading"><h2 id="trade-title">Trade the pool</h2><span className="small-tag">Uniswap v4</span></div>
    <div className="side-picker" role="group" aria-label="Trade direction">
      <button type="button" aria-pressed={side === 'buy'} disabled={busy} onClick={() => setSide('buy')}>Buy {symbol} <span aria-hidden="true">↗</span></button>
      <button type="button" aria-pressed={side === 'sell'} disabled={busy || locked || !usable} aria-describedby="sell-availability" onClick={() => setSide('sell')}>Sell {symbol} <span aria-hidden="true">↙</span></button>
    </div>
    <p id="sell-availability" className="form-hint">{!state ? 'Sell availability is checked on-chain.' : !usable ? 'Trading waits for a fresh, verified pool reading.' : locked ? `Sells unlock at block ${state.opensAt.toLocaleString()}.` : 'The fixed window has ended. Buys and sells are open.'}</p>
    <form onSubmit={review} noValidate>
      <div className="amount-box">
        <label htmlFor="amount">You pay</label>
        <div className="amount-row"><input id="amount" ref={amountInput} name="amount" inputMode="decimal" autoComplete="off" placeholder="0.00" value={amount} disabled={busy} onChange={e => setAmount(e.target.value)} aria-invalid={fieldError === 'amount'} aria-describedby={fieldError === 'amount' ? 'trade-error balance' : 'balance'} /><span className="currency"><span className={side === 'buy' ? 'coin eth' : 'coin'} aria-hidden="true">{side === 'buy' ? 'Ξ' : '↗'}</span>{inSymbol}</span></div>
        <p id="balance" className="form-hint">Balance: {balance === undefined ? 'connect wallet' : `${compactAmount(balance, inDecimals)} ${inSymbol}`}</p>
      </div>
      <div className="exchange-mark" aria-hidden="true">↓</div>
      <div className="receive-box"><span className="label">Estimated receive</span><div className="receive-value"><strong>{quote ? compactAmount(quote.output, outDecimals) : '—'}</strong><span>{outSymbol}</span></div><p className="form-hint">{quote ? `Exact quote: ${amountText(quote.output, outDecimals)} ${outSymbol}` : 'Enter an amount to get a live quote.'}</p></div>
      <div className="slippage-row"><label htmlFor="slippage">Slippage tolerance</label><div className="percent-input"><input ref={slipInput} id="slippage" name="slippage" inputMode="decimal" autoComplete="off" value={slippage} onChange={e => setSlippage(e.target.value)} disabled={busy} aria-invalid={fieldError === 'slippage'} aria-describedby={fieldError === 'slippage' ? 'trade-error' : 'slippage-hint'} /><span>%</span></div></div>
      <p id="slippage-hint" className="form-hint">0.01–5%. Your minimum received is enforced on-chain.</p>
      {quote && <div className="quote-review">
        <dl><div><dt>Minimum received</dt><dd>{amountText(quote.minimum, outDecimals)} {outSymbol}</dd></div><div><dt>Quote valid for</dt><dd>{expired ? 'Expired — refresh below' : `${Math.min(45, Math.max(0, Math.ceil((45000 - (now - quote.createdAt)) / 1000)))} seconds`}</dd></div><div><dt>Transaction deadline</dt><dd>5 minutes from confirmation request</dd></div></dl>
        {side === 'sell' && <ol className="approval-steps"><li>Approve exactly {amountText(quote.input, inDecimals)} {symbol} for Permit2 {needsToken ? '' : '✓'}</li><li>Authorize UniversalRouter for that amount, for up to 10 minutes {needsPermit ? '' : '✓'}</li><li>Confirm the sell</li></ol>}
        {side === 'buy' && locked && <label className="ack"><input type="checkbox" checked={ack} disabled={busy} onChange={e => setAck(e.target.checked)} />I understand that I cannot sell through this pool before the opening block.</label>}
      </div>}
      <div role="alert" id="trade-error" className={error ? 'error-box' : 'empty-message'}>{error}</div>
      {!account ? <button className="primary" type="button" onClick={onConnect} disabled={walletBusy}>{walletBusy ? 'Connecting…' : 'Connect wallet to trade'} <span aria-hidden="true">↗</span></button>
        : !correctChain ? <button className="primary" type="button" onClick={onSwitch} disabled={walletBusy}>{walletBusy ? 'Switching network…' : `Switch to ${m.network.name}`}</button>
        : <><button className={quote && !expired ? 'secondary full-width' : 'primary'} type="submit" disabled={gate || busy}>{busy ? 'Transaction in progress…' : quote ? 'Refresh quote' : 'Review quote'}{!busy && <span aria-hidden="true">↗</span>}</button>
          {quote && <button className="primary confirm" type="button" onClick={submit} disabled={busy || gate || expired || (side === 'buy' && locked && !ack)}>{busy ? 'Waiting for confirmation…' : approval === 'token' ? `1. Approve ${symbol}` : approval === 'permit' ? '2. Authorize router' : `Confirm ${side} ${symbol}`}</button>}</>}
    </form>
    <p className="transaction-status" role="status">{status}</p>
    {txHash && <a className="transaction-link" href={`${m.network.explorer}/tx/${txHash}`} target="_blank" rel="noreferrer">View transaction {shortAddress(txHash)} ↗</a>}
    <p className="trade-note">Sepolia test assets only. Network gas fees apply.<br />Quotes include the pool fee. The hook charges no fee.</p>
  </section>;
}
