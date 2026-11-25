import React from 'react';
import {Audio, Easing, interpolate, staticFile, useCurrentFrame} from 'remotion';

const clamp = {extrapolateLeft: 'clamp' as const, extrapolateRight: 'clamp' as const};
const ease = Easing.bezier(0.18, 0.78, 0.22, 1);

const quote = '0.002896051759349126';
const intentHash = '0x755159c05cc1a6931aee7b7bfda84ac46439f8c96ceb36f0de7d662952eb6449';
const transactionHash = '0x0efe967e2ac27850996a28e5e12cde243ebc2503a0be2f9812e1481c002fe113';
const wallet = '0x70997970c51812dc3a010c7d01b50e0d17dc79c8';

type Stage = 0 | 1 | 2 | 3 | 4 | 5;

const stages: {from: number; duration: number; id: string; title: string; note: string}[] = [
  {from: 0, duration: 120, id: '01', title: 'Product overview', note: 'Wallet session is local to the E2E harness.'},
  {from: 120, duration: 150, id: '02', title: 'Wallet authentication', note: 'One-time nonce verified · local Anvil test account.'},
  {from: 270, duration: 180, id: '03', title: 'Quote generation', note: 'Quote uses the harness seeded simulated reference observation.'},
  {from: 450, duration: 150, id: '04', title: 'Unsigned intent', note: 'Intent prepared for review · no server-side signing.'},
  {from: 600, duration: 150, id: '05', title: 'Test wallet submission', note: 'Playwright injected wallet submitted to disposable Anvil.'},
  {from: 750, duration: 150, id: '06', title: 'Verified local activity', note: 'Receipt and portfolio reflected on the local chain.'},
];

function reveal(frame: number, start: number, length = 20): number {
  return interpolate(frame, [start, start + length], [0, 1], {...clamp, easing: ease});
}

function shortHash(value: string): string {
  return `${value.slice(0, 10)}…${value.slice(-8)}`;
}

const Mark: React.FC = () => <img className="brand-mark" src={staticFile('kyrox-mark.svg')} />;

const Pill: React.FC<{children: React.ReactNode; kind?: 'mint' | 'amber' | 'quiet' | 'done'}> = ({children, kind = 'quiet'}) => (
  <span className={`pill pill-${kind}`}><i className="pill-dot" />{children}</span>
);

const PanelHeader: React.FC<{eyebrow: string; title: string; trailing?: React.ReactNode}> = ({eyebrow, title, trailing}) => (
  <div className="panel-header">
    <div><div className="eyebrow">{eyebrow}</div><h2>{title}</h2></div>
    {trailing}
  </div>
);

