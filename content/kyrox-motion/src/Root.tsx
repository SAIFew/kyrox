import React from 'react';
import {Composition} from 'remotion';
import {KyroxMotion} from './KyroxMotion';
import './styles.css';

export const Root: React.FC = () => (
  <Composition
    id="KyroxInsideOneToolCall"
    component={KyroxMotion}
    durationInFrames={660}
    fps={30}
    width={1920}
    height={1080}
  />
);
