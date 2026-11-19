/** @type {import('tailwindcss').Config} */
export default {
  darkMode: 'class',
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        brand: {
          50: '#eef7f8', 100: '#d5edf0', 200: '#b0dbe1',
          400: '#4fa8b5', 500: '#2f8b99', 600: '#256f7c', 700: '#1f5660',
          900: '#0b2b31',
        },
        navy: { 800: '#12212e', 900: '#0b1620', 950: '#060d14' },
      },
    },
  },
  plugins: [],
}