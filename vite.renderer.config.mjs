import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';

const PROD_CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "font-src 'self' data:",
  "media-src 'self' afterglow-media: blob:",
  "connect-src 'self'",
  "worker-src 'self' blob:",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-ancestors 'none'",
].join('; ');

const DEV_CSP = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "font-src 'self' data:",
  "media-src 'self' afterglow-media: blob:",
  "connect-src 'self' ws: http://localhost:* http://127.0.0.1:*",
  "worker-src 'self' blob:",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
].join('; ');

export default defineConfig(({ command }) => ({
  plugins: [
    react(),
    {
      name: 'afterglow-csp',
      transformIndexHtml(html) {
        const csp = command === 'serve' ? DEV_CSP : PROD_CSP;
        return html.replace(
          '<!-- AFTERGLOW_CSP -->',
          `<meta http-equiv="Content-Security-Policy" content="${csp}" />`,
        );
      },
    },
  ],
  resolve: {
    alias: {
      '@': path.resolve(process.cwd(), 'src'),
      '@shared': path.resolve(process.cwd(), 'shared'),
    },
  },
  server: {
    host: 'localhost',
    strictPort: false,
  },
  build: {
    target: 'chrome138',
    sourcemap: false,
  },
}));
