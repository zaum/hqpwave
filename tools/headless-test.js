const puppeteer = require('puppeteer');

(async () => {
  const url = 'http://localhost:8000';
  const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox'] });
  const page = await browser.newPage();

  page.on('console', msg => {
    try {
      const args = msg.args();
      Promise.all(args.map(a => a.jsonValue())).then(vals => {
        console.log('PAGE_CONSOLE:', msg.type(), vals.join(' '));
      }).catch(() => console.log('PAGE_CONSOLE:', msg.type(), msg.text()));
    } catch (e) {
      console.log('PAGE_CONSOLE:', msg.type(), msg.text());
    }
  });

  page.on('dialog', async d => {
    console.log('PAGE_DIALOG:', d.type(), d.message());
    try { await d.dismiss(); } catch (e) { /* ignore */ }
  });

  page.on('pageerror', err => console.log('PAGE_ERROR:', err.toString()));

  try {
    page.setDefaultNavigationTimeout(30000);
    const resp = await page.goto(url, { waitUntil: 'load', timeout: 30000 });
    console.log('NAV_STATUS:', resp && resp.status());
    // wait a bit for any late logs
    await new Promise((resolve) => setTimeout(resolve, 2000));
    // Inspect progress thumb computed width
    try {
      const thumbInfo = await page.evaluate(() => {
        const el = document.querySelector('#playProgressThumb');
        if (!el) return { exists: false };
        const cs = window.getComputedStyle(el);
        return {
          exists: true,
          widthCss: cs.width,
          widthInline: el.style.width || null,
          classes: el.className
        };
      });
      console.log('PROGRESS_INFO:', JSON.stringify(thumbInfo));
    } catch (e) {
      console.error('PROGRESS_INSPECT_ERROR:', e.toString());
    }
  } catch (e) {
    console.error('NAV_ERROR:', e.toString());
  }

  await browser.close();
})();
