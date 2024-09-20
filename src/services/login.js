

// login.js
import logger from '../utils/logger.js';
import { saveCookies, loadCookies } from './cookies.js';
import { navigateToHomepage } from './navigation.js';

async function loginToMeetMe(browser, page, username, password, maxRetries = 3) {
  logger.info(`Starting MeetMe login process for user: ${username.substring(0, 3)}...`);
  let loggedIn = false;

  try {
    const cookiesLoaded = await loadCookies(page);
    if (cookiesLoaded) {
      logger.info('Cookies loaded successfully. Attempting to use existing session...');
      await navigateToHomepage(page);
      loggedIn = await verifyLoginStatus(page);
      if (loggedIn) {
        logger.info('Successfully logged in using cookies');
        return loggedIn;
      }
      logger.info('Cookie login failed. Proceeding with normal login...');
    } else {
      logger.info('No valid cookies found or failed to load cookies. Proceeding with normal login...');
    }
  } catch (cookieError) {
    logger.warn(`Error loading cookies: ${cookieError.message}`);
    logger.info('Proceeding with normal login...');
  }

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      logger.info(`Login attempt ${attempt} of ${maxRetries}`);

      await page.goto('https://beta.meetme.com', { waitUntil: 'networkidle2', timeout: 60000 });
      logger.info(`Page loaded. Current URL: ${page.url()}`);

      await page.waitForSelector('#marketing-header-login .btn-black', { visible: true, timeout: 60000 });
      await page.click('#marketing-header-login .btn-black');

      await page.waitForSelector('#site-login-modal-email', { visible: true, timeout: 30000 });

      await page.type('#site-login-modal-email', username);
      await page.type('#site-login-modal-password', password);

      await Promise.all([
        page.click('#site-login-modal-submit-group > button'),
        page.waitForNavigation({ waitUntil: 'networkidle0', timeout: 60000 })
      ]).catch(error => {
        logger.warn(`Navigation after login submission encountered an issue: ${error.message}`);
      });

      loggedIn = await verifyLoginStatus(page);
      if (loggedIn) {
        logger.info('Successfully logged in to MeetMe');
        try {
          await saveCookies(page);
          logger.info('Cookies saved after successful login');
        } catch (saveCookieError) {
          logger.warn(`Failed to save cookies: ${saveCookieError.message}`);
        }
        return loggedIn;
      } else {
        logger.warn(`Login attempt ${attempt} failed. Current URL: ${page.url()}`);
      }

      if (attempt < maxRetries) {
        await page.evaluate(() => new Promise(resolve => setTimeout(resolve, 5000)));
      }

    } catch (error) {
      logger.error(`Error during login attempt ${attempt}: ${error.message}`);
      if (attempt === maxRetries) {
        logger.error(`Max login attempts (${maxRetries}) reached. Login failed.`);
        return loggedIn;
      }
      await page.evaluate(() => new Promise(resolve => setTimeout(resolve, 5000)));
    }
  }

  return loggedIn;
}

async function verifyLoginStatus(page, maxAttempts = 15, checkInterval = 2000) {
  logger.info('Verifying login status...');
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const currentUrl = await page.url();
    logger.info(`Current URL: ${currentUrl}. Check ${attempt}/${maxAttempts}`);

    if (currentUrl.includes('meet') || currentUrl.includes('chat')) {
      logger.info('Successfully logged in to MeetMe');
      return true;
    }

    const loggedInElement = await page.$('#phoenix-topbar');
    if (loggedInElement) {
      logger.info('Found logged-in indicator element');
      return true;
    }

    if (attempt < maxAttempts) {
      logger.info(`Waiting ${checkInterval}ms before next check...`);
      await page.evaluate((interval) => new Promise(resolve => setTimeout(resolve, interval)), checkInterval);
    }
  }

  logger.error('Login verification timed out');
  return false;
}

async function handlePopUps(page) {
  try {
    logger.info('Handling pop-ups or overlays...');

    const selectors = [
      '#enable-push-notifications .modal-footer button.btn-primary',
      '#nav-chat > a > div > span:nth-child(1)'
    ];

    for (const selector of selectors) {
      const element = await page.$(selector);
      if (element) {
        await element.click();
        logger.info(`Clicked on ${selector}`);

        await page.evaluate(() => new Promise(resolve => setTimeout(resolve, 1000)));
      }
    }

    logger.info('Pop-ups or overlays handled.');
  } catch (error) {
    logger.error(`Error during pop-up handling: ${error.message}`);
    // Don't throw the error, just log it
  }
}

export { loginToMeetMe, handlePopUps };