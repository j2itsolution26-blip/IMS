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

/** A storefront with an awning, trees and a rising chart: the store growing. */
export function HeroArt({ className }: { className?: string }) {
  const stripes = Array.from({ length: 7 });
  return (
    <Art viewBox="0 0 360 150" className={className}>
      <ellipse cx="250" cy="160" rx="170" ry="52" className="fill-mint-strong/70" />
      <ellipse cx="120" cy="168" rx="120" ry="40" className="fill-mint/90" />

      {/* Rising chart */}
      {[0, 1, 2, 3].map((i) => (
        <rect key={i} x={296 + i * 15} y={112 - i * 18} width="10" height={30 + i * 18} rx="2" className="fill-primary/20" />
      ))}
      <path d="M286 96 C306 88 322 66 346 42" className="fill-none stroke-primary/45" strokeWidth="3" strokeLinecap="round" />
      <path d="M334 40 L348 39 L346 53" className="fill-none stroke-primary/45" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />

      {/* Trend badge */}
      <circle cx="58" cy="58" r="30" className="fill-mint-strong/80" />
      <path d="M43 70 L54 58 L61 64 L74 48" className="fill-none stroke-primary/70" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M66 47 L75 47 L75 56" className="fill-none stroke-primary/70" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" />

      {/* Trees behind the store */}
      <rect x="132" y="104" width="4" height="26" className="fill-primary/50" />
      <ellipse cx="134" cy="98" rx="16" ry="22" className="fill-primary/55" />
      <rect x="276" y="96" width="4" height="34" className="fill-primary/50" />
      <ellipse cx="278" cy="86" rx="18" ry="28" className="fill-primary/45" />

      {/* Store */}
      <rect x="152" y="70" width="112" height="62" rx="3" className="fill-card stroke-mint-strong" strokeWidth="2" />
      <rect x="146" y="44" width="124" height="12" rx="3" className="fill-primary" />
      {stripes.map((_, i) => (
        <g key={i}>
          <rect x={146 + i * (124 / 7)} y="56" width={124 / 7} height="16" className={i % 2 ? 'fill-card' : 'fill-primary'} />
          <circle cx={146 + (i + 0.5) * (124 / 7)} cy="72" r={124 / 14} className={i % 2 ? 'fill-card' : 'fill-primary'} />
        </g>
      ))}
      <rect x="164" y="90" width="28" height="26" rx="2" className="fill-plan-basic-tint stroke-primary/40" strokeWidth="2" />
      <rect x="224" y="90" width="28" height="26" rx="2" className="fill-plan-basic-tint stroke-primary/40" strokeWidth="2" />
      <rect x="198" y="92" width="20" height="40" rx="2" className="fill-mint stroke-primary/40" strokeWidth="2" />

      {/* Shrubs in front */}
      <circle cx="146" cy="128" r="12" className="fill-success/60" />
      <circle cx="160" cy="132" r="9" className="fill-primary/60" />
      <circle cx="272" cy="130" r="11" className="fill-success/60" />
    </Art>
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
