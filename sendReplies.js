import puppeteer from 'puppeteer';
import dotenv from 'dotenv';
import amqp from 'amqplib';

dotenv.config({ path: './meetme_data/.env' });

const logger = console;
let messageCounter = 0;
let browser;
let page;

const TIMEOUT = 30000; // 30 seconds
const NAVIGATION_TIMEOUT = 60000; // 60 seconds
const SHORT_CHECK_INTERVAL = 1000; // 1 second

async function initBrowser() {
    browser = await puppeteer.launch({ headless: false });
    page = await browser.newPage();
    page.setDefaultNavigationTimeout(NAVIGATION_TIMEOUT);
    let isLoggedIn = false;
    for (let attempt = 1; attempt <= 3; attempt++) {
        isLoggedIn = await loginToMeetMe(page);
        if (isLoggedIn) break;
        logger.warn(`Login attempt ${attempt} failed. Retrying...`);
        await delay(3000); // Wait before retrying
    }
    if (!isLoggedIn) throw new Error('Login failed after multiple attempts');
}

async function recreatePage() {
    logger.info('Recreating page...');
    if (page) {
        await page.close().catch(e => logger.error('Error closing page:', e));
    }
    page = await browser.newPage();
    page.setDefaultNavigationTimeout(NAVIGATION_TIMEOUT);
    await loginToMeetMe(page);
}

async function processMessages() {
    try {
        await initBrowser();

        const connection = await amqp.connect('amqp://localhost');
        const channel = await connection.createChannel();
        const queue = 'meetme_processed';

        await channel.assertQueue(queue, { durable: true });
        channel.prefetch(1);

        logger.info('Waiting for messages...');

        channel.consume(queue, async (msg) => {
            if (msg !== null) {
                messageCounter++;
                let message;
                try {
                    message = JSON.parse(msg.content.toString());
                    logger.info(`[${messageCounter}] Processing message for: ${message.original.name}`);
                    
                    await sendReply(message);
                    channel.ack(msg);
                    logger.info(`[${messageCounter}] Message processed successfully`);
                } catch (error) {
                    logger.error(`[${messageCounter}] Error processing message:`, error);
                    await recreatePage();
                    channel.nack(msg, false, true);
                }

                await delay(5000);
            }
        });
    } catch (error) {
        logger.error('Fatal error in processMessages:', error);
        if (browser) await browser.close();
        process.exit(1);
    }
}

async function loginToMeetMe(page) {
    try {
        logger.info('Starting login process');
        await page.goto('https://www.meetme.com/#home', { waitUntil: 'networkidle0' });
        logger.info('Page loaded. Current URL:', await page.url());

        // Wait for the loading spinner to disappear
        logger.info('Waiting for page to finish loading');
        await page.waitForSelector('.nav-initial-loading', { hidden: true, timeout: 30000 });

        // Wait for any login button to appear
        logger.info('Waiting for login button');
        await page.waitForFunction(() => {
            return document.querySelector('button, a').innerText.toLowerCase().includes('login') ||
                   document.querySelector('button, a').innerText.toLowerCase().includes('sign in');
        }, { timeout: 30000 });

        logger.info('Clicking login button');
        await page.evaluate(() => {
            const loginButton = Array.from(document.querySelectorAll('button, a')).find(el => 
                el.innerText.toLowerCase().includes('login') || el.innerText.toLowerCase().includes('sign in')
            );
            if (loginButton) loginButton.click();
        });

        // Pause to allow modal and elements to appear
        logger.info('Waiting for login modal to appear');
        await delay(3000);  // Use the custom delay function instead of waitForTimeout

        // Wait for login form elements to appear
        logger.info('Waiting for login form elements');
        await page.waitForFunction(() => {
            return document.querySelector('input[type="email"]') && 
                   document.querySelector('input[type="password"]') &&
                   document.querySelector('button[type="submit"]');
        }, { timeout: 30000 });

        logger.info('Entering credentials');
        await page.type('input[type="email"]', process.env.MEETME_EMAIL);
        await page.type('input[type="password"]', process.env.MEETME_PASSWORD);

        logger.info('Submitting login form');
        await page.click('button[type="submit"]');

        logger.info('Waiting for navigation after login');
        await page.waitForNavigation({ timeout: 60000 });

        logger.info('Checking if login was successful');
        const loggedIn = await page.evaluate(() => {
            return !document.querySelector('button, a').innerText.toLowerCase().includes('login') &&
                   !document.querySelector('button, a').innerText.toLowerCase().includes('sign in');
        });

        if (loggedIn) {
            logger.info('Login successful');
            return true;
        } else {
            throw new Error('Login failed');
        }
    } catch (error) {
        logger.error('Error during login process:', error);
        return false;
    }
}

