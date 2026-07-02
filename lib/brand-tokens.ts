export const brandTokens = {
  colors: {
    baseBlack: '#101010',
    charcoal: '#1d1d1d',
    warmGold: '#dbb580',
    lightGold: '#ffd293',
    lightText: '#f2f2f2',
    mutedText: 'rgba(242, 242, 242, 0.72)',
    border: 'rgba(219, 181, 128, 0.24)',
    subtleBorder: 'rgba(219, 181, 128, 0.18)',
    panelSurface: 'rgba(29, 29, 29, 0.82)',
    overlay: 'rgba(0, 0, 0, 0.7)'
  },
  gradients: {
    panel: 'linear-gradient(180deg, #101010 0%, #1d1d1d 100%)'
  },
  typography: {
    ui: '"Futura PT", Arial, sans-serif',
    condensed: '"Futura PT Condensed", Arial, sans-serif',
    editorial: 'Calluna, Georgia, serif'
  },
  spacing: {
    panelPadding: '1.25rem'
  },
  shadows: {
    panel: '0 24px 80px rgba(0, 0, 0, 0.45)'
  },
  copy: {
    name: 'Balance Assist',
    tagline: 'AI-assisted project onboarding. Human-led outcomes.',
    description: 'AI-assisted project onboarding for Balance. Human review is available at any point.',
    primaryCta: 'Start your project brief',
    humanCta: 'Talk to a human'
  }
} as const;
