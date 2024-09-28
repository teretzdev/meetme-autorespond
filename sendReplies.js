import puppeteer from 'puppeteer';
import dotenv from 'dotenv';
import amqp from 'amqplib';

dotenv.config({ path: './meetme_data/.env' });

const logger = console;
let messageCounter = 0;
let browser;
let page;
let isLoggedIn = false;
let currentUrl = '';
let lastActivityTime = 0;

const TIMEOUT = 30000; // 30 seconds
const NAVIGATION_TIMEOUT = 45000; // 45 seconds
const SHORT_CHECK_INTERVAL = 1000; // 1 second
const MAX_RETRIES = 5;
const STATE_CHECK_INTERVAL = 5000; // 5 seconds
const IDLE_TIMEOUT = 3000; // 3 seconds

let state = {
    isLoggedIn: false,
    currentUrl: '',
    lastActivityTime: Date.now()
};

async function initBrowser() {
    browser = await puppeteer.launch({ headless: false });
    page = await browser.newPage();
    page.setDefaultNavigationTimeout(NAVIGATION_TIMEOUT);
    return loginToMeetMe(page);
}

async function checkLoginStatus(page) {
    try {
        const currentUrl = await page.url();
        logger.info(`Checking login status on URL: ${currentUrl}`);

        if (currentUrl.includes('#meet') || currentUrl.includes('app.meetme.com') || currentUrl.includes('#chat/')) {
            logger.info('On #meet, app page, or chat page, assuming logged in');
            return true;
        }

        // Check for elements that are typically present when logged in
        const loggedInSelectors = [
            '#site-nav-user-menu',
            '.site-nav-user-dropdown',
            '[data-testid="header-avatar"]',
            '.phoenix-topnav-profile-menu',
            '.phoenix-topnav-profile-menu-toggle'
        ];

        for (const selector of loggedInSelectors) {
            const element = await page.$(selector);
            if (element) {
                logger.info(`Logged in status detected (${selector} found)`);
                return true;
            }
        }

        // If we can't find any logged-in indicators, assume not logged in
        logger.info('No logged-in indicators found, assuming not logged in');
        return false;
    } catch (error) {
        logger.error('Error checking login status:', error);
        return false;
    }
}

async function updateState() {
    state.currentUrl = await page.url();
    state.isLoggedIn = await checkLoginStatus(page);
}

async function processNextMessage() {
    try {
        const connection = await amqp.connect('amqp://localhost');
        const channel = await connection.createChannel();
        const queue = 'meetme_processed';

        await channel.assertQueue(queue, { durable: true });

        const message = await channel.get(queue, { noAck: false });
        if (message) {
            messageCounter++;
            const parsedMessage = JSON.parse(message.content.toString());
            logger.info(`[${messageCounter}] Processing message for: ${parsedMessage.original.name}`);
            
            await sendReply(parsedMessage);
            channel.ack(message);
            logger.info(`[${messageCounter}] Message processed successfully`);
        } else {
            logger.info('No messages in queue to process');
        }

        await connection.close();
    } catch (error) {
        logger.error('Error processing next message:', error);
    }
}

async function loginToMeetMe(page) {
    logger.info('Starting MeetMe login process');
    const maxAttempts = 3;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        try {
            await page.goto('https://www.meetme.com', { waitUntil: 'networkidle2', timeout: NAVIGATION_TIMEOUT });
            logger.info(`Page loaded. Current URL: ${await page.url()}`);

            const isAlreadyLoggedIn = await checkLoginStatus(page);
            if (isAlreadyLoggedIn) {
                logger.info('Already logged in.');
                return true;
            }

            const loginButton = await page.waitForSelector('#marketing-header-login .btn-black', { visible: true, timeout: TIMEOUT });
            await loginButton.click();

            logger.info('Entering credentials');
            await page.waitForSelector('#site-login-modal-email', { visible: true, timeout: TIMEOUT });
            
            await page.type('#site-login-modal-email', process.env.MEETME_EMAIL);
            await page.type('#site-login-modal-password', process.env.MEETME_PASSWORD);

            logger.info('Submitting login form');
            await Promise.all([
                page.click('#site-login-modal-submit-group > button'),
                page.waitForNavigation({ waitUntil: 'networkidle0', timeout: NAVIGATION_TIMEOUT })
            ]);

            const loginSuccess = await checkLoginStatus(page);
            if (loginSuccess) {
                await updateState();
                logger.info('Successfully logged in to MeetMe');
                return true;
            }

            logger.warn(`Login attempt ${attempt} unsuccessful.`);

            if (attempt < maxAttempts) {
                logger.info(`Retrying login in 5 seconds...`);
                await delay(5000);
            }
        } catch (error) {
            logger.error(`Error during login attempt ${attempt}: ${error.message}`);
            if (attempt === maxAttempts) {
                logger.error('Max login attempts reached. Login failed.');
                return false;
            }
            logger.info(`Retrying login in 5 seconds...`);
            await delay(5000);
        }
    }

    return false;
}

