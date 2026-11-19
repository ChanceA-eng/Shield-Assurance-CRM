import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        base: '#F4F7FB',
        ink: '#0F1F2D',
        tide: '#16697A',
        frost: '#DCEAF5',
        accent: '#F18F01',
        // CoreUI admin palette
        cui: {
          primary: '#20a8d8',
          'primary-strong': '#087ca1',
          'primary-hover': '#066685',
          secondary: '#c8ced3',
          success: '#4dbd74',
          info: '#63c2de',
          warning: '#ffc107',
          danger: '#f86c6b',
          light: '#f1f5f9',
          dark: '#0f172a',
          body: '#edf2f7',
          panel: '#ffffff',
          text: '#172b4d',
          muted: '#526780',
          border: '#d7e2ed',
          sidebar: '#0f172a',
          'sidebar-item': '#1e293b',
          'sidebar-text': '#cbd5e1',
        },
      },
      fontFamily: {
        sans: ['Manrope', 'Segoe UI', 'sans-serif'],
      },
      boxShadow: {
        panel: '0 14px 40px rgba(15, 31, 45, 0.12)',
        card: '0 2px 8px rgba(15, 23, 42, 0.05)',
      },
      keyframes: {
        riseIn: {
          '0%': { opacity: '0', transform: 'translateY(12px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
      },
      animation: {
        riseIn: 'riseIn 0.45s ease-out both',
      },
    },
  },
  plugins: [],
};

export default config;
