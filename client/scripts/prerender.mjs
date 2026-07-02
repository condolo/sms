/**
 * Msingi SSG — Postbuild Pre-render Script
 *
 * Spins up a local static server pointing at dist/, visits each public route
 * with headless Chromium (Puppeteer), and writes the fully-rendered HTML back
 * to dist/<route>/index.html.
 *
 * AI bots (GPTBot, PerplexityBot, ClaudeBot) that don't execute JS get real
 * content immediately. Real users get the normal React SPA via hydration.
 *
 * Usage:
 *   npm run build:ssg          # vite build + prerender in one step
 *   npm run prerender          # prerender only (after a build already exists)
 */

import puppeteer from 'puppeteer';
import http      from 'http';
import fs        from 'fs';
import path      from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DIST_DIR  = path.resolve(__dirname, '../dist');
const PORT      = 4174; // avoid conflict with vite preview (4173)

// Public routes to pre-render
const ROUTES = [
  '/',
  '/why', '/about', '/platform', '/pricing', '/security',
  '/difference', '/why-choose', '/roadmap', '/implementation',
  '/solutions/principal', '/solutions/teacher', '/solutions/finance',
  '/solutions/parent', '/solutions/admissions',
  '/plans', '/faq', '/contact', '/privacy', '/terms',
  '/legal/dpa', '/legal/sla', '/legal/accessibility', '/legal/responsible-ai',
];

const MIME_MAP = {
  '.html':  'text/html; charset=utf-8',
  '.js':    'application/javascript',
  '.css':   'text/css',
  '.svg':   'image/svg+xml',
  '.png':   'image/png',
  '.jpg':   'image/jpeg',
  '.jpeg':  'image/jpeg',
  '.ico':   'image/x-icon',
  '.json':  'application/json',
  '.txt':   'text/plain',
  '.xml':   'application/xml',
  '.woff':  'font/woff',
  '.woff2': 'font/woff2',
};

// ── Static file server ─────────────────────────────────────────────────────
function startServer() {
  const server = http.createServer((req, res) => {
    const urlPath = req.url.split('?')[0].split('#')[0];
    let filePath  = path.join(DIST_DIR, urlPath);

    // SPA fallback: directory or missing file → serve index.html
    try {
      if (fs.statSync(filePath).isDirectory()) {
        filePath = path.join(filePath, 'index.html');
      }
    } catch {
      filePath = path.join(DIST_DIR, 'index.html');
    }
    if (!fs.existsSync(filePath)) {
      filePath = path.join(DIST_DIR, 'index.html');
    }

    const mime = MIME_MAP[path.extname(filePath).toLowerCase()] ?? 'application/octet-stream';
    try {
      res.writeHead(200, { 'Content-Type': mime });
      res.end(fs.readFileSync(filePath));
    } catch {
      res.writeHead(500);
      res.end('Internal server error');
    }
  });

  return new Promise((resolve, reject) => {
    server.on('error', reject);
    server.listen(PORT, '127.0.0.1', () => resolve(server));
  });
}

// ── Main ───────────────────────────────────────────────────────────────────
async function prerender() {
  console.log('\n🔍  Msingi SSG — pre-rendering public pages\n');

  if (!fs.existsSync(DIST_DIR)) {
    console.error('❌  dist/ not found — run "npm run build" first.');
    process.exit(1);
  }

  const server  = await startServer();
  const browser = await puppeteer.launch({
    headless: true,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-gpu',
    ],
  });

  const baseUrl = `http://127.0.0.1:${PORT}`;
  console.log(`  Static server: ${baseUrl}\n`);

  const results = [];

  try {
    for (const route of ROUTES) {
      const page = await browser.newPage();

      // Intercept API calls — respond with empty JSON so the app uses
      // its built-in CMS_DEFAULTS instead of failing with a network error.
      await page.setRequestInterception(true);
      page.on('request', req => {
        if (req.url().includes('/api/')) {
          req.respond({
            status:      200,
            contentType: 'application/json',
            body:        '{}',
          });
        } else {
          req.continue();
        }
      });

      // Silence console noise during prerender
      page.on('console', () => {});
      page.on('pageerror', () => {});

      await page.goto(`${baseUrl}${route}`, {
        waitUntil: 'networkidle0',
        timeout:   30_000,
      });

      // Allow Framer Motion entrance animations to settle
      await new Promise(r => setTimeout(r, 900));

      const html = await page.content();

      // Write output
      const routePath  = route === '/' ? 'index.html' : `${route.replace(/^\//, '')}/index.html`;
      const outputPath = path.join(DIST_DIR, routePath);

      fs.mkdirSync(path.dirname(outputPath), { recursive: true });
      fs.writeFileSync(outputPath, html, 'utf-8');

      const kb = (html.length / 1024).toFixed(1);
      console.log(`  ✅  ${route.padEnd(12)}  →  dist/${routePath}  (${kb} kB)`);
      results.push({ route, outputPath, kb });

      await page.close();
    }
  } finally {
    await browser.close();
    server.close();
  }

  console.log(`\n✅  Pre-render complete — ${results.length} pages written to dist/\n`);
  console.log('  Bots get static HTML immediately.');
  console.log('  Users get the full React SPA via progressive hydration.\n');
}

prerender().catch(err => {
  console.error('\n❌  Pre-render failed:', err.message);
  process.exit(1);
});
