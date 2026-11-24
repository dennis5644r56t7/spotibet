import type { Config } from 'tailwindcss';

const config: Config = {
  content: [
    './src/pages/**/*.{js,ts,jsx,tsx,mdx}',
    './src/components/**/*.{js,ts,jsx,tsx,mdx}',
    './src/app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        background: '#f4f5f8',
        surface: '#ffffff',
        surfaceDark: '#f8f9fb',
        card: '#ffffff',
        hairline: '#e6e8ee',
        ink: {
          DEFAULT: '#0d1424',
          body: '#33405a',
          soft: '#64708a',
          muted: '#97a1b4',
        },
        primary: {
          DEFAULT: '#dc1c34', // Spotibet signature crimson
          hover: '#f02840',
          dark: '#b3142a',
          light: '#ff4d63',
          soft: '#fdecef',
        },
        silver: {
          DEFAULT: '#e2e8f0',
          light: '#f8fafc',
          chrome: '#cbd5e1',
        },
        gold: {
          DEFAULT: '#d4af37',
          glow: '#fbbf24',
          bright: '#f59e0b',
        },
        accentGreen: {
          DEFAULT: '#10b981',
          hover: '#059669',
        },
        accentPurple: {
          DEFAULT: '#8b5cf6',
        },
      },
      boxShadow: {
        card: '0 1px 2px rgba(16,24,40,0.04), 0 8px 24px -12px rgba(16,24,40,0.16)',
        pop: '0 12px 40px -12px rgba(16,24,40,0.24), 0 2px 8px rgba(16,24,40,0.06)',
      },
      fontFamily: {
        mono: ['JetBrains Mono', 'monospace'],
      },
      animation: {
        'pulse-fast': 'pulse 1s cubic-bezier(0.4, 0, 0.6, 1) infinite',
        'bounce-short': 'bounce 0.6s infinite',
      },
    },
  },
  plugins: [],
};

export default config;
