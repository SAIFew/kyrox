import React from 'react';
import {Composition} from 'remotion';
import {KyroxShowcase} from './Showcase';
import './styles.css';

export const Root: React.FC = () => (
  <Composition
    id="KyroxShowcaseVertical"
    component={KyroxShowcase}
    durationInFrames={900}
    fps={30}
    width={1080}
    height={1920}
  />
);