export const KyroxShowcase: React.FC = () => {
  const frame = useCurrentFrame();
  const stage = (stages.filter((item) => frame >= item.from).at(-1)?.id ?? '01') as string;
  const stageIndex = Number(stage) - 1 as Stage;
  const local = frame - stages[stageIndex].from;
  const tick = interpolate(frame % 48, [0, 24, 48], [0.45, 0.9, 0.45]);
  const quoteProgress = reveal(frame - 270, 34, 28);
  const intentProgress = reveal(frame - 450, 24, 24);
  const submitProgress = reveal(frame - 600, 28, 22);
  const verifyProgress = reveal(frame - 750, 18, 26);
  const activeTitle = stages[stageIndex].title;
  const activeNote = stages[stageIndex].note;

  return (
    <main className="canvas">
      <Audio src={staticFile('showcase-score.wav')} volume={1} />
      <div className="ambient ambient-one" />
      <div className="ambient ambient-two" />
      <div className="grid-glass" />

      <div className="dashboard">
        <header className="topbar">
          <div className="brand-lockup"><Mark /><div><div className="wordmark">KYROX</div><div className="brand-caption">CONSUMER · TESTNET PROTOTYPE</div></div></div>
          <div className="topbar-right"><Pill kind="amber">LOCAL ANVIL · SIMULATED</Pill><span className="menu-mark">•••</span></div>
        </header>

        <div className="environment-rail">
          <span className="rail-led" style={{opacity: tick}} />
          <span>DISPOSABLE LOCAL CHAIN</span><b>·</b><span>BASE SEPOLIA CONTRACTS: NOT DEPLOYED</span>
        </div>

        <section className="hero-row">
          <div><div className="eyebrow">PORTFOLIO</div><h1>Testnet workspace</h1><p>Review a simulated reference-price flow from quote to verified local activity.</p></div>
          <div className="session-chip"><span className={`session-dot ${stageIndex > 0 ? 'is-on' : ''}`} /><div><b>{stageIndex > 0 ? 'Session active' : 'Wallet session'}</b><small>{stageIndex > 0 ? `TEST ACCOUNT · ${wallet.slice(0, 6)}…${wallet.slice(-4)}` : 'Awaiting test login'}</small></div></div>
        </section>

        <div className="scene-rail">
          <div className="scene-count">{stage} <span>/ 06</span></div>
          <div className="scene-progress">{stages.map((item, index) => <i key={item.id} className={index <= stageIndex ? 'filled' : ''} />)}</div>
          <div className="scene-title">{activeTitle}</div>
        </div>

        <section className="overview-grid">
          <article className="panel balances-panel">
            <PanelHeader eyebrow="ACCOUNT" title="Balances" trailing={<Pill kind={stageIndex >= 5 ? 'done' : 'quiet'}>{stageIndex >= 5 ? 'LOCAL STATE' : 'TEST ACCOUNT'}</Pill>} />
            <div className="balance-row"><div><span>tUSDC</span><small>test settlement token</small></div><strong className="balance-placeholder">{stageIndex > 0 ? 'Faucet claimed' : '—'}</strong></div>
            <div className="balance-row stock-balance"><div><span>tAAPL</span><small>Test Apple · local fixture</small></div><strong style={{opacity: stageIndex >= 5 ? verifyProgress : 1}}>{stageIndex >= 5 ? quote : '—'}</strong></div>
            <div className="panel-foot"><span className="mini-led" />Balances and trades exist only on disposable Anvil.</div>
          </article>

          <article className="panel reference-panel">
            <PanelHeader eyebrow="PRICE SOURCE" title="Reference" trailing={<Pill kind="amber">SIMULATED</Pill>} />
            <div className="reference-symbol"><span className="asset-glyph">A</span><div><b>tAAPL</b><small>Test Apple</small></div></div>
            <div className="reference-value"><strong>345.297696</strong><span>tUSDC</span></div>
            <div className="reference-rule"><i style={{width: `${Math.max(12, quoteProgress * 100)}%`}} /></div>
            <div className="panel-foot"><span className="mini-led warn" />Simulated observation · not a Chainlink event</div>
          </article>
        </section>

        <section className={`panel trade-panel ${stageIndex >= 2 && stageIndex <= 4 ? 'panel-active' : ''}`}>
          <PanelHeader eyebrow="TRADE" title="Reference-price mint / burn" trailing={<Pill kind="mint">BUY · tAAPL</Pill>} />
          <div className="trade-layout">
            <div className="trade-inputs">
              <div className="field-label">AMOUNT IN</div>
              <div className={`amount-field ${stageIndex < 2 ? 'amount-placeholder' : ''}`}><strong>{stageIndex < 2 ? '0.00' : '1.00'}</strong><span>tUSDC</span></div>
              <div className="field-sub">TEST SETTLEMENT TOKEN</div>
              <div className="slippage-row"><span>Slippage tolerance</span><b>0.50%</b></div>
            </div>
            <div className="trade-divider"><span>→</span></div>
            <div className="quote-result">
              <div className="field-label">ESTIMATED STOCK</div>
              <div className="quote-amount" style={{opacity: stageIndex >= 2 ? quoteProgress : 1, transform: `translateY(${(1 - quoteProgress) * 8}px)`}}>{stageIndex < 2 ? <strong className="quote-placeholder">Awaiting quote</strong> : <><strong>{quote}</strong><span>tAAPL</span></>}</div>
              <div className="quote-status"><span className="mini-led warn" />{stageIndex >= 2 ? 'Simulated reference price' : 'Output appears after quote request'}</div>
              <div className="quote-buttons">
                {stageIndex < 2 && <span className="button-primary">Get quote</span>}
                {stageIndex === 2 && <span className="button-primary">{quoteProgress > 0.72 ? 'Prepare transaction' : 'Get quote'}</span>}
                {stageIndex === 3 && <span className="button-primary">Approve in wallet</span>}
                {stageIndex === 4 && <span className="state-inline">Submitted · local Anvil</span>}
                {stageIndex === 5 && <span className="state-inline state-inline-done">Verified · local</span>}
              </div>
            </div>
          </div>
          <div className="quote-meta"><div><small>QUOTE</small><b>{stageIndex >= 2 ? `1 tUSDC → ${quote} tAAPL` : 'No quote issued'}</b></div><div><small>PRICE BASIS</small><b>Local simulated observation</b></div><div><small>CHAIN</small><b>Disposable Anvil · 84532</b></div></div>
        </section>

        <section className="execution-grid">
          <article className={`panel intent-panel ${stageIndex === 3 ? 'panel-active' : ''}`}>
            <PanelHeader eyebrow="PREPARATION" title={stageIndex >= 3 ? 'Unsigned intent' : 'Intent preview'} trailing={<Pill kind={stageIndex >= 3 ? 'mint' : 'quiet'}>{stageIndex >= 3 ? 'REVIEW' : 'NOT PREPARED'}</Pill>} />
            <div className="intent-hash"><small>INTENT HASH</small><code>{stageIndex >= 3 ? shortHash(intentHash) : 'Created after quote review'}</code></div>
            <div className="intent-details"><div><span>Approval</span><b>{stageIndex >= 2 ? '1.000000 tUSDC' : '—'}</b></div><div><span>Signature</span><b className="text-mint">Not signed by KYROX</b></div><div><span>Intent state</span><b>{stageIndex >= 3 ? 'Prepared' : 'Waiting'}</b></div></div>
            <div className="intent-note"><span className="shield-icon">◇</span><span>{stageIndex >= 3 ? 'Unsigned transaction — review in your wallet.' : 'Intent is not prepared yet.'}</span></div>
          </article>

          <article className={`panel transaction-panel ${stageIndex >= 4 ? 'panel-active' : ''}`}>
            <PanelHeader eyebrow="LOCAL EXECUTION" title="Activity" trailing={<Pill kind={stageIndex >= 5 ? 'done' : stageIndex === 4 ? 'mint' : 'quiet'}>{stageIndex >= 5 ? 'VERIFIED' : stageIndex === 4 ? 'SUBMITTED' : 'NO ACTIVITY'}</Pill>} />
            {stageIndex >= 4 ? <>
              <div className="transaction-row"><div className="tx-icon">↗</div><div className="tx-main"><b>Buy tAAPL</b><small>Test harness wallet · local Anvil</small></div><strong>{quote}</strong></div>
              <div className="hash-row"><small>TX HASH</small><code>{shortHash(transactionHash)}</code></div>
            </> : <div className="activity-empty">{stageIndex === 0 ? 'Sign in to see activity.' : 'No activity yet. Prepare a quote and approve it in your wallet.'}</div>}
            <div className="state-track"><span className={stageIndex >= 4 ? 'complete' : ''}>Prepared</span><i className={stageIndex >= 4 ? 'complete' : ''} /><span className={stageIndex >= 4 ? 'complete' : ''}>Submitted</span><i className={stageIndex >= 5 ? 'complete' : ''} /><span className={stageIndex >= 5 ? 'complete' : ''}>Verified</span></div>
          </article>
        </section>

        <section className="panel audit-panel">
          <PanelHeader eyebrow="SYSTEM ACTIVITY" title="E2E event trail" trailing={<span className="audit-count">6 EVENTS</span>} />
          <div className="audit-list">
            {[
              {label: 'wallet authenticated with one-time nonce', when: 'AUTH', on: stageIndex >= 1},
              {label: 'faucet claimed and exchange approved', when: 'SETUP', on: stageIndex >= 1},
              {label: `quote issued · 1 tUSDC → ${quote} tAAPL`, when: 'QUOTE', on: stageIndex >= 2},
              {label: 'unsigned intent prepared', when: 'INTENT', on: stageIndex >= 3},
              {label: `wallet submitted · ${shortHash(transactionHash)}`, when: 'TX', on: stageIndex >= 4},
              {label: 'activity verified · portfolio reflects local trade', when: 'VERIFY', on: stageIndex >= 5},
            ].map((event, index) => {
              const opacity = event.on ? reveal(local, 4 + index * 2, 10) : 0.34;
              return <div className={`audit-event ${event.on ? 'event-on' : ''}`} key={event.when} style={{opacity}}><i className="event-dot" /><span className="event-label">{event.when}</span><span className="event-text">{event.label}</span><span className="event-check">{event.on ? '✓' : '·'}</span></div>;
            })}
          </div>
          <div className="audit-terminal"><span className="terminal-prompt">›</span><span>{activeNote}</span><span className="terminal-cursor" style={{opacity: tick}} /></div>
        </section>

        <footer className="footer">
          <div><Mark /><span>KYROX</span><i>·</i><span>TESTNET PROTOTYPE</span></div>
          <div className="footer-warning"><span className="mini-led warn" />LOCAL ANVIL · SIMULATED · NO LIVE SEPOLIA DEPLOYMENT</div>
        </footer>
      </div>

      <div className="film-index"><span>PRODUCT FLOW</span><i />{String(Math.floor(frame / 30)).padStart(2, '0')}<span className="film-duration">30 SEC</span></div>
      <div className="edge-sweep" style={{opacity: Math.max(intentProgress, submitProgress) * 0.16}} />
    </main>
  );
};
