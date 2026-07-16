import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  retries: process.env.CI ? 2 : 0,
  reporter: [['html', { open: 'never' }], ['junit', { outputFile: 'test-results/junit.xml' }]],
  expect: {
    timeout: 5000
  },
  use: {
    baseURL: 'http://127.0.0.1:3000',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure'
  },
  // test:e2e provisions Chromium only; keep device coverage on that supported browser dependency.
  projects: [
    {
      name: 'desktop-chromium',
      use: { browserName: 'chromium' },
      testIgnore: /mobile-intake\.spec\.ts/
    },
    {
      name: 'mobile-chrome',
      use: { ...devices['Pixel 5'] },
      testMatch: /mobile-intake\.spec\.ts/
    },
    {
      name: 'mobile-widget-chromium',
      use: { ...devices['Pixel 5'] },
      testMatch: /widget\.spec\.ts/
    }
  ],
  webServer: {
    command: 'npm run build && npm run start -- --hostname 127.0.0.1 --port 3000',
    url: 'http://127.0.0.1:3000',
    env: {
      ...process.env,
      CALENDLY_URL: 'https://calendly.com/balance/test'
    },
    reuseExistingServer: !process.env.CI,
    timeout: 180000
  }
});
