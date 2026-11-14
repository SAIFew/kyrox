import React from 'react';
import {AbsoluteFill, interpolate, staticFile, useCurrentFrame} from 'remotion';
import {Eyebrow, Lift, Pill, TypeLine, clamp} from '../components/Primitives';
import {SceneHeader, SceneShell} from '../components/SceneShell';

const Flow: React.FC<{frame: number}> = ({frame}) => {
  const p = interpolate(frame, [10, 92], [0, 1], clamp);
  return <svg className="flow-svg" viewBox="0 0 820 690" preserveAspectRatio="none">
    <path d="M410 88 V580" className="flow-track"/>
    <path d="M410 88 V580" className="flow-pulse" style={{strokeDasharray: 520, strokeDashoffset: 520 * (1 - p)}}/>
    <circle cx="410" cy="143" r="8" className="flow-node"/><circle cx="410" cy="346" r="8" className="flow-node"/><circle cx="410" cy="548" r="8" className="flow-node"/>
  </svg>;
};

export const Architecture: React.FC = () => {
  const frame = useCurrentFrame();
  return <SceneShell>
    <SceneHeader section="THE CONNECTION" step="02 / 06"/>
    <div className="scene-content architecture-content">
      <Eyebrow>STANDARDISED. EXPLICIT. READ ONLY.</Eyebrow>
      <TypeLine delay={8} className="scene-title">One protocol.<br/><span>Clear boundaries.</span></TypeLine>
      <div className="architecture-stack">
        <div className="arch-wire"><span className="wire-label">MCP · JSON-RPC</span><div className="wire-line"/></div>
        <div className="arch-node agent"><div className="arch-icon ai-icon">AI</div><div><small>CLIENT</small><b>AI agent</b><em>Claude · MCP host</em></div></div>
        <div className="arch-wire"><span className="wire-label">STDIO TRANSPORT</span><div className="wire-line"/></div>
        <div className="arch-node server-node"><div className="mini-mark"><img src={staticFile('kyrox-logo.png')}/></div><div><small>FAST M C P · PYTHON</small><b>KYROX server</b><em>Structured tool boundary</em></div></div>
        <div className="arch-wire"><span className="wire-label">VALIDATED TOOL CALL</span><div className="wire-line"/></div>
        <div className="arch-endpoints">
          <div className="endpoint endpoint-local"><span className="endpoint-dot"/><b>Local stock fixtures</b><small>VERIFIED LOOKUPS</small></div>
          <div className="endpoint endpoint-chain"><span className="endpoint-dot violet-dot"/><b>Base Sepolia reader</b><small>VERIFICATION IN PROGRESS</small></div>
        </div>
      </div>
      <Lift delay={38}><div className="architecture-caption">The client calls named tools. KYROX validates inputs<br/>and returns structured results to that client.</div></Lift>
    </div>
    <Flow frame={frame}/>
  </SceneShell>;
};
