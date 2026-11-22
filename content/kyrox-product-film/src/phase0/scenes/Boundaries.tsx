import React from 'react';
import {interpolate, useCurrentFrame} from 'remotion';
import {Reveal, SceneFrame} from '../SceneFrame';

const blocked = ['SIGN', 'EXECUTE', 'TRANSFER WITHOUT APPROVAL', 'ARBITRARY CALLDATA'];
export const Boundaries: React.FC = () => {
  const f = useCurrentFrame();
  const pulse = interpolate(f % 72, [0, 36, 72], [0.35, 0.95, 0.35]);
  return <SceneFrame scene="03 / PERMISSION BOUNDARIES">
    <div className="scene-heading"><Reveal><div className="p0-kicker">01 / CAPABILITY GATE</div></Reveal><Reveal at={10}><h1>Intelligence.<br/><span>Inside a boundary.</span></h1></Reveal></div>
    <Reveal at={22}><div className="agent-boundary">
      <div className="boundary-top"><span>AGENT PERMISSIONS</span><span className="boundary-live" style={{opacity: pulse}}>ENFORCED POLICY</span></div>
      <div className="allow-items"><div><b>READ</b><small>structured, verified inputs</small></div><div><b>QUOTE</b><small>informational estimates</small></div></div>
      <div className="boundary-foot">TOOLS CANNOT AUTHORIZE THEMSELVES</div>
    </div></Reveal>
    <Reveal at={46}><div className="blocked-title">OUTSIDE THE AGENT’S AUTHORITY</div></Reveal>
    <div className="blocked-list">{blocked.map((item, i) => <Reveal key={item} at={53 + i * 11} className="blocked-item"><span className="block-x">×</span><span>{item}</span><span className="blocked-state">BLOCKED</span></Reveal>)}</div>
    <Reveal at={104}><div className="human-note"><span className="human-dot"/>Unsigned preparation and simulation require human review.<br/>No keys, signatures or broadcasts enter KYROX.</div></Reveal>
  </SceneFrame>;
};
