import { defineConfig, devices } from '@playwright/test';

const hmacKeyId = process.env.PLAYWRIGHT_API_HMAC_KEY_ID ?? 'playwright';
const hmacSecret = process.env.PLAYWRIGHT_API_HMAC_SECRET ?? 'phase-2.7-playwright-hmac-secret-32-bytes';
process.env.PLAYWRIGHT_API_HMAC_KEY_ID = hmacKeyId;
process.env.PLAYWRIGHT_API_HMAC_SECRET = hmacSecret;

export default defineConfig({
  testDir: './tests',

  fullyParallel: false,

  forbidOnly: !!process.env.CI,

  retries: process.env.CI ? 2 : 0,

  // Tests share one backend + one seeded admin user (password/profile/theme
  // mutations). Parallel workers race on that shared state; run serially.
  workers: 1,

  reporter: [['html', { open: 'never' }], ['list']],

  expect: {
    timeout: 10000,
  },

  use: {
    baseURL: process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:5173',

    headless: true,

    trace: 'on-first-retry',

    screenshot: 'only-on-failure',

    video: 'retain-on-failure',

    actionTimeout: 15000,

    navigationTimeout: 30000,
  },

  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
      },
    },
  ],

  webServer: [
    {
      command: 'npm run dev --workspace server',
      cwd: '..',
      env: {
        API_HMAC_KEYS: `${hmacKeyId}=${hmacSecret}`,
        API_HMAC_REQUIRED: 'false',
        API_DOCS_ENABLED: 'true',
      },
      url: 'http://localhost:4000/health',
      reuseExistingServer: true,
      timeout: 120000,
    },
    {
      command: 'npm run dev --workspace web',
      cwd: '..',
      url: process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:5173',
      reuseExistingServer: true,
      timeout: 120000,
    },
  ],
});
