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
        display: ['Plus Jakarta Sans', 'Inter', 'system-ui', 'sans-serif'],
        mono:    ['JetBrains Mono', 'Fira Code', 'ui-monospace', 'monospace'],
      },
      colors: {
        // Primary — Revolut Dark + White
        brand:           '#191c1f',   // Revolut Dark
        'brand-light':   '#f4f4f4',   // Light Surface
        surface:         '#ffffff',   // Pure white page bg
        card:            '#ffffff',   // Card bg

        // Borders
        border:          '#c9c9cd',   // Revolut grey-tone-20
        'border-subtle': '#f4f4f4',

        // Text
        'text-primary':   '#191c1f',  // Revolut Dark
        'text-secondary': '#505a63',  // Mid Slate
        'text-muted':     '#8d969e',  // Cool Gray

        // Semantic — Revolut teal & danger
        gain:      '#00a87e',         // Revolut Teal
        'gain-bg': '#e6f7f2',
        loss:      '#e23b4a',         // Revolut Danger
        'loss-bg': '#fdf2f3',

        // Dark surfaces — Research page dark theme
        'wall-bg':      '#191c1f',    // Revolut Dark (page bg)
        'wall-surface': '#22272b',    // Elevated dark surface (cards)
      },
      borderRadius: {
        card: '20px',     // Revolut card radius
        pill: '9999px',   // Revolut pill radius
      },
      boxShadow: {
        // Revolut uses ZERO shadows — depth through contrast
        'card':       'none',
        'card-hover': 'none',
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
