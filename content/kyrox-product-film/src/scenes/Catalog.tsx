import React from 'react';
import {AbsoluteFill, interpolate, useCurrentFrame} from 'remotion';
import {Eyebrow, Lift, TypeLine, clamp} from '../components/Primitives';
import {SceneHeader, SceneShell} from '../components/SceneShell';

const stocks = [
  {ticker: 'tAAPL', name: 'Test Apple', value: '230.00'},
  {ticker: 'tTSLA', name: 'Test Tesla', value: '250.00'},
  {ticker: 'tNVDA', name: 'Test Nvidia', value: '140.00'},
];

const LookupCard: React.FC<{frame: number}> = ({frame}) => {
  const call = interpolate(frame, [22, 40], [0, 1], clamp);
  const valueReveal = interpolate(frame, [42, 74], [0, 1], clamp);
  return <div className="lookup-card">
    <div className="lookup-top"><span className="terminal-dot"/><span>KYROX / TOOL RESULT</span><span className="local-label">LOCAL DEMO</span></div>
    <div className="lookup-call" style={{opacity: call, transform: `translateY(${(1-call)*18}px)`}}><span className="call-arrow">↳</span><div><small>get_stock_info</small><b>("tAAPL")</b></div><span className="call-state">COMPLETE</span></div>
    <div className="lookup-separator"/>
    <div className="stock-highlight"><div><small>TICKER</small><b>tAAPL</b></div><div><small>STOCK</small><b>Test Apple</b></div></div>
    <div className="mock-price"><div><small>REFERENCE VALUE</small><span className="value-number" style={{opacity: valueReveal, transform: `translateY(${(1-valueReveal)*8}px)`}}>230.00</span></div><span className="mock-badge">MOCK</span></div>
    <div className="lookup-meta"><span>token_address</span><b>""</b></div>
    <div className="fixture-note">LOCAL FIXTURE · NOT A LIVE PRICE</div>
    <div className="stock-list">
      {stocks.map((s, i) => {
        const p = interpolate(frame, [36 + i * 13, 57 + i * 13], [0, 1], clamp);
        return <div className="stock-row" key={s.ticker} style={{opacity: p, transform: `translateX(${(1-p)*30}px)`}}><span className="stock-ticker">{s.ticker}</span><span className="stock-name">{s.name}</span><span className="stock-value">{s.value} <i>MOCK</i></span></div>;
      })}
    </div>
    <div className="lookup-bottom"><span>list_stocks()</span><span>3 FIXTURES</span></div>
  </div>;
};

export const Catalog: React.FC = () => {
  const frame = useCurrentFrame();
  return <SceneShell tint="violet">
    <SceneHeader section="THE CATALOG" step="03 / 06"/>
    <div className="scene-content catalog-content">
      <Eyebrow>IMPLEMENTED · LOCAL FIXTURE DATA</Eyebrow>
      <TypeLine delay={8} className="scene-title">Look up a stock.<br/><span>Get its record.</span></TypeLine>
      <Lift delay={15}><div className="scene-description">The server validates the ticker, finds its<br/>fixture and returns the stored fields.</div></Lift>
      <LookupCard frame={frame}/>
      <div className="catalog-tools"><span>get_stock_info</span><i/> <span>list_stocks</span><i/> <span>hello_kyrox</span></div>
    </div>
  </SceneShell>;
};
