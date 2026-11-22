import React from 'react';
import {AbsoluteFill, interpolate, staticFile, useCurrentFrame} from 'remotion';
import {Eyebrow, Lift, TypeLine, clamp} from '../components/Primitives';
import {SceneHeader, SceneShell} from '../components/SceneShell';

export const Security: React.FC = () => {
  const frame = useCurrentFrame();
  const p = interpolate(frame, [14, 74], [0, 1], clamp);
  return <SceneShell tint="violet">
    <SceneHeader section="THE BOUNDARY" step="05 / 06"/>
    <div className="scene-content security-content">
      <Eyebrow>NON-CUSTODIAL BY DESIGN</Eyebrow>
      <TypeLine delay={7} className="scene-title">Your keys stay<br/><span>outside KYROX.</span></TypeLine>
      <div className="security-diagram">
        <div className="server-boundary"><span className="boundary-label">KYROX SERVER</span><div className="mcp-chip"><img src={staticFile('kyrox-logo.png')}/><div><small>TOOL OUTPUT</small><b>Structured data</b></div></div><div className="no-key"><span>×</span><b>PRIVATE KEY</b><small>NEVER ENTERS</small></div><div className="no-sign"><span className="sign-glyph">⊘</span><b>NO SIGNING</b><small>NO BROADCASTING</small></div></div>
        <div className="boundary-link"><svg viewBox="0 0 180 80"><path d="M4 40 H176" className="boundary-track"/><path d="M4 40 H176" className="boundary-pulse" style={{strokeDasharray: 172, strokeDashoffset:172*(1-p)}}/><circle cx={4+172*p} cy="40" r="4" className="traveller-violet"/></svg><span>HUMAN CONTROL</span></div>
        <div className="external-wallet"><span className="external-icon">◇</span><b>Your wallet</b><small>Review · sign externally</small><span className="external-tag">OUTSIDE KYROX</span></div>
      </div>
      <TypeLine delay={56} className="security-statement">Data can be read. Signing stays with you.</TypeLine>
      <Lift delay={69}><div className="security-note">Transaction preparation and simulation are planned,<br/>not part of the current tool set.</div></Lift>
    </div>
  </SceneShell>;
};