async function sendReply(message) {
    state.lastActivityTime = Date.now();
    const chatUrl = message.original.url;
    logger.info(`[${messageCounter}] Attempting to navigate to: ${chatUrl}`);
   
    if (!chatUrl) {
        throw new Error('Chat URL is undefined');
    }
   
    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
        try {
            if (!browser || !browser.isConnected() || !page) {
                logger.info(`Browser or page not available. Reinitializing...`);
                const loginSuccess = await initBrowser();
                if (!loginSuccess) {
                    throw new Error('Failed to initialize browser and log in');
                }
            }

            await page.goto(chatUrl, { waitUntil: 'networkidle0', timeout: NAVIGATION_TIMEOUT });
            await updateState();
            logger.info(`[${messageCounter}] Navigation attempt ${attempt}: Successfully navigated to: ${await page.url()}`);
           
            // Wait for additional time to ensure dynamic content is loaded
            await delay(5000);

            // Log the page content for debugging
            const pageContent = await page.content();
            logger.info(`[${messageCounter}] Page content: ${pageContent.substring(0, 500)}...`);

            // Handle potential popups
            await handlePopups();
            await handleEnableButton();  // Add this line to specifically handle the Enable button

            // Wait for the chat input to be available
            const chatInputSelectors = [
                'textarea[placeholder="Type something…"]',
                'textarea[placeholder="Say something..."]',
                'textarea[aria-label="Chat input"]',
                'div[contenteditable="true"][aria-label="Chat input"]',
                'div[role="textbox"]'
            ];

            let chatInput = null;
            for (let i = 0; i < 3; i++) {  // Try up to 3 times
                await handlePopups();  // Handle popups before each attempt
                for (const selector of chatInputSelectors) {
                    chatInput = await page.$(selector);
                    if (chatInput) {
                        logger.info(`[${messageCounter}] Chat input found with selector: ${selector}`);
                        break;
                    }
                }
                if (chatInput) break;
                await delay(2000);  // Wait 2 seconds before trying again
            }

            if (!chatInput) {
                throw new Error('Chat input not found');
            }

            logger.info(`[${messageCounter}] Chat input found. Proceeding with message sending.`);

            // Scroll the chat input into view
            await chatInput.evaluate(el => el.scrollIntoView({ behavior: 'smooth', block: 'center' }));
            await delay(1000);  // Wait for scroll to complete

            await handlePopups();  // Handle popups again before interacting with chat input

            try {
                // Try to click and type normally
                await chatInput.click({ clickCount: 3 });
                await chatInput.press('Backspace');
                await chatInput.type(message.flowiseResponse.text, { delay: 10 });
            } catch (clickError) {
                logger.warn(`[${messageCounter}] Failed to click chat input. Attempting to set value directly.`);
                // If clicking fails, try to set the value directly
                await page.evaluate((selector, text) => {
                    const element = document.querySelector(selector);
                    if (element) {
                        element.value = text;
                        element.dispatchEvent(new Event('input', { bubbles: true }));
                    }
                }, chatInputSelectors[0], message.flowiseResponse.text);
            }

            // Wait for the submit button to be visible and enabled
            const submitButtonSelectors = [
                'button[type="submit"]',
                'button[aria-label="Send"]',
                'button.chat-input-submit'
            ];

            let submitButton = null;
            for (const selector of submitButtonSelectors) {
                submitButton = await page.$(selector);
                if (submitButton) {
                    logger.info(`[${messageCounter}] Submit button found with selector: ${selector}`);
                    break;
                }
            }

            if (!submitButton) {
                throw new Error('Submit button not found');
            }

            // Click the submit button
            try {
                await submitButton.click();
                logger.info(`[${messageCounter}] Submit button clicked to send message`);
            } catch (submitError) {
                logger.warn(`[${messageCounter}] Failed to click submit button. Attempting to trigger submit event.`);
                await page.evaluate((selector) => {
                    const button = document.querySelector(selector);
                    if (button) {
                        button.click();
                    }
                }, submitButtonSelectors[0]);
            }

            // Wait for the message to appear in the chat
            await page.waitForFunction(
                (text) => {
                    const messages = document.querySelectorAll('.chat-message-outgoing');
                    return Array.from(messages).some(msg => msg.textContent.includes(text.substring(0, 50)));
                },
                { timeout: TIMEOUT },
                message.flowiseResponse.text
            );

            logger.info(`[${messageCounter}] Message content found in chat`);
            logger.info(`[${messageCounter}] Send reply process completed successfully`);

            // Navigate back to the #meet page
            await page.goto('https://beta.meetme.com/#meet', { waitUntil: 'networkidle0', timeout: NAVIGATION_TIMEOUT });
            logger.info(`[${messageCounter}] Returned to #meet page`);

            return;
        } catch (error) {
            logger.error(`[${messageCounter}] Error in sendReply (attempt ${attempt}/${MAX_RETRIES}):`, error);
            if (attempt === MAX_RETRIES) {
                throw error;
            }
            await delay(5000 * attempt);
        }
    }
}

