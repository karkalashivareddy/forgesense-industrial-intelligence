import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    globals: false,
    include: ['test/**/*.test.{ts,tsx}'],
    reporters: 'default',
    coverage: { reporter: ['text', 'html'] },
  },
});
