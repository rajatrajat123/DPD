/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    './src/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        aura: {
          ivory: '#F4EBDD',
          parchment: '#E9DFC9',
          black: '#151515',
          charcoal: '#292725',
          deep: '#1E1C1A',
          gold: '#C3A15B',
          'gold-light': '#D8BD7E',
          taupe: '#887E70',
          oxblood: '#702F36',
        },
      },
      fontFamily: {
        serif: ['var(--font-serif)', 'Playfair Display', 'Cormorant Garamond', 'Georgia', 'serif'],
        sans: ['var(--font-sans)', '-apple-system', 'BlinkMacSystemFont', 'Segoe UI', 'Roboto', 'sans-serif'],
      },
    },
  },
  plugins: [],
};
