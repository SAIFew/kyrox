import React from 'react';
import {AbsoluteFill, interpolate, useCurrentFrame} from 'remotion';
import {FilmBackground} from './Primitives';

export const SceneShell: React.FC<{children: React.ReactNode; tint?: 'blue' | 'violet'}> = ({children, tint = 'blue'}) => {
  const frame = useCurrentFrame();
  const p = interpolate(frame, [0, 22], [0, 1], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'});
  const zoom = interpolate(frame, [0, 90], [1.025, 1], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'});
  return <AbsoluteFill>
    <FilmBackground variant={tint}/>
    <AbsoluteFill style={{opacity: p, transform: `scale(${zoom})`}}>{children}</AbsoluteFill>
    <div className="safe-topline"/>
  </AbsoluteFill>;
};

export const SceneHeader: React.FC<{section: string; step: string}> = ({section, step}) => <div className="scene-header"><span>{section}</span><span>{step}</span></div>;
