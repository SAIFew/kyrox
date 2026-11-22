import React from 'react';
import {interpolate, staticFile, useCurrentFrame} from 'remotion';
import {Reveal, SceneFrame, Wordmark} from '../SceneFrame';

export const Brand: React.FC = () => {
  const f = useCurrentFrame();
  const draw = interpolate(f, [4, 68], [0, 1], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'});
  const halo = interpolate(f, [25, 78, 150], [0, 0.32, 0.1], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'});
  return <SceneFrame scene="02 / KYROX">
    <div className="brand-field">
      <div className="brand-rings" style={{transform: `rotate(${f * 0.19}deg)`}}>
        <svg viewBox="0 0 720 720"><circle cx="360" cy="360" r="230"/><circle cx="360" cy="360" r="292"/><circle cx="360" cy="360" r="350"/></svg>
      </div>
      <div className="brand-halo" style={{opacity: halo}}/>
      <img className="brand-mark" src={staticFile('kyrox-logo.png')} style={{opacity: draw, transform: `scale(${0.9 + draw * 0.1})`}}/>
      <Wordmark at={38} size={100}/>
      <div className="brand-rule" style={{transform: `scaleX(${draw})`}}/>
      <Reveal at={73}><div className="brand-subtitle">AI-powered onchain<br/>financial infrastructure.</div></Reveal>
      <Reveal at={114}><div className="brand-class">PERMISSIONED TOOLS &nbsp; / &nbsp; BASE</div></Reveal>
    </div>
  </SceneFrame>;
};
