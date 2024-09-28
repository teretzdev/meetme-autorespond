import puppeteer from 'puppeteer';
import config from '../config/config.js';
import logger from '../utils/logger.js';

export async function initializeBrowser() {
  logger.info('Initializing browser');
  const browser = await puppeteer.launch({ headless: false });
  const page = await browser.newPage();
  return { browser, page };
}

export async function loginToMeetMe(page, username, password) {
  logger.info('Starting MeetMe login process');
  const maxAttempts = 3;
  const waitTime = 10000; // 10 seconds

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      await page.goto('https://www.meetme.com', { waitUntil: 'networkidle2' });
      logger.info(`Page loaded. Current URL: ${page.url()}`);

      logger.info('Waiting for login button');
      const loginButton = await page.waitForSelector('#marketing-header-login .btn-black', { visible: true, timeout: 25000 });
      await loginButton.click();

      logger.info('Entering credentials');
      await page.waitForSelector('#site-login-modal-email', { visible: true, timeout: 25000 });
      await page.type('#site-login-modal-email', username);
      await page.type('#site-login-modal-password', password);

      logger.info('Submitting login form');
      await Promise.all([
        page.click('#site-login-modal-submit-group > button'),
        page.waitForNavigation({ waitUntil: 'load' })
      ]);

      logger.info('Checking if we have reached the #meet page...');
      let currentUrl = page.url();
      let attempts = 0;
      const maxCheckAttempts = 30;
      const checkInterval = 2000;

      while (!currentUrl.includes('#meet') && attempts < maxCheckAttempts) {
        logger.info(`Current URL: ${currentUrl}. Waiting for #meet... (Attempt ${attempts + 1}/${maxCheckAttempts})`);
        await new Promise(resolve => setTimeout(resolve, checkInterval));
        currentUrl = page.url();
        attempts++;
      }

      logger.info(`Login process completed. Final URL: ${currentUrl}`);
      
      // Detailed element check and logging
      const pageState = await page.evaluate(() => {
        const elements = {
          chatSection: !!document.querySelector('#chat-section'),
          userMenu: !!document.querySelector('#user-menu'),
          header: !!document.querySelector('header'),
          footer: !!document.querySelector('footer'),
          body: document.body.innerHTML.length
        };
        return {
          url: window.location.href,
          title: document.title,
          elements: elements
        };
      });

      logger.info('Page state after login:', JSON.stringify(pageState, null, 2));
      
      if (currentUrl.includes('#meet')) {
        if (pageState.elements.chatSection || pageState.elements.userMenu) {
          logger.info('Successfully logged in and redirected to #meet');
          return { page, isLoggedIn: true };
        } else {
          logger.warn('URL contains #meet, but expected elements not found. Considering login successful, but flagging for review.');
          return { page, isLoggedIn: true };
        }
      } else {
        logger.error(`Login unsuccessful. Final URL: ${currentUrl}`);
        
        // Check for any error messages on the page
        const errorMessage = await page.evaluate(() => {
          const errorElement = document.querySelector('.error-message');
          return errorElement ? errorElement.innerText : null;
        });

        if (errorMessage) {
          logger.error(`Login error message: ${errorMessage}`);
        }

        if (attempt < maxAttempts) {
          logger.warn(`Login attempt ${attempt} unsuccessful. Retrying in ${waitTime / 1000} seconds...`);
          await new Promise(resolve => setTimeout(resolve, waitTime));
        }
      }
    } catch (error) {
      logger.error(`Error during login attempt ${attempt}: ${error.message}`);
      if (attempt < maxAttempts) {
        logger.info(`Retrying login in ${waitTime / 1000} seconds...`);
        await new Promise(resolve => setTimeout(resolve, waitTime));
      }
    }
  }

  logger.error('All login attempts failed');
  return { page, isLoggedIn: false };
}

export async function handlePopUps(page) {
  const popupSelectors = [
    '#enable-push-notifications .modal-footer button.btn-primary',
    '#nav-chat > a > div > span:nth-child(1)'
  ];

  for (const selector of popupSelectors) {
    try {
      await page.waitForSelector(selector, { visible: true, timeout: 5000 });
      await page.click(selector);
      logger.info(`Clicked popup: ${selector}`);
      await new Promise(resolve => setTimeout(resolve, 1000));
    } catch (error) {
      logger.info(`Popup not found or not clickable: ${selector}`);
    }
  }
}

