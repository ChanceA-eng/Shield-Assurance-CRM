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
      },
      fontFamily: {
        sans: ['Manrope', 'Segoe UI', 'sans-serif'],
      },
      boxShadow: {
        panel: '0 14px 40px rgba(15, 31, 45, 0.12)',
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
