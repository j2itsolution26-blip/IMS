import * as React from 'react';
import { cn } from '@/lib/utils';

/**
 * Decorative drawings for the pricing section. Inline SVG coloured from the
 * theme tokens, so they follow light and dark mode and cost no requests.
 * Purely decorative: hidden from assistive technology and from clicks.
 */

function Art({ className, viewBox, children }: { className?: string; viewBox: string; children: React.ReactNode }) {
  return (
    <svg viewBox={viewBox} className={cn('pointer-events-none select-none', className)} aria-hidden="true" focusable="false">
      {children}
    </svg>
  );
}

/** A four-point sparkle centred on (x, y). */
function Sparkle({ x, y, r, className }: { x: number; y: number; r: number; className: string }) {
  const k = r * 0.28;
  return (
    <path
      className={className}
      d={`M${x} ${y - r} L${x + k} ${y - k} L${x + r} ${y} L${x + k} ${y + k} L${x} ${y + r} L${x - k} ${y + k} L${x - r} ${y} L${x - k} ${y - k} Z`}
    />
  );
}

/** Stacked boxes: stock on the shelf (Basic). */
export function BasicArt({ className }: { className?: string }) {
  const cube = (x: number, y: number, s: number, key: string) => (
    <g key={key}>
      <polygon points={`${x},${y} ${x + s},${y - s / 2} ${x + 2 * s},${y} ${x + s},${y + s / 2}`} className="fill-plan-basic/20" />
      <polygon points={`${x},${y} ${x + s},${y + s / 2} ${x + s},${y + 1.5 * s} ${x},${y + s}`} className="fill-plan-basic/30" />
      <polygon points={`${x + s},${y + s / 2} ${x + 2 * s},${y} ${x + 2 * s},${y + s} ${x + s},${y + 1.5 * s}`} className="fill-plan-basic/15" />
    </g>
  );
  return (
    <Art viewBox="0 0 160 160" className={className}>
      {cube(70, 30, 22, 'top')}
      {cube(30, 90, 30, 'left')}
      {cube(88, 84, 34, 'right')}
    </Art>
  );
}

/** Rising bars and an arrow: growth (Business). */
export function BusinessArt({ className }: { className?: string }) {
  return (
    <Art viewBox="0 0 160 160" className={className}>
      {[0, 1, 2, 3].map((i) => (
        <rect key={i} x={30 + i * 30} y={124 - i * 26} width="18" height={26 + i * 26} rx="3" className="fill-primary/20" />
      ))}
      <path d="M22 112 C64 100 104 70 140 22" className="fill-none stroke-primary/40" strokeWidth="5" strokeLinecap="round" />
      <path d="M124 20 L142 18 L142 37" className="fill-none stroke-primary/40" strokeWidth="5" strokeLinecap="round" strokeLinejoin="round" />
    </Art>
  );
}

/** A rocket over clouds with sparkles: scale (Enterprise). */
export function EnterpriseArt({ className }: { className?: string }) {
  return (
    <Art viewBox="0 0 160 180" className={className}>
      <circle cx="40" cy="160" r="26" className="fill-plan-enterprise/10" />
      <circle cx="80" cy="152" r="32" className="fill-plan-enterprise/15" />
      <circle cx="122" cy="160" r="26" className="fill-plan-enterprise/10" />

      <g transform="rotate(30 96 86)">
        <path d="M96 22 C116 44 120 84 112 116 L80 116 C72 84 76 44 96 22 Z" className="fill-plan-enterprise/55" />
        <circle cx="96" cy="66" r="10" className="fill-card" />
        <circle cx="96" cy="66" r="6" className="fill-plan-enterprise-tint" />
        <path d="M80 96 L64 124 L82 116 Z" className="fill-plan-enterprise/70" />
        <path d="M112 96 L128 124 L110 116 Z" className="fill-plan-enterprise/70" />
        <path d="M86 118 L96 146 L106 118 Z" className="fill-plan-enterprise/30" />
      </g>

      <Sparkle x={34} y={40} r={9} className="fill-plan-enterprise/45" />
      <Sparkle x={140} y={60} r={7} className="fill-plan-enterprise/40" />
      <Sparkle x={140} y={120} r={6} className="fill-plan-enterprise/30" />
    </Art>
  );
}
