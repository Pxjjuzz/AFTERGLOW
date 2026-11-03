/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        void: '#07060B',
        stage: '#030207',
        surface: '#100D17',
        ink: '#F5F0FF',
        muted: '#A49AB8',
        violet: '#9B6BFF',
        starlight: '#DCCBFF',
      },
      fontFamily: {
        display: ['"Cormorant Garamond"', 'Georgia', 'serif'],
        sans: ['Manrope', 'Segoe UI', 'sans-serif'],
      },
      letterSpacing: {
        wordmark: '0.42em',
        wide: '0.22em',
      },
    },
  },
  plugins: [],
};
