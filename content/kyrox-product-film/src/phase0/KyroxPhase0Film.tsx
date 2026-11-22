import React from 'react';
import {Audio, interpolate, Sequence, staticFile, useCurrentFrame} from 'remotion';
import {Hook} from './scenes/Hook';
import {Brand} from './scenes/Brand';
import {Boundaries} from './scenes/Boundaries';
import {Chains} from './scenes/Chains';
import {Proof} from './scenes/Proof';
import {EndCard} from './scenes/EndCard';
import './phase0.css';

const scenes = [
  {from: 0, duration: 162, element: <Hook/>},
  {from: 150, duration: 192, element: <Brand/>},
  {from: 330, duration: 252, element: <Boundaries/>},
  {from: 570, duration: 222, element: <Chains/>},
  {from: 780, duration: 222, element: <Proof/>},
  {from: 990, duration: 150, element: <EndCard/>},
];

const SceneTransition: React.FC<{children: React.ReactNode; duration: number}> = ({children, duration}) => {
  const f = useCurrentFrame();
  const opacity = interpolate(f, [0, 14, duration - 14, duration], [0, 1, 1, 0], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'});
  const scale = interpolate(f, [0, duration], [1.008, 1], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'});
  return <div style={{position: 'absolute', inset: 0, opacity, transform: `scale(${scale})`}}>{children}</div>;
};

export const KyroxPhase0Film: React.FC = () => <>
  <div className="p0-canvas-base"/>
  <Audio src={staticFile('original-score.wav')} volume={0.74}/>
  {scenes.map((scene, i) => <Sequence key={i} from={scene.from} durationInFrames={scene.duration} name={`Phase 0 · Scene ${i + 1}`}>
    <SceneTransition duration={scene.duration}>{scene.element}</SceneTransition>
  </Sequence>)}
</>;

