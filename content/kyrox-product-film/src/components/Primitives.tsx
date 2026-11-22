import React from 'react';
import {AbsoluteFill, Easing, interpolate, staticFile, useCurrentFrame} from 'remotion';

export const easeOut = Easing.bezier(0.18, 0.78, 0.22, 1);
export const clamp = {extrapolateLeft: 'clamp' as const, extrapolateRight: 'clamp' as const};

export const enter = (frame: number, start = 0, span = 24) =>
  interpolate(frame, [start, start + span], [0, 1], {...clamp, easing: easeOut});

export const Lift: React.FC<{children: React.ReactNode; delay?: number; className?: string}> = ({children, delay = 0, className = ''}) => {
  const frame = useCurrentFrame();
  const p = enter(frame, delay, 24);
  return <div className={className} style={{opacity: p, transform: `translateY(${(1 - p) * 42}px)`}}>{children}</div>;
};

export const TypeLine: React.FC<{children: React.ReactNode; delay?: number; className?: string}> = ({children, delay = 0, className = ''}) => {
  const frame = useCurrentFrame();
  const p = enter(frame, delay, 20);
  const wipe = interpolate(frame, [delay, delay + 26], [100, 0], clamp);
  return <div className={`type-line ${className}`} style={{opacity: p, clipPath: `inset(0 ${wipe}% 0 0)`, transform: `translateY(${(1 - p) * 26}px)`}}>{children}</div>;
};

export const AccentRule: React.FC<{delay?: number; width?: number}> = ({delay = 0, width = 150}) => {
  const frame = useCurrentFrame();
  const p = enter(frame, delay, 28);
  return <div className="accent-rule" style={{width: width * p}}/>;
};

export const FilmBackground: React.FC<{variant?: 'blue' | 'violet'; grid?: boolean}> = ({variant = 'blue', grid = true}) => {
  const frame = useCurrentFrame();
  const drift = interpolate(frame, [0, 600], [0, -32], clamp);
  return <AbsoluteFill className="film-bg">
    <div className={`ambient ambient-${variant}`} style={{transform: `translate3d(${drift}px, ${-drift * 0.5}px, 0)`}}/>
    {grid && <svg className="grain-grid" width="1080" height="1920" aria-hidden="true">
      <defs><pattern id="microgrid" width="72" height="72" patternUnits="userSpaceOnUse"><path d="M 72 0 L 0 0 0 72" fill="none" stroke="rgba(156,180,221,.10)" strokeWidth="1"/></pattern></defs>
      <rect width="1080" height="1920" fill="url(#microgrid)"/>
    </svg>}
    <div className="vignette"/>
  </AbsoluteFill>;
};

export const BrandMark: React.FC<{size?: number; delay?: number}> = ({size = 210, delay = 0}) => {
  const frame = useCurrentFrame();
  const p = enter(frame, delay, 34);
  const rot = interpolate(frame, [delay, delay + 50], [-8, 0], clamp);
  return <div className="brand-mark-wrap" style={{width: size, height: size, opacity: p, transform: `scale(${0.82 + p * 0.18}) rotate(${rot}deg)`}}>
    <div className="mark-halo"/>
    <img src={staticFilePath('kyrox-logo.png')} className="brand-mark-img"/>
  </div>;
};

export const Wordmark: React.FC<{size?: number; delay?: number}> = ({size = 66, delay = 0}) => {
  const frame = useCurrentFrame();
  const p = enter(frame, delay, 24);
  return <div className="wordmark" style={{fontSize: size, opacity: p, letterSpacing: `${-0.045 + (1 - p) * 0.04}em`, transform: `translateY(${(1 - p) * 18}px)`}}>KYROX</div>;
};

export const Eyebrow: React.FC<{children: React.ReactNode; delay?: number}> = ({children, delay = 0}) => <Lift delay={delay}><div className="eyebrow">{children}</div></Lift>;

export const Pill: React.FC<{children: React.ReactNode; tone?: 'blue' | 'violet' | 'muted'}> = ({children, tone = 'blue'}) => <span className={`pill pill-${tone}`}>{children}</span>;

export const NodeCard: React.FC<{kicker: string; title: string; sub?: string; active?: boolean; delay?: number}> = ({kicker, title, sub, active, delay = 0}) => <Lift delay={delay} className={`node-card ${active ? 'node-active' : ''}`}>
  <div className="node-kicker">{kicker}</div><div className="node-title">{title}</div>{sub && <div className="node-sub">{sub}</div>}
</Lift>;

function staticFilePath(file: string) { return staticFile(file); }
