import React from 'react';
import {interpolate, staticFile, useCurrentFrame} from 'remotion';
import {Reveal, SceneFrame, Wordmark} from '../SceneFrame';

export const EndCard: React.FC = () => {
  const f = useCurrentFrame();
  const orbit = interpolate(f, [0, 150], [0, 78], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'});
  return <SceneFrame scene="06 / NEXT: IMPLEMENTATION">
    <div className="end-orbit" style={{transform: `rotate(${orbit}deg)`}}><svg viewBox="0 0 760 760"><circle cx="380" cy="380" r="250"/><circle cx="380" cy="380" r="330"/><path d="M45 380h670M380 45v670"/></svg></div>
    <div className="end-card">
      <div className="end-logo"><img src={staticFile('kyrox-logo.png')}/></div>
      <Wordmark at={16} size={81}/>
      <Reveal at={36}><div className="end-rule"/></Reveal>
      <Reveal at={51}><div className="phase-complete">PHASE 0 <span>—</span> COMPLETE</div></Reveal>
      <Reveal at={72}><div className="end-thesis">THE FOUNDATION<br/><span>IS IN PLACE.</span></div></Reveal>
      <Reveal at={101}><div className="next-label"><i/> NEXT: IMPLEMENTATION</div></Reveal>
      <Reveal at={120} className="disclosure-wrap"><div className="disclosure">Architecture milestone. No contracts deployed yet.</div></Reveal>
    </div>
  </SceneFrame>;
};
