/** @type {import('tailwindcss').Config} */
// Modern dark fintech theme (Revolut/Linear style): true near-black neutrals,
// glassy surfaces, electric indigo→violet gradient accents.
const themeColor = (name) => `rgb(var(${name}) / <alpha-value>)`

export default {
  darkMode: 'class',
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
        ink:             themeColor('--color-ink'),
        brand:           themeColor('--color-brand'),
        'brand-light':   themeColor('--color-brand-light'),
        surface:         themeColor('--color-surface'),
        card:            themeColor('--color-card'),
        accent:          themeColor('--color-accent'),
        'accent-2':      themeColor('--color-accent-2'),

        // Borders
        border:          themeColor('--color-border'),
        'border-subtle': themeColor('--color-border-subtle'),

        // Text
        'text-primary':   themeColor('--color-text-primary'),
        'text-secondary': themeColor('--color-text-secondary'),
        'text-muted':     themeColor('--color-text-muted'),

        // Semantic
        gain:          themeColor('--color-gain'),
        'gain-bg':     themeColor('--color-gain-bg'),
        loss:          themeColor('--color-loss'),
        'loss-bg':     themeColor('--color-loss-bg'),
        warning:       themeColor('--color-warning'),

        // Paper surfaces
        'wall-bg':       themeColor('--color-wall-bg'),
        'wall-surface':  themeColor('--color-wall-surface'),
        'wall-elevated': themeColor('--color-wall-elevated'),
      },
      borderRadius: {
        card: '20px',
        pill: '9999px',
      },
      boxShadow: {
        'card':       '0 1px 2px rgba(0,0,0,0.4), 0 8px 24px -12px rgba(0,0,0,0.5)',
        'card-hover': '0 2px 4px rgba(0,0,0,0.4), 0 16px 40px -12px rgba(0,0,0,0.6)',
        'modal':      '0 24px 64px -16px rgba(0,0,0,0.35), 0 4px 16px -4px rgba(0,0,0,0.15)',
        'glow':       '0 0 28px rgba(255,255,255,0.10)',
        'glow-sm':    '0 0 14px rgba(255,255,255,0.06)',
      },
      backgroundImage: {
        // Monochrome "primary" — near-white with a hint of depth (Vercel-style)
        'gradient-accent': 'linear-gradient(180deg, #ffffff 0%, #ededed 100%)',
      },
      transitionTimingFunction: {
        DEFAULT: 'var(--motion-ease)',
        motion: 'var(--motion-ease)',
      },
      transitionDuration: {
        DEFAULT: 'var(--motion-duration-short)',
        'motion-short': 'var(--motion-duration-short)',
        'motion-long': 'var(--motion-duration-long)',
      },
    },
  },
  plugins: [],
}