async function handlePopups() {
    const popupSelectors = [
        '.modal-close',
        '.close-button',
        '[aria-label="Close"]',
        '.dismiss-button',
        // Add more selectors for different types of popups
    ];

    for (const selector of popupSelectors) {
        try {
            const closeButton = await page.$(selector);
            if (closeButton) {
                await closeButton.click();
                logger.info(`Closed popup with selector: ${selector}`);
                await delay(1000);  // Wait for popup to close
            }
        } catch (error) {
            logger.warn(`Failed to close popup with selector: ${selector}`);
        }
    }

    // Handle "Enable" button
    try {
        const enableButton = await page.$('button:contains("Enable")');
        if (enableButton) {
            await enableButton.click();
            logger.info('Clicked "Enable" button');
            await delay(2000);  // Wait for any changes after clicking Enable
        }
    } catch (error) {
        logger.warn('Failed to click "Enable" button:', error);
    }

    // Handle any "Block" buttons that might appear
    try {
        const blockButton = await page.$('button:contains("Block")');
        if (blockButton) {
            await blockButton.click();
            logger.info('Clicked "Block" button');
            await delay(1000);
        }
    } catch (error) {
        logger.warn('Failed to click "Block" button');
    }
}

async function handleEnableButton() {
    try {
        const enableButton = await page.evaluateHandle(() => {
            const buttons = Array.from(document.querySelectorAll('button'));
            return buttons.find(button => button.textContent.includes('Enable'));
        });

        if (enableButton) {
            await enableButton.click();
            logger.info('Clicked "Enable" button');
            await delay(2000);  // Wait for any changes after clicking Enable
            return true;
        }
    } catch (error) {
        logger.warn('Failed to find or click "Enable" button:', error);
    }
    return false;
}

async function processMessages() {
    while (true) {
        try {
            await updateState();
            logger.info(`Current state - URL: ${state.currentUrl}, Logged in: ${state.isLoggedIn}, Last activity: ${new Date(state.lastActivityTime).toISOString()}`);

            const currentTime = Date.now();
            const idleTime = currentTime - state.lastActivityTime;

            if (state.isLoggedIn || idleTime > IDLE_TIMEOUT) {
                logger.info(`Conditions met for processing messages. Logged in: ${state.isLoggedIn}, Idle time: ${idleTime}ms`);
                await processNextMessage();
                state.lastActivityTime = currentTime; // Reset the last activity time after processing a message
            } else {
                logger.info(`Not processing messages. Logged in: ${state.isLoggedIn}, Idle time: ${idleTime}ms`);
            }
        } catch (error) {
            logger.error('Error in processMessages:', error);
        }
        await delay(STATE_CHECK_INTERVAL);
    }
}

// Add this function at the top of your file, after the imports
function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

// Main execution
(async () => {
    try {
        await initBrowser();
        await processMessages(); // This will now handle both state checking and message processing
    } catch (error) {
        logger.error('Fatal error:', error);
        if (browser) await browser.close();
        process.exit(1);
    }
})();

