import React from 'react';
import {interpolate, useCurrentFrame} from 'remotion';
import {Reveal, SceneFrame} from '../SceneFrame';

export const Hook: React.FC = () => {
  const f = useCurrentFrame();
  const sweep = interpolate(f, [8, 95], [-210, 1140], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'});
  return <SceneFrame scene="01 / THE HOOK">
    <div className="hook-orbit" style={{transform: `rotate(${f * 0.23}deg)`}}>
      <svg viewBox="0 0 780 780"><circle cx="390" cy="390" r="272"/><circle cx="390" cy="390" r="348"/><path d="M40 390h700M390 40v700"/></svg>
    </div>
    <div className="hook-copy">
      <Reveal at={5}><div className="p0-kicker">A SAFER INTERFACE FOR INTELLIGENCE</div></Reveal>
      <Reveal at={17}><div className="hook-line">AN AI AGENT</div></Reveal>
      <Reveal at={32}><div className="hook-line hook-line-muted">THAT CAN’T</div></Reveal>
      <Reveal at={47}><div className="hook-line">MOVE YOUR</div></Reveal>
      <Reveal at={62}><div className="hook-line hook-accent">MONEY ALONE.</div></Reveal>
      <div className="hook-scan" style={{transform: `translateX(${sweep}px)`}}/>
      <Reveal at={92}><div className="p0-caption">Capability follows permission.<br/>Control stays with the human.</div></Reveal>
    </div>
    <div className="hook-coordinates">NETWORK / 00.01 &nbsp;·&nbsp; PERMISSION FIRST</div>
  </SceneFrame>;
};
