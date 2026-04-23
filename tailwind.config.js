/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
        mono: ['JetBrains Mono', 'Fira Code', 'ui-monospace', 'monospace'],
      },
      colors: {
        brand:          '#1c1c1c',
        'brand-light':  '#f4f4f5',
        surface:        '#fafbfc',
        card:           '#ffffff',
        border:         '#e4e4e7',
        'border-subtle':'#f4f4f5',
        'text-primary': '#18181b',
        'text-secondary':'#52525b',
        'text-muted':   '#a1a1aa',
        gain:           '#0d9488',
        'gain-bg':      '#f0fdfa',
        loss:           '#dc2626',
        'loss-bg':      '#fef2f2',
      },
      boxShadow: {
        'card':       '0 1px 3px rgba(0,0,0,0.06), 0 1px 2px rgba(0,0,0,0.04)',
        'card-hover': '0 4px 12px rgba(0,0,0,0.08), 0 1px 3px rgba(0,0,0,0.04)',
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
