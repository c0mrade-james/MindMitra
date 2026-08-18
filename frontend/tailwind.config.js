/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        teal: {
          50: '#eef5f3',
          100: '#d3e6e0',
          200: '#a7cdc1',
          300: '#7bb3a1',
          400: '#4f9a82',
          500: '#2d7863',
          600: '#1f4b43',
          700: '#173a34',
          800: '#102826',
          900: '#0a1817',
        },
        sand: {
          50: '#faf8f3',
          100: '#f3efe4',
          200: '#e8e1cf',
          300: '#d9cdaf',
        },
        amber: {
          400: '#eab567',
          500: '#e0a458',
          600: '#c98a3d',
        },
        clay: {
          500: '#b5654a',
          600: '#9c4f37',
        },
      },
      fontFamily: {
        display: ['"Atkinson Hyperlegible Next"', 'sans-serif'],
        body: ['"Atkinson Hyperlegible Next"', 'sans-serif'],
      },
      boxShadow: {
        soft: '0 4px 24px -4px rgba(31, 75, 67, 0.12)',
        card: '0 2px 12px -2px rgba(31, 75, 67, 0.08)',
      },
      borderRadius: {
        '2xl': '1.25rem',
        '3xl': '1.75rem',
      },
    },
  },
  plugins: [require('daisyui')],
  daisyui: {
    themes: [
      {
        mindmitra: {
          primary: '#1F4B43',
          secondary: '#E0A458',
          accent: '#7BB3A1',
          neutral: '#173A34',
          'base-100': '#FAF8F3',
          info: '#4F9A82',
          success: '#2D7863',
          warning: '#E0A458',
          error: '#B5654A',
        },
      },
      'dark',
    ],
    darkTheme: 'dark',
  },
};
