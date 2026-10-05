const puppeteer = require('puppeteer');

(async () => {
  try {
    console.log('Launching browser...');
    const browser = await puppeteer.launch();
    const page = await browser.newPage();
    
    console.log('Navigating to example.com...');
    await page.goto('https://example.com');
    
    const title = await page.title();
    console.log(`Page title: ${title}`);
    
    await browser.close();
    console.log('Puppeteer is working correctly!');
  } catch (error) {
    console.error('Puppeteer error:', error);
    process.exit(1);
  }
})();
