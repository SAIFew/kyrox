import React from 'react';
import {AbsoluteFill, interpolate, useCurrentFrame} from 'remotion';
import {Eyebrow, Lift, Pill, TypeLine, clamp} from '../components/Primitives';
import {SceneHeader, SceneShell} from '../components/SceneShell';

export const Wallet: React.FC = () => {
  const frame = useCurrentFrame();
  const p = interpolate(frame, [24, 86], [0, 1], clamp);
  return <SceneShell>
    <SceneHeader section="THE WALLET READER" step="04 / 06"/>
    <div className="scene-content wallet-content">
      <Eyebrow>BASE SEPOLIA · IN PROGRESS</Eyebrow>
      <TypeLine delay={8} className="scene-title">Read balances.<br/><span>Verify the source.</span></TypeLine>
      <Lift delay={18}><div className="scene-description">get_wallet_balances validates a public address; Base Sepolia<br/>reads await verified token addresses.</div></Lift>
      <div className="network-card">
        <div className="network-header"><span className="network-live"><i/>READ PATH · IN PROGRESS</span><span>CHAIN ID&nbsp; 84532</span></div>
        <div className="network-path"><div className="wallet-input"><span className="wallet-icon">◈</span><b>Public wallet</b><small>Address input</small></div><svg viewBox="0 0 160 100"><path d="M8 50 H152" className="path-track"/><path d="M8 50 H152" className="path-active" style={{strokeDasharray: 144, strokeDashoffset: 144*(1-p)}}/><circle cx={8 + 144*p} cy="50" r="4" className="traveller"/></svg><div className="wallet-output"><span className="chain-glyph">◉</span><b>balanceOf()</b><small>ERC-20 read</small></div></div>
        <div className="pending-panel"><div className="pending-spinner" style={{transform: `rotate(${frame*4}deg)`}}/><div><b>Contract verification pending</b><small>No deployed token addresses are configured.</small></div></div>
        <div className="chain-label">READ-ONLY · BASE SEPOLIA · NO SIGNING</div>
      </div>
      <Lift delay={48}><div className="wallet-footnote">The reader code is implemented; on-chain balances<br/>remain unverified until contract addresses are confirmed.</div></Lift>
    </div>
  </SceneShell>;
};