export async function sendReply(page, replyText, href) {
  logger.info(`Attempting to send reply to ${href}`);
  try {
    await page.goto(href, { waitUntil: 'networkidle0', timeout: 60000 });
    logger.info('Navigation to chat page completed');

    await handlePopUps(page);

    logger.info('Attempting to input text and send message...');
    
    await page.waitForSelector('textarea.form-control.input-lg[placeholder="Type something…"]', { visible: true, timeout: 10000 });

    const result = await page.evaluate(async (text) => {
      const textarea = document.querySelector('textarea.form-control.input-lg[placeholder="Type something…"]');
      const sendButton = document.querySelector('.chat-form button[type="submit"]');
      
      if (!textarea || !sendButton) {
        return { success: false, error: 'Could not find textarea or send button' };
      }

      textarea.value = text;
      textarea.dispatchEvent(new Event('input', { bubbles: true }));
      textarea.dispatchEvent(new Event('change', { bubbles: true }));
      
      await new Promise(resolve => setTimeout(resolve, 1000));
      
      if (sendButton.disabled) {
        sendButton.disabled = false;
      }
      
      sendButton.click();
      
      return { success: true, inputValue: textarea.value };
    }, replyText);

    if (result.success) {
      logger.info(`Reply input successfully. Textarea value: ${result.inputValue}`);
      await new Promise(resolve => setTimeout(resolve, 2000));
      
      const messageAppeared = await page.evaluate((text) => {
        const messages = document.querySelectorAll('.chat-message');
        return Array.from(messages).some(msg => msg.textContent.includes(text));
      }, replyText);

      if (messageAppeared) {
        logger.info(`Reply sent successfully: ${replyText.substring(0, 50)}...`);
        return true;
      } else {
        logger.warn(`Reply input, but not found in chat messages. May not have been sent.`);
        return false;
      }
    } else {
      throw new Error(result.error || 'Failed to input message');
    }
  } catch (error) {
    logger.error(`Error sending reply to ${href}: ${error.message}`);
    await page.screenshot({ path: `error-screenshot-${Date.now()}.png`, fullPage: true });
    return false;
  }
}

export async function closeBrowser(browser) {
  logger.info('Closing browser');
  await browser.close();
  logger.info('Browser closed');
}

export async function extractChatData(page) {
  logger.info('Starting chat data extraction');
  try {
    await page.waitForSelector('#chat-section', { timeout: 20000 });
    logger.info('Chat section found');

    const chatData = await page.evaluate(() => {
      const messages = document.querySelectorAll('#chat-section ol.media-list.chat-list > li');
      return Array.from(messages).map(message => {
        const username = message.querySelector('h5.media-heading').textContent.trim();
        const timeSent = message.querySelector('.media-date span').getAttribute('data-timestamp');
        const shortMessage = message.querySelector('p:not(.messages-chats-item-typing):not(.messages-chats-item-status)')?.textContent.trim();
        const href = message.querySelector('a.media-body')?.href;
        const userCode = href ? href.match(/\/(\d+)$/)?.[1] : null;
        console.log('userCode', userCode, 'username', username, 'timeSent', timeSent, 'shortMessage', shortMessage, 'href', href);
        return { userCode, username, timeSent, shortMessage, href };
      });
    });

    logger.info(`Extracted ${chatData.length} chat messages`);
    return chatData;
  } catch (error) {
    logger.error(`Error extracting chat data: ${error.message}`);
    return [];
  }
}

export async function navigateToChatPage(page) {
  logger.info('Navigating to chat page...');
  try {
    const chatUrl = 'https://beta.meetme.com/#chat';
    
    await page.goto(chatUrl, { waitUntil: 'networkidle0', timeout: 30000 });
    
    logger.info('Navigation initiated. Waiting for page load...');
    
    await page.waitForSelector('#chat-section', { visible: true, timeout: 30000 });
    
    const currentUrl = await page.url();
    logger.info(`Page loaded. Current URL: ${currentUrl}`);

    const isChatPage = await page.evaluate(() => {
      return window.location.hash === '#chat' && !!document.querySelector('#chat-section');
    });

    if (!isChatPage) {
      throw new Error('Failed to load chat page content');
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

export default {
  initializeBrowser,
  loginToMeetMe,
  handlePopUps,
  sendReply,
  closeBrowser,
  extractChatData,
  navigateToChatPage
};
