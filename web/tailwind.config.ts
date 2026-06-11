import type { Config } from 'tailwindcss';

// Design tokens mirror docs/design/design-system.md. We re-declare them
// here so Tailwind can power utility classes (bg-bg-1, text-secondary,
// etc) in addition to CSS variables consumed via var(--bg-1).
const config: Config = {
  content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}', './lib/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        'bg-0': '#08080a',
        'bg-1': '#131316',
        'bg-2': '#1c1c20',
        'bg-3': '#26262b',
        'bg-4': '#2e2e34',
        'bg-canvas': '#0e0e11',
        'bg-canvas-checker': '#1a1a1e',
        'border-subtle': '#2e2e34',
        'border-default': '#3a3a42',
        'border-strong': '#4a4a54',
        'text-primary': '#e8e8eb',
        'text-secondary': '#a3a3a9',
        'text-tertiary': '#6b6b73',
        'text-inverse': '#0a0a0c',
        'accent-400': '#38bdf8',
        'accent-500': '#0ea5e9',
        'accent-600': '#0284c7',
        success: '#10b981',
        warning: '#f59e0b',
        danger: '#ef4444',
        info: '#38bdf8',
      },
      fontFamily: {
        sans: ['Inter', '-apple-system', 'BlinkMacSystemFont', 'Segoe UI', 'sans-serif'],
        mono: ['SF Mono', 'Monaco', 'Consolas', 'Liberation Mono', 'monospace'],
      },
      fontSize: {
        xs: ['10px', '14px'],
        sm: ['11px', '16px'],
        base: ['13px', '18px'],
        md: ['14px', '20px'],
        lg: ['16px', '22px'],
      },
      spacing: {
        '1': '2px',
        '2': '4px',
        '3': '8px',
        '4': '12px',
        '5': '16px',
        '6': '24px',
        '7': '32px',
        '8': '48px',
      },
    },
  },
  plugins: [],
};

export default config;
