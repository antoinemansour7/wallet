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
        wall: {
          bg:       '#F8F6F1',
          surface:  '#FFFFFF',
          elevated: '#F2EFE9',
          border:   'rgba(0,0,0,0.08)',
          green:    '#1A5C3A',
          'green-light': '#EBF5EE',
        },
      },
      boxShadow: {
        'card':       '0 1px 3px rgba(0,0,0,0.06), 0 1px 2px rgba(0,0,0,0.04)',
        'card-hover': '0 4px 12px rgba(0,0,0,0.1), 0 1px 3px rgba(0,0,0,0.06)',
        'glow-green': '0 0 20px -5px rgba(26,92,58,0.2)',
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
