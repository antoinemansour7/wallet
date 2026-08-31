/** @type {import('tailwindcss').Config} */
// Modern dark fintech theme (Revolut/Linear style): true near-black neutrals,
// glassy surfaces, electric indigo→violet gradient accents.
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      fontFamily: {
        sans:    ['the-future', 'Inter', 'system-ui', 'sans-serif'],
        display: ['the-future', 'Inter', 'system-ui', 'sans-serif'],
        mono:    ['SF Mono', 'ui-monospace', 'monospace'],
      },
      colors: {
        // Core palette — neutral near-black, no warm tint
        brand:           '#0a0a0c',
        'brand-light':   '#fafafa',
        surface:         '#141417',
        card:            '#141417',
        accent:          '#ffffff',
        'accent-2':      '#d4d4d8',

        // Borders
        border:          '#26262b',
        'border-subtle': '#1c1c21',

        // Text
        'text-primary':   '#ffffff',
        'text-secondary': '#9ca0a8',
        'text-muted':     '#696e79',

        // Semantic
        gain:      '#34d399',
        'gain-bg': '#0b201a',
        loss:      '#fb7185',
        'loss-bg': '#251218',
        warning:   '#fbbf24',

        // Dark surfaces
        'wall-bg':       '#0a0a0c',
        'wall-surface':  '#141417',
        'wall-elevated': '#1a1a1f',
      },
      borderRadius: {
        card: '20px',
        pill: '9999px',
      },
      boxShadow: {
        'card':       '0 1px 2px rgba(0,0,0,0.4), 0 8px 24px -12px rgba(0,0,0,0.5)',
        'card-hover': '0 2px 4px rgba(0,0,0,0.4), 0 16px 40px -12px rgba(0,0,0,0.6)',
        'glow':       '0 0 28px rgba(255,255,255,0.10)',
        'glow-sm':    '0 0 14px rgba(255,255,255,0.06)',
      },
      backgroundImage: {
        // Monochrome "primary" — near-white with a hint of depth (Vercel-style)
        'gradient-accent': 'linear-gradient(180deg, #ffffff 0%, #ededed 100%)',
      },
      transitionTimingFunction: {
        ws: 'cubic-bezier(0.76, 0, 0.24, 1)',
      },
      transitionDuration: {
        ws: '350ms',
      },
      animation: {
        'spin-slow':  'spin 1.5s linear infinite',
        'pulse-slow': 'pulse 3s ease-in-out infinite',
        'fade-in':    'fadeIn 0.35s cubic-bezier(0.76, 0, 0.24, 1)',
      },
      keyframes: {
        fadeIn: {
          '0%':   { opacity: '0', transform: 'translateY(8px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
      },
    },
  },
  plugins: [],
}
