import puppeteer from 'puppeteer';
import logger from './src/utils/logger.js'; // Ensure this path is correct
import config from './src/config/config.js'; // Importing the config file

logger.info('Logger initialized successfully'); // Added for debugging logger initialization

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
                await page.waitForTimeout(checkInterval);
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
                    await page.waitForTimeout(waitTime);
                }
            }
        } catch (error) {
            logger.error(`Error during login attempt ${attempt}: ${error.message}`);
            if (attempt < maxAttempts) {
                logger.info(`Retrying login in ${waitTime / 1000} seconds...`);
                await page.waitForTimeout(waitTime);
            }
        }
    }
  
    logger.error('All login attempts failed');
    return { page, isLoggedIn: false };
}

async function handlePopUps(page) {
    const popupSelectors = [
        '#enable-push-notifications .modal-footer button.btn-primary',
        '#nav-chat > a > div > span:nth-child(1)'
    ];

    for (const selector of popupSelectors) {
        try {
            await page.waitForSelector(selector, { visible: true, timeout: 5000 });
            await page.click(selector);
            logger.info(`Clicked popup: ${selector}`);
            await page.waitForTimeout(1000);
        } catch (error) {
            logger.info(`Popup not found or not clickable: ${selector}`);
        }
    }
}

async function processMessages(page) {
    const messages = await page.evaluate(() => {
        const messageElements = document.querySelectorAll('.message-item');
        return Array.from(messageElements).map(messageElement => {
            const username = messageElement.querySelector('.username').textContent;
            const timeSent = messageElement.querySelector('.time-sent').textContent;
            const messageHref = messageElement.querySelector('.message-link').href;
            return { username, timeSent, messageHref };
        });
    });

    for (const message of messages) {
        logger.info(`Processing message from ${message.username} sent at ${message.timeSent}`);
        const replyText = `Hello ${message.username}, thanks for reaching out!`;
        const replySent = await sendReply(page, replyText, message.messageHref);
        if (replySent) {
            logger.info(`Reply sent to ${message.username}`);
        } else {
            logger.error(`Failed to send reply to ${message.username}`);
        }
    }
}

async function sendReplies() {
    const username = config.MEETME_USERNAME; // Use username from config
    const password = config.MEETME_PASSWORD; // Use password from config

    const browser = await puppeteer.launch();
    const page = await browser.newPage();

    const { isLoggedIn } = await loginToMeetMe(page, username, password); // Use constants for username and password

    if (!isLoggedIn) {
        logger.error('Login failed. Exiting...');
        await browser.close();
        return;
    }

    // Handle any popups that might appear
    await handlePopUps(page);

    // Start the message sending process
    await processMessages(page);

    // Close the browser
    await browser.close();
}

// Example usage
sendReplies();