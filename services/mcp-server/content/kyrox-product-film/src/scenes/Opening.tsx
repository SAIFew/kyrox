import React from 'react';
import {AbsoluteFill, interpolate, useCurrentFrame} from 'remotion';
import {AccentRule, BrandMark, Eyebrow, FilmBackground, Lift, TypeLine, Wordmark, clamp} from '../components/Primitives';

export const Opening: React.FC = () => {
  const frame = useCurrentFrame();
  const orbit = interpolate(frame, [0, 180], [0, 360], clamp);
  const glow = interpolate(frame, [0, 42, 82], [0.15, 0.42, 0.22], clamp);
  return <AbsoluteFill>
    <FilmBackground/>
    <div className="opening-orbit" style={{transform: `rotate(${orbit}deg)`, opacity: glow}}>
      <svg viewBox="0 0 720 720"><circle cx="360" cy="360" r="265"/><circle cx="360" cy="360" r="322"/></svg>
      <i/><b/>
    </div>
    <div className="opening-core">
      <BrandMark size={256} delay={4}/>
      <Wordmark size={88} delay={19}/>
      <AccentRule delay={42} width={180}/>
      <Eyebrow delay={52}>TOOLING FOR THE NEXT INTERFACE</Eyebrow>
    </div>
    <div className="opening-copy">
      <TypeLine delay={70} className="opening-title">Intelligence needs<br/>a safer way to act.</TypeLine>
      <Lift delay={102}><div className="opening-sub">KYROX connects AI clients to structured,<br/>read-only stock tools.</div></Lift>
    </div>
    <div className="opening-footer"><span>MODEL CONTEXT PROTOCOL</span><span>01 / 06</span></div>
  </AbsoluteFill>;
};
