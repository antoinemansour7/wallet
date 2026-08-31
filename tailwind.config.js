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
        sans:    ['Inter', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        display: ['Inter', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        mono:    ['SFMono-Regular', 'ui-monospace', 'monospace'],
      },
      colors: {
        // Quiet brokerage palette: paper, ink, sage, and restrained semantic color
        brand:           '#f5f7f4',
        'brand-light':   '#ffffff',
        surface:         '#ffffff',
        card:            '#ffffff',
        accent:          '#216b50',
        'accent-2':      '#d8e6dd',

        // Borders
        border:          '#dfe6e1',
        'border-subtle': '#e9eeea',

        // Text
        'text-primary':   '#17211d',
        'text-secondary': '#5c6b63',
        'text-muted':     '#829087',

        // Semantic
        gain:      '#34d399',
'gain-bg': '#e5f1eb',
        loss:          '#b84c49',
        'loss-bg':     '#f7e9e7',
        warning:       '#9b6b18',

        // Paper surfaces
        'wall-bg':       '#f5f7f4',
        'wall-surface':  '#ffffff',
        'wall-elevated': '#edf3ee',
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