async function sendReply(message) {
    const chatUrl = message.original.url;
    logger.info(`[${messageCounter}] Attempting to navigate to: ${chatUrl}`);
   
    if (!chatUrl) {
        throw new Error('Chat URL is undefined');
    }
   
    const maxRetries = 3;
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
            const isLoggedIn = await checkLoginStatus();
            if (!isLoggedIn) {
                logger.info(`[${messageCounter}] Not logged in. Attempting to log in...`);
                await loginToMeetMe(page);
            }

            await page.goto(chatUrl, { waitUntil: 'networkidle0' });
            logger.info(`[${messageCounter}] Navigation attempt ${attempt}: Successfully navigated to: ${page.url()}`);
           
            let contentLoaded = false;
            const startTime = Date.now();
            while (!contentLoaded && Date.now() - startTime < TIMEOUT) {
                await delay(SHORT_CHECK_INTERVAL);
                contentLoaded = await page.evaluate(() => {
                    return document.querySelector('#global-layer-main-content') !== null &&
                           document.querySelector('textarea[placeholder="Type something…"]') !== null;
                });
            }

            if (!contentLoaded) {
                throw new Error('Failed to load chat page content within timeout');
            }

            const currentUrl = page.url();
            logger.info(`[${messageCounter}] Current URL after waiting for content: ${currentUrl}`);

            if (!currentUrl.includes('chat/member')) {
                throw new Error('Failed to navigate to chat page');
            }

            logger.info(`[${messageCounter}] Successfully navigated to chat page`);

            const chatInputSelector = 'textarea[placeholder="Type something…"]';
            await page.waitForSelector(chatInputSelector, { visible: true, timeout: TIMEOUT });
            await page.evaluate((selector, text) => {
                const element = document.querySelector(selector);
                element.value = text;
                element.dispatchEvent(new Event('input', { bubbles: true }));
            }, chatInputSelector, message.flowiseResponse.text);

            const sendButtonSelector = 'button[type="submit"]';
            await page.waitForSelector(sendButtonSelector, { visible: true, timeout: TIMEOUT });
            await page.evaluate((selector) => {
                document.querySelector(selector).click();
            }, sendButtonSelector);

            logger.info(`[${messageCounter}] Message sent successfully`);

            await page.waitForFunction((text) => {
                const messages = document.querySelectorAll('.chat-message');
                return Array.from(messages).some(msg => msg.textContent.includes(text));
            }, { timeout: TIMEOUT }, message.flowiseResponse.text);

            logger.info(`[${messageCounter}] Message confirmed sent`);

            await delay(2000);
            return;
        } catch (error) {
            logger.error(`[${messageCounter}] Error in sendReply (attempt ${attempt}/${maxRetries}):`, error);
            if (attempt === maxRetries) {
                throw error;
            }
            await delay(5000 * attempt);
        }
    }
}

async function checkLoginStatus() {
    try {
        return await page.evaluate(() => {
            return document.querySelector('#site-nav') !== null || 
                   document.querySelector('#global-layer-main-content') !== null ||
                   document.querySelector('textarea[placeholder="Type something…"]') !== null ||
                   document.querySelector('.chat-message') !== null;
        });
    } catch (error) {
        logger.error('Error checking login status:', error);
        return false;
    }
}

function delay(time) {
    return new Promise(resolve => setTimeout(resolve, time));
}

processMessages().catch(error => {
    logger.error('Fatal error in processMessages:', error);
    if (browser) browser.close();
    process.exit(1);
});

