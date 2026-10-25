import type { Config } from 'tailwindcss';
// Imported rather than require()'d: this file is an ES module, and Next loads
// it as one — `require` is not defined here, which fails the whole CSS build.
import animate from 'tailwindcss-animate';

const config: Config = {
  darkMode: ['class'],
  content: ['./src/**/*.{js,ts,jsx,tsx,mdx}'],
  theme: {
    container: {
      center: true,
      padding: '1.5rem',
      screens: { '2xl': '1400px' },
    },
    extend: {
      colors: {
        border: 'hsl(var(--border))',
        input: 'hsl(var(--input))',
        ring: 'hsl(var(--ring))',
        background: 'hsl(var(--background))',
        foreground: 'hsl(var(--foreground))',
        primary: {
          DEFAULT: 'hsl(var(--primary))',
          foreground: 'hsl(var(--primary-foreground))',
        },
        secondary: {
          DEFAULT: 'hsl(var(--secondary))',
          foreground: 'hsl(var(--secondary-foreground))',
        },
        // `text` is the status colour for words and figures. The DEFAULT hues
        // stay vivid for dots, bars and fills, but as text on white they fall
        // to ~2:1, so text uses its own darker (light) / lighter (dark) step.
        destructive: {
          DEFAULT: 'hsl(var(--destructive))',
          foreground: 'hsl(var(--destructive-foreground))',
          text: 'hsl(var(--destructive-text))',
        },
        success: {
          DEFAULT: 'hsl(var(--success))',
          foreground: 'hsl(var(--success-foreground))',
          text: 'hsl(var(--success-text))',
        },
        warning: {
          DEFAULT: 'hsl(var(--warning))',
          foreground: 'hsl(var(--warning-foreground))',
          text: 'hsl(var(--warning-text))',
        },
        info: {
          DEFAULT: 'hsl(var(--info))',
          text: 'hsl(var(--info-text))',
        },
        'plan-basic': {
          DEFAULT: 'hsl(var(--plan-basic))',
          text: 'hsl(var(--plan-basic-text))',
          tint: 'hsl(var(--plan-basic-tint))',
          border: 'hsl(var(--plan-basic-border))',
        },
        'plan-enterprise': {
          DEFAULT: 'hsl(var(--plan-enterprise))',
          text: 'hsl(var(--plan-enterprise-text))',
          tint: 'hsl(var(--plan-enterprise-tint))',
          border: 'hsl(var(--plan-enterprise-border))',
        },
        'sec-subscription': {
          DEFAULT: 'hsl(var(--sec-subscription))',
          text: 'hsl(var(--sec-subscription-text))',
          tint: 'hsl(var(--sec-subscription-tint))',
        },
        'sec-usage': {
          DEFAULT: 'hsl(var(--sec-usage))',
          text: 'hsl(var(--sec-usage-text))',
          tint: 'hsl(var(--sec-usage-tint))',
        },
        'sec-invoices': {
          DEFAULT: 'hsl(var(--sec-invoices))',
          text: 'hsl(var(--sec-invoices-text))',
          tint: 'hsl(var(--sec-invoices-tint))',
        },
        'sec-payments': {
          DEFAULT: 'hsl(var(--sec-payments))',
          text: 'hsl(var(--sec-payments-text))',
          tint: 'hsl(var(--sec-payments-tint))',
        },
        'sec-history': {
          DEFAULT: 'hsl(var(--sec-history))',
          text: 'hsl(var(--sec-history-text))',
          tint: 'hsl(var(--sec-history-tint))',
        },
        'sec-plans': {
          DEFAULT: 'hsl(var(--sec-plans))',
          text: 'hsl(var(--sec-plans-text))',
          tint: 'hsl(var(--sec-plans-tint))',
        },
        mint: {
          DEFAULT: 'hsl(var(--mint))',
          strong: 'hsl(var(--mint-strong))',
        },
        muted: {
          DEFAULT: 'hsl(var(--muted))',
          foreground: 'hsl(var(--muted-foreground))',
        },
        accent: {
          DEFAULT: 'hsl(var(--accent))',
          foreground: 'hsl(var(--accent-foreground))',
        },
        popover: {
          DEFAULT: 'hsl(var(--popover))',
          foreground: 'hsl(var(--popover-foreground))',
        },
        card: {
          DEFAULT: 'hsl(var(--card))',
          foreground: 'hsl(var(--card-foreground))',
        },
        sidebar: {
          DEFAULT: 'hsl(var(--sidebar-background))',
          foreground: 'hsl(var(--sidebar-foreground))',
          'muted-foreground': 'hsl(var(--sidebar-muted-foreground))',
          accent: 'hsl(var(--sidebar-accent))',
          border: 'hsl(var(--sidebar-border))',
        },
        // Series colours are stored as literal hex (not HSL channels) because
        // they are a validated, hand-picked set — not derived from the theme.
        chart: {
          1: 'var(--chart-1)',
          2: 'var(--chart-2)',
          3: 'var(--chart-3)',
          4: 'var(--chart-4)',
          5: 'var(--chart-5)',
          6: 'var(--chart-6)',
          grid: 'var(--chart-grid)',
          axis: 'var(--chart-axis)',
          label: 'var(--chart-label)',
        },
      },
      borderRadius: {
        // Card surfaces: 16px on phones, 20px from the sm breakpoint up.
        card: 'var(--radius-card)',
        xl: 'calc(var(--radius) + 2px)',
        lg: 'var(--radius)',
        md: 'calc(var(--radius) - 2px)',
        sm: 'calc(var(--radius) - 4px)',
      },
      // Tailwind 3 has no `xs`/`2xs` steps, so classes using them compiled to
      // nothing. They are defined here as theme tokens: dark mode flattens
      // them, where elevation reads from the surface colour instead.
      boxShadow: {
        '2xs': 'var(--shadow-2xs)',
        xs: 'var(--shadow-xs)',
        card: 'var(--shadow-card)',
      },
      // The type scale for headings that recur on every screen. Each step
      // carries its own line height, tracking and weight so call sites can't
      // drift apart.
      fontSize: {
        title: ['1.375rem', { lineHeight: '1.75rem', letterSpacing: '-0.015em', fontWeight: '700' }],
        'title-lg': ['1.625rem', { lineHeight: '2rem', letterSpacing: '-0.02em', fontWeight: '700' }],
        // Dashboard titles scale with the viewport — 24px on a phone, ~28px on a tablet, up to
        // 32px from about 1200px — so no breakpoint jumps between devices.
        display: ['clamp(1.5rem, 1.2rem + 1.1vw, 2rem)', { lineHeight: '1.15', letterSpacing: '-0.025em', fontWeight: '700' }],
        kpi: ['1.625rem', { lineHeight: '1', letterSpacing: '-0.02em', fontWeight: '700' }],
      },
      keyframes: {
        'accordion-down': {
          from: { height: '0' },
          to: { height: 'var(--radix-accordion-content-height)' },
        },
        'accordion-up': {
          from: { height: 'var(--radix-accordion-content-height)' },
          to: { height: '0' },
        },
        // Sweeps a full-height track so the line inside it travels the frame
        // with transform alone — no layout work while the camera decodes.
        'scan-line': {
          from: { transform: 'translateY(4%)' },
          to: { transform: 'translateY(96%)' },
        },
      },
      animation: {
        'accordion-down': 'accordion-down 0.2s ease-out',
        'accordion-up': 'accordion-up 0.2s ease-out',
        'scan-line': 'scan-line 1.6s ease-in-out infinite alternate',
      },
    },
  },
  plugins: [animate],
};

export default config;
