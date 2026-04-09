module.exports = {
  content: [
    './index.html',
    './src/**/*.{js,jsx,ts,tsx}',
  ],
  theme: {
    extend: {
      colors: {
        axis: '#2563eb',
        'axis-dark': '#1d4ed8',
        navy: {
          950: '#080e1f',
          900: '#0f1628',
          800: '#162040',
          700: '#1e2d56',
        },
        cream: {
          50: '#faf8f4',
          100: '#f5f0e8',
          200: '#ede4d3',
        },
        gold: '#c9a84c',
      },
      fontFamily: {
        sans: ['Inter', 'ui-sans-serif', 'system-ui', '-apple-system', 'Segoe UI', 'Roboto', 'Helvetica Neue', 'Arial', 'sans-serif'],
        serif: ['Playfair Display', 'Georgia', 'ui-serif', 'serif'],
      },
      boxShadow: {
        soft: '0 2px 8px rgba(15,23,42,0.06), 0 8px 24px rgba(15,23,42,0.04)',
        card: '0 4px 16px rgba(15,23,42,0.08), 0 16px 40px rgba(15,23,42,0.06)',
        glow: '0 0 40px rgba(14,165,164,0.25)',
      },
      letterSpacing: {
        widest: '0.25em',
      },
      backgroundImage: {
        'dot-grid': 'radial-gradient(circle, rgba(14,165,164,0.15) 1px, transparent 1px)',
        'dot-grid-dark': 'radial-gradient(circle, rgba(255,255,255,0.06) 1px, transparent 1px)',
        /** Header “Portal” pill — vivid sky → blue so it reads as a bright bubble everywhere. */
        'axis-portal': 'linear-gradient(180deg, #38bdf8 0%, #3b82f6 42%, #2563eb 100%)',
      },
      backgroundSize: {
        'dot-sm': '20px 20px',
        'dot-md': '28px 28px',
      },
    },
  },
  plugins: [],
}
