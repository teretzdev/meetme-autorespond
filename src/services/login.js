// login.js
import logger from '../utils/logger.js';
import { saveCookies, loadCookies } from './cookies.js';
import { navigateToHomepage, navigateToMeetPage } from './navigation.js';
import { sendMessageToAPI } from '../api/messageApi.js';

async function queryJessAI(message) {
  try {
    const response = await sendMessageToAPI(message);
    return response;
  } catch (error) {
    console.error(`Error querying JessAI: ${error.message}`);
    return { message: 'Default reply message' };
  }
}

async function typeSlowly(page, selector, text) {
  await page.waitForSelector(selector);
  for (let char of text) {
    await page.type(selector, char, { delay: 100 }); // 100ms delay between keystrokes
  }
}

async function loginToMeetMe(browser, page, username, password, maxRetries = 3) {
  logger.info('Starting MeetMe login process');

  const cookiesLoaded = await loadCookies(page);
  if (cookiesLoaded) {
    logger.info('Cookies loaded. Attempting to use existing session...');
    await navigateToHomepage(page);
    const isLoggedIn = await verifyLoginStatus(page);
    if (isLoggedIn) {
      logger.info('Successfully logged in using cookies');
      return true;
    }
    logger.info('Cookie login failed. Proceeding with normal login...');
  }

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      logger.info(`Login attempt ${attempt} of ${maxRetries}`);

      await page.goto('https://www.meetme.com', { waitUntil: 'networkidle2' });
      logger.info(`Page loaded. Current URL: ${page.url()}`);

      await clickLoginButton(page);
      await enterCredentials(page, username, password);
      await submitLoginForm(page);

      const isLoggedIn = await verifyLoginStatus(page);
      if (isLoggedIn) {
        logger.info('Successfully logged in');
        await saveCookies(page);
        await navigateToMeetPage(page);
        return true;
      }

      logger.warn(`Login attempt ${attempt} failed. Retrying...`);
    } catch (error) {
      logger.error(`Error during login attempt ${attempt}: ${error.message}`);
      if (attempt === maxRetries) {
        logger.error('Max login attempts reached. Login failed.');
        return false;
      }
    }
  }

  return false;
}

async function clickLoginButton(page) {
  logger.info('Waiting for login button');
  const loginButton = await page.waitForSelector('#marketing-header-login .btn-black', { visible: true, timeout: 25000 });
  logger.info('Login button found. Clicking...');
  await loginButton.click();
}

async function enterCredentials(page, username, password) {
  logger.info('Waiting for email input field');
  await page.waitForSelector('#site-login-modal-email', { visible: true, timeout: 25000 });
  logger.info('Email input field found. Entering credentials...');
  await typeSlowly(page, '#site-login-modal-email', username);
  await typeSlowly(page, '#site-login-modal-password', password);
}

async function submitLoginForm(page) {
  logger.info('Credentials entered. Submitting login form...');
  await Promise.all([
    page.click('#site-login-modal-submit-group > button'),
    page.waitForNavigation({ waitUntil: 'networkidle0', timeout: 30000 })
  ]).catch(async (error) => {
    logger.warn(`Navigation after login submission timed out: ${error.message}`);
    logger.info('Continuing with login check despite timeout...');
  });
}

async function verifyLoginStatus(page, maxAttempts = 15, checkInterval = 2000) {
  logger.info('Verifying login status...');
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const currentUrl = page.url();
    logger.info(`Current URL: ${currentUrl}. Check ${attempt}/${maxAttempts}`);

    if (currentUrl.includes('#meet') || currentUrl.includes('app.meetme.com')) {
      logger.info('Successfully logged in to MeetMe');
      return true;
    }

    if (attempt < maxAttempts) {
      logger.info(`Waiting ${checkInterval}ms before next check...`);
      await page.waitForTimeout(checkInterval);
    }
  }

  logger.error('Login verification timed out');
  return false;
}

async function handlePopUps(page) {
  try {
    console.log('Handling pop-ups or overlays...');

    const selectors = [
      '#enable-push-notifications .modal-footer button.btn-primary',
      '#nav-chat > a > div > span:nth-child(1)',
      '#chat-section ol.media-list.chat-list > li',
      'h5.media-heading',
      '.media-date span',
      'p:not(.messages-chats-item-typing):not(.messages-chats-item-status)',
      'a.media-body'
    ];

    for (const selector of selectors) {
      if (await page.$(selector)) {
        await page.click(selector);
        console.log('Clicked on', selector);

        await page.waitForTimeout(1000); // Wait for 1 second
      }
    }

    console.log('Pop-ups or overlays handled.');
  } catch (error) {
    console.error('Error during pop-up handling:', error);
    throw error;
  }
}

export { loginToMeetMe, handlePopUps, queryJessAI };