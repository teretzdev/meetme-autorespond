import logger from '../utils/logger.js';

async function navigateToHomepage(page) {
  logger.info('Navigating to MeetMe homepage');
  await page.goto('https://www.meetme.com', { waitUntil: 'networkidle2', timeout: 30000 });
  logger.info(`Page loaded. Current URL: ${page.url()}`);
}

async function navigateToMeetPage(page) {
  logger.info('Navigating to #meet page...');
  const maxAttempts = 3;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      await page.goto('https://beta.meetme.com/#meet', { waitUntil: 'networkidle2', timeout: 60000 });
      await page.waitForSelector('.filter-bar-header', { timeout: 30000 });
      logger.info('Successfully navigated to #meet page');
      return;
    } catch (error) {
      logger.warn(`Attempt ${attempt} to navigate to #meet page failed: ${error.message}`);
      if (attempt === maxAttempts) {
        throw new Error('Failed to navigate to #meet page after multiple attempts');
      }
    }
  }
}

async function navigateToChatPage(page) {
    try {
        logger.info('Navigating to chat page');
        await page.goto('https://www.meetme.com/#chat', { waitUntil: 'networkidle2' });
        logger.info('Navigation initiated. Waiting for page load...');

        await page.waitForSelector('#chat-section', { visible: true, timeout: 30000 });

        const currentUrl = await page.url();
        logger.info(`Page loaded. Current URL: ${currentUrl}`);

        const isChatPage = await page.evaluate(() => {
            return window.location.hash === '#chat' && !!document.querySelector('#chat-section');
        });

        if (!isChatPage) {
            logger.error('Failed to load chat page content');
            throw new Error('Chat page content not found');
        }

        logger.info('Chat page loaded successfully');
        return true;
    } catch (error) {
        logger.error(`Error navigating to chat page: ${error.message}`);
        const currentUrl = await page.url();
        logger.error(`Current URL after navigation attempt: ${currentUrl}`);
        const pageContent = await page.content();
        logger.error(`Current page content: ${pageContent.substring(0, 500)}...`);
        return false;
    }
}

export { navigateToHomepage, navigateToMeetPage, navigateToChatPage };