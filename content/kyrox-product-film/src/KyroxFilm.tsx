import React from 'react';
import {Audio, Sequence, staticFile, useCurrentFrame} from 'remotion';
import {Opening} from './scenes/Opening';
import {Architecture} from './scenes/Architecture';
import {Catalog} from './scenes/Catalog';
import {Wallet} from './scenes/Wallet';
import {Security} from './scenes/Security';
import {Closing} from './scenes/Closing';
import {clamp} from './components/Primitives';
import {interpolate} from 'remotion';

type ClipProps = {children: React.ReactNode; duration: number};
const SceneClip: React.FC<ClipProps> = ({children, duration}) => {
  const frame = useCurrentFrame();
  const opacity = interpolate(frame, [0, 16, duration - 18, duration], [0, 1, 1, 0], clamp);
  const scale = interpolate(frame, [0, duration], [1.012, 0.998], clamp);
  return <div style={{position: 'absolute', inset: 0, opacity, transform: `scale(${scale})`}}>{children}</div>;
};

const segments = [
  {from: 0, duration: 180, component: <Opening/>},
  {from: 168, duration: 198, component: <Architecture/>},
  {from: 354, duration: 264, component: <Catalog/>},
  {from: 606, duration: 210, component: <Wallet/>},
  {from: 804, duration: 206, component: <Security/>},
  {from: 998, duration: 142, component: <Closing/>},
];

export const KyroxFilm: React.FC = () => <>
  <Audio src={staticFile('original-score.wav')} volume={0.8}/>
  {segments.map((segment, index) => <Sequence key={index} from={segment.from} durationInFrames={segment.duration} name={`Scene ${index + 1}`}>
    <SceneClip duration={segment.duration}>{segment.component}</SceneClip>
  </Sequence>)}
</>;
