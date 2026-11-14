import React from 'react';
import {Composition} from 'remotion';
import {KyroxFilm} from './KyroxFilm';
import './styles.css';

export const Root: React.FC = () => (
  <Composition
    id="KyroxProductLaunchFilm"
    component={KyroxFilm}
    durationInFrames={1140}
    fps={30}
    width={1080}
    height={1920}
  />
);
