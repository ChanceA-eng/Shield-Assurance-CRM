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
          secondary: '#c8ced3',
          success: '#4dbd74',
          info: '#63c2de',
          warning: '#ffc107',
          danger: '#f86c6b',
          light: '#f0f3f5',
          dark: '#2f353a',
          body: '#e4e5e6',
          text: '#23282c',
          muted: '#73818f',
          border: '#c8ced3',
          sidebar: '#2f353a',
          'sidebar-item': '#3a4149',
          'sidebar-text': '#c2cfd6',
        },
      },
      fontFamily: {
        sans: ['Manrope', 'Segoe UI', 'sans-serif'],
      },
      boxShadow: {
        panel: '0 14px 40px rgba(15, 31, 45, 0.12)',
        card: '0 1px 1px rgba(0, 0, 0, 0.1)',
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
