/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      fontFamily: {
        sans:    ['Inter', 'system-ui', 'sans-serif'],
        display: ['Inter', 'system-ui', 'sans-serif'],
        mono:    ['SF Mono', 'ui-monospace', 'monospace'],
      },
      colors: {
        // Core palette — neutral dark
        brand:           '#0f1113',
        'brand-light':   '#f8f8f8',
        surface:         '#ffffff',
        card:            '#ffffff',

        // Borders
        border:          '#2a2d31',
        'border-subtle': '#1e2124',

        // Text
        'text-primary':   '#f0f0f0',
        'text-secondary': '#8b8f94',
        'text-muted':     '#5c6066',

        // Semantic
        gain:      '#4ade80',
        'gain-bg': '#0f2419',
        loss:      '#f87171',
        'loss-bg': '#2a1215',

        // Dark surfaces
        'wall-bg':      '#0f1113',
        'wall-surface': '#181b1e',
        'wall-elevated': '#22262a',
      },
      borderRadius: {
        card: '16px',
        pill: '9999px',
      },
      boxShadow: {
        'card':       '0 1px 3px rgba(0,0,0,0.3)',
        'card-hover': '0 4px 16px rgba(0,0,0,0.4)',
        'glow':       '0 0 24px rgba(74,222,128,0.06)',
      },
      animation: {
        'spin-slow':  'spin 1.5s linear infinite',
        'pulse-slow': 'pulse 3s ease-in-out infinite',
        'fade-in':    'fadeIn 0.25s ease-out',
      },
      keyframes: {
        fadeIn: {
          '0%':   { opacity: '0', transform: 'translateY(4px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
      },
    },
  },
  plugins: [],
}
