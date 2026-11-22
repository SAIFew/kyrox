import React from 'react';
import {interpolate, useCurrentFrame} from 'remotion';
import {Reveal, SceneFrame} from '../SceneFrame';

const metrics = [
  {value: '78', label: 'TRACKED FILES', note: 'in this workspace'},
  {value: '7', label: 'ARCHITECTURE DECISIONS', note: 'recorded for KYROX'},
  {value: '394+', label: 'TESTS DOCUMENTED', note: 'in the repository README'},
];

export const Proof: React.FC = () => {
  const f = useCurrentFrame();
  const progress = interpolate(f, [20, 142], [0, 1], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'});
  return <SceneFrame scene="05 / PHASE 0 PROOF">
    <div className="scene-heading proof-heading"><Reveal><div className="p0-kicker">A FOUNDATION YOU CAN INSPECT</div></Reveal><Reveal at={8}><h1>Progress,<br/><span>with receipts.</span></h1></Reveal></div>
    <div className="metric-grid">{metrics.map((m, i) => <Reveal key={m.label} at={24 + i * 14} className={`metric-card metric-${i}`}><div className="metric-value">{m.value}</div><div className="metric-label">{m.label}</div><div className="metric-note">{m.note}</div><div className="metric-rule" style={{transform: `scaleX(${progress})`}}/></Reveal>)}</div>
    <Reveal at={83}><div className="workflow-card"><div className="workflow-glyph">CI</div><div><div className="workflow-title">AUTOMATION STATUS</div><div className="workflow-value">NO GITHUB ACTIONS WORKFLOW FOUND</div></div><div className="workflow-mark">—</div></div></Reveal>
    <Reveal at={111}><div className="proof-note">Verified from the current workspace on 21 Nov 2026.<br/>Architecture milestone · no contracts deployed yet.</div></Reveal>
  </SceneFrame>;
};
