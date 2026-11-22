import React from 'react';
import {AbsoluteFill, interpolate, useCurrentFrame} from 'remotion';
import {AccentRule, BrandMark, Eyebrow, Lift, TypeLine, Wordmark, clamp} from '../components/Primitives';
import {SceneShell} from '../components/SceneShell';

const StatusOrbit: React.FC = () => {
  const frame = useCurrentFrame();
  const p = interpolate(frame, [0, 90], [0, 360], clamp);
  return <div className="closing-orbit" style={{transform: `rotate(${p}deg)`}}><svg viewBox="0 0 760 760"><circle cx="380" cy="380" r="278"/><circle cx="380" cy="380" r="352"/></svg><i/><b/></div>;
};

export const Closing: React.FC = () => <SceneShell>
  <ClosingInner/>
</SceneShell>;

const ClosingInner: React.FC = () => {
  const frame = useCurrentFrame();
  const wave = interpolate(frame, [0, 40, 90], [0, 1, 0.4], clamp);
  return <AbsoluteFill>
    <ClosingOrbit/>
    <div className="closing-main"><BrandMark size={215} delay={5}/><Wordmark size={78} delay={20}/><AccentRule delay={42} width={200}/><Eyebrow delay={52}>BUILDING THE TRUSTED TOOL LAYER</Eyebrow>
      <TypeLine delay={45} className="closing-title">Read clearly.<br/><span>Keep control.</span></TypeLine>
      <Lift delay={68}><div className="closing-copy">KYROX · Open source · Base Sepolia</div></Lift>
      <div className="closing-status" style={{opacity: wave}}><i/> v0.1 · DEVELOPMENT</div>
    </div>
    <div className="closing-footer"><span>NO KEYS · NO SIGNING · NO BROADCASTING</span><span>KYROX.IO</span></div>
  </AbsoluteFill>;
};

function ClosingOrbit() { return <ClosingOrbitFrame/>; }
const ClosingOrbitFrame: React.FC = () => {
  const frame = useCurrentFrame();
  const rot = interpolate(frame, [0, 240], [0, 200], clamp);
  return <div className="closing-orbit" style={{transform: `rotate(${rot}deg)`}}><svg viewBox="0 0 760 760"><circle cx="380" cy="380" r="278"/><circle cx="380" cy="380" r="352"/></svg><i/><b/></div>;
}
