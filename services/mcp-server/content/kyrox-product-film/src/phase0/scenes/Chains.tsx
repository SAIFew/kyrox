import React from 'react';
import {interpolate, useCurrentFrame} from 'remotion';
import {Reveal, SceneFrame} from '../SceneFrame';

export const Chains: React.FC = () => {
  const f = useCurrentFrame();
  const dash = interpolate(f, [0, 125], [360, 0], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'});
  return <SceneFrame scene="04 / CHAIN ARCHITECTURE">
    <div className="scene-heading"><Reveal><div className="p0-kicker">02 / ISOLATION BY DESIGN</div></Reveal><Reveal at={10}><h1>Two networks.<br/><span>Separate authority.</span></h1></Reveal></div>
    <div className="chain-map">
      <Reveal at={25} className="chain-card mainnet"><div className="chain-index">NETWORK 01</div><div className="chain-name">BASE MAINNET</div><div className="chain-mode"><i/> READ ONLY</div><div className="chain-detail">DATA ACCESS LANE</div></Reveal>
      <div className="chain-separator"><svg viewBox="0 0 180 100"><path d="M12 50h156" stroke="rgba(117,165,190,.25)" strokeWidth="1"/><path d="M12 50h156" stroke="#66ddec" strokeWidth="2" strokeDasharray="360" strokeDashoffset={dash}/><circle cx={12 + (1 - dash / 360) * 156} cy="50" r="4" fill="#b7f8ff"/></svg><span>POLICY BOUNDARY · NO SHARED SIGNER</span></div>
      <Reveal at={61} className="chain-card sepolia"><div className="chain-index">NETWORK 02</div><div className="chain-name">BASE SEPOLIA</div><div className="chain-mode"><i/> WRITE TARGET</div><div className="chain-detail">TESTNET DESIGN TARGET</div></Reveal>
    </div>
    <Reveal at={88}><div className="architecture-stamp"><span>ACCEPTED ARCHITECTURE</span><b>Isolation is the rule.</b><small>No live deployment is implied.</small></div></Reveal>
    <Reveal at={115}><div className="chain-footnote">Read-only mainnet and testnet write isolation are design decisions,<br/>not evidence of an active chain integration.</div></Reveal>
  </SceneFrame>;
};
