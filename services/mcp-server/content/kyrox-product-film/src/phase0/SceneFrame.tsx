import React from 'react';
import {AbsoluteFill, Easing, interpolate, useCurrentFrame} from 'remotion';

export const ease = Easing.bezier(0.2, 0.78, 0.22, 1);
const clamp = {extrapolateLeft: 'clamp' as const, extrapolateRight: 'clamp' as const};

export const SceneFrame: React.FC<{children: React.ReactNode; scene: string}> = ({children, scene}) => {
  const frame = useCurrentFrame();
  return <AbsoluteFill className="p0-scene">
    <Background frame={frame}/>
    <div className="p0-topbar"><span>KYROX / PHASE 0</span><span>{scene}</span></div>
    {children}
    <div className="p0-bottomline"><span>ARCHITECTURE MILESTONE</span><span>BASE · NON-CUSTODIAL BY DESIGN</span></div>
  </AbsoluteFill>;
};

export const Reveal: React.FC<{children: React.ReactNode; at?: number; className?: string}> = ({children, at = 0, className = ''}) => {
  const f = useCurrentFrame();
  const p = interpolate(f, [at, at + 24], [0, 1], {...clamp, easing: ease});
  return <div className={className} style={{opacity: p, transform: `translate3d(0, ${(1 - p) * 28}px, 0)`}}>{children}</div>;
};

export const Wordmark: React.FC<{at?: number; size?: number}> = ({at = 0, size = 94}) => {
  const f = useCurrentFrame();
  const p = interpolate(f, [at, at + 32], [0, 1], {...clamp, easing: ease});
  return <div className="p0-wordmark" style={{fontSize: size, opacity: p, letterSpacing: `${(-0.06 + (1 - p) * 0.1)}em`, transform: `translateY(${(1 - p) * 18}px)`}}>KYROX</div>;
};

const points = Array.from({length: 29}, (_, i) => ({
  x: 96 + ((i * 179) % 888),
  y: 218 + ((i * 317) % 1370),
  r: i % 6 === 0 ? 2.3 : 1.2,
  phase: i * 0.73,
}));

const Background: React.FC<{frame: number}> = ({frame}) => {
  const drift = frame * 0.13;
  return <div className="p0-bg" aria-hidden="true">
    <div className="p0-glow p0-glow-a" style={{transform: `translate(${Math.sin(drift / 75) * 42}px, ${Math.cos(drift / 88) * 38}px)`}}/>
    <div className="p0-glow p0-glow-b" style={{transform: `translate(${Math.cos(drift / 80) * 40}px, ${Math.sin(drift / 97) * 43}px)`}}/>
    <svg className="p0-network" viewBox="0 0 1080 1800" preserveAspectRatio="none">
      {points.map((p, i) => {
        const next = points[(i + 5) % points.length];
        const alpha = 0.12 + (Math.sin(frame / 20 + p.phase) + 1) * 0.08;
        return <g key={i}>
          <path d={`M ${p.x} ${p.y} L ${next.x} ${next.y}`} stroke={`rgba(87,166,211,${alpha * 0.55})`} strokeWidth="1"/>
          <circle cx={p.x} cy={p.y} r={p.r} fill={`rgba(125,220,239,${alpha})`}/>
        </g>;
      })}
    </svg>
    <div className="p0-grid"/><div className="p0-vignette"/>
  </div>;
};

