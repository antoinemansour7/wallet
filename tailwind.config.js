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
      },
      colors: {
        wall: {
          bg:       '#060E1E',
          surface:  '#0D1729',
          elevated: '#142139',
          border:   'rgba(255,255,255,0.07)',
        },
      },
      animation: {
        'spin-slow': 'spin 1.5s linear infinite',
        'pulse-slow': 'pulse 3s ease-in-out infinite',
      },
    },
  },
  plugins: [],
}
