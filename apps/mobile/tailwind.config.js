/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}'],
  presets: [require('nativewind/preset')],
  theme: {
    extend: {
      colors: {
        brand: {
          50: '#eef9f3',
          100: '#d5f0e1',
          500: '#10b981', // primary mint
          600: '#059669',
          700: '#047857',
        },
        surface: {
          DEFAULT: '#ffffff',
          muted: '#f5f7f6',
        },
      },
      fontFamily: {
        sans: ['IBM Plex Sans Thai', 'System'],
      },
    },
  },
  plugins: [],
};
