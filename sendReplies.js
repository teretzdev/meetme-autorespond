import puppeteer from 'puppeteer-core';
import dotenv from 'dotenv';
import amqp from 'amqplib';
import { executablePath } from 'puppeteer';

dotenv.config({ path: './meetme_data/.env' });

const logger = console;
let messageCounter = 0;
let browser;
let page;

const TIMEOUT = 30000; // 30 seconds
const NAVIGATION_TIMEOUT = 45000; // 45 seconds
const STATE_CHECK_INTERVAL = 5000; // 5 seconds

let state = {
    isLoggedIn: false,
    currentUrl: '',
    lastActivityTime: Date.now()
};


// Define state variables
let loginAttempts = 0;
const MAX_LOGIN_ATTEMPTS = 3;

// Helper function to delay execution
function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}


async function initBrowser() {
    browser = await puppeteer.launch({
        headless: true, // Set to true for headless operation
        defaultViewport: null,
        args: ['--start-maximized'],
        executablePath: executablePath()
    });
    page = await browser.newPage();
    await loginToMeetMe();
}


async function checkLoginStatus() {
    try {
        const currentUrl = await page.url();
        logger.info(`Checking login status on URL: ${currentUrl}`);

        // Recognize #chat as logged in
        if (currentUrl.includes('#meet') || currentUrl.includes('app.meetme.com') || currentUrl.includes('#chat')) {
            logger.info('On #meet, app page, or chat page, assuming logged in');
            return true;
        }


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

        logger.info('No logged-in indicators found, assuming not logged in');
        return false;
    } catch (error) {
        logger.error('Error checking login status:', error);
        return false;
    }
}


async function updateState() {
    if (!page) {
        logger.error('Page is undefined during state update.');
        return;
    }
    state.currentUrl = await page.url();
    state.isLoggedIn = await checkLoginStatus();
    state.lastActivityTime = Date.now();
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

            // Validate message structure
            if (parsedMessage.original && parsedMessage.original.url && parsedMessage.flowiseResponse && parsedMessage.flowiseResponse.text) {
                await sendReply({
                    href: parsedMessage.original.url,
                    replyText: parsedMessage.flowiseResponse.text
                });
                channel.ack(message);
                logger.info(`[${messageCounter}] Message processed successfully`);
            } else {
                logger.error(`[${messageCounter}] Invalid message format: ${message.content.toString()}`);
                channel.nack(message, false, false); // Reject the message without requeueing
            }
        } else {
            logger.info('No messages in queue to process');
        }

        await channel.close();
        await connection.close();
    } catch (error) {
        logger.error('Error processing next message:', error);
    }
}


async function loginToMeetMe() {
    if (state.isLoggedIn) {
        logger.info('Already logged in. Skipping login process.');
        return true;
    }

    loginAttempts++;
    logger.info(`Starting MeetMe login process (Attempt ${loginAttempts}/${MAX_LOGIN_ATTEMPTS})`);

    try {
        await page.goto('https://www.meetme.com', { waitUntil: 'networkidle2', timeout: 60000 });
        logger.info(`Page loaded. Current URL: ${await page.url()}`);

        await handlePopUps(page);

        // Check if we're already on the beta.meetme.com page
        if (page.url().includes('beta.meetme.com')) {
            logger.info('Already on beta.meetme.com, checking login status');
            const loginSuccess = await checkLoginStatus();
            if (loginSuccess) {
                logger.info('Already logged in on beta.meetme.com');
                state.isLoggedIn = true;
                return true;
            }
        }

        // If not on beta.meetme.com or not logged in, proceed with login
        const loginButton = await page.waitForSelector('#marketing-header-login .btn-black', { visible: true, timeout: 30000 });
        if (!loginButton) {
            throw new Error('Login button not found');
        }
        await loginButton.click();

        logger.info('Entering credentials');
        await page.waitForSelector('#site-login-modal-email', { visible: true, timeout: 30000 });

        await page.type('#site-login-modal-email', process.env.MEETME_EMAIL);
        await page.type('#site-login-modal-password', process.env.MEETME_PASSWORD);

        logger.info('Submitting login form');
        await Promise.all([
            page.click('#site-login-modal-submit-group > button'),
            page.waitForNavigation({ waitUntil: 'networkidle0', timeout: 60000 })
        ]);


        await handlePopUps(page);

        const newUrl = await page.url();
        logger.info(`Current URL after login submission: ${newUrl}`);

        const loginSuccess = await checkLoginStatus();
        if (loginSuccess) {
            logger.info('Successfully logged in to MeetMe');
            state.isLoggedIn = true;
            return true;
        }

        logger.warn(`Login attempt ${loginAttempts} unsuccessful. URL does not indicate successful login.`);

        if (loginAttempts < MAX_LOGIN_ATTEMPTS) {
            logger.info(`Retrying login in 5 seconds...`);
            await delay(5000);
            return loginToMeetMe();
        } else {
            logger.error('Max login attempts reached. Login failed.');
            return false;
        }
    } catch (error) {
        logger.error(`Error during login: ${error.message}`);
        return false;
    }
}


async function sendReply(message) {
    const { href, replyText } = message;

    if (!href) {
        logger.error(`[${messageCounter}] Missing 'href' in message. Skipping reply.`);
        return;
    }

    logger.info(`[${messageCounter}] Attempting to navigate to: ${href}`);

    try {
        await page.goto(href, { waitUntil: 'networkidle2', timeout: 60000 });
        logger.info(`[${messageCounter}] Successfully navigated to: ${href}`);

        // Wait for the page to load
        await page.waitForSelector('body', { timeout: 30000 });

        // Log relevant page structure
        await logPageStructure();

        // Wait for any dynamic content to load
        await delay(5000);

        // Scrape existing messages
        const { userId, messages } = await scrapeExistingMessages();
        logger.info(`[${messageCounter}] Existing messages for user ${userId}: ${JSON.stringify(messages)}`);

        // Check for duplicate message
        if (userId && userLatestMessages[userId] === replyText) {
            logger.info(`[${messageCounter}] Duplicate message detected for user ${userId}. Skipping this reply.`);
            return;
        }

        // Wait for the textarea to be visible
        const inputSelector = 'textarea.chat-input, textarea[placeholder="Type a message..."]';
        const inputElement = await page.waitForSelector(inputSelector, { visible: true, timeout: 30000 });

        if (!inputElement) {
            logger.error(`[${messageCounter}] Input element not found with selector: ${inputSelector}`);
            throw new Error(`Input element not found with selector: ${inputSelector}`);
        }

        logger.info(`[${messageCounter}] Input element found. Attempting to type reply.`);

        // Type the reply
        await inputElement.type(replyText);
        logger.info(`[${messageCounter}] Reply typed into input element.`);

        // Wait for the send button to be enabled
        const buttonSelector = 'button.chat-send, button[type="submit"]';
        const sendButton = await page.waitForSelector(buttonSelector, { visible: true, timeout: 10000 });

        if (!sendButton) {
            logger.error(`[${messageCounter}] Send button not found with selector: ${buttonSelector}`);
            throw new Error(`Send button not found with selector: ${buttonSelector}`);
        }

        logger.info(`[${messageCounter}] Send button found. Attempting to click.`);

        // Click the send button using JavaScript
        await page.evaluate((selector) => {
            const button = document.querySelector(selector);
            if (button) {
                button.click();
                console.log('Send button clicked via JavaScript');
            } else {
                console.log('Send button not found in evaluate');
            }
        }, buttonSelector);

        logger.info(`[${messageCounter}] Send button click attempted via JavaScript.`);

        // Wait for a short time to allow the message to be sent
        await delay(2000);

        // Check if the message was actually sent
        const messagesSentAfter = await scrapeExistingMessages();
        const messageSent = messagesSentAfter.messages.some(msg => msg.text === replyText && msg.isSent);

        if (messageSent) {
            logger.info(`[${messageCounter}] Reply sent successfully`);
            // Update latest message for user
            if (userId) {
                userLatestMessages[userId] = replyText;
                logger.info(`[${messageCounter}] Updated latest message for user ${userId}: "${replyText}"`);
            }
        } else {
            logger.error(`[${messageCounter}] Failed to send reply. Message not found in chat after sending.`);
        }

    } catch (error) {
        logger.error(`[${messageCounter}] Error in sendReply: ${error.message}`);
        // Log the current page structure if there's an error
        await logPageStructure();
    }
}


async function logPageState(currentPage) {
    if (!currentPage) {
        logger.error('logPageState called with undefined page');
        return;
    }
    try {
        const url = await currentPage.url();
        const content = await currentPage.content();
        logger.info(`Current URL: ${url}`);
        logger.info(`Page content (first 500 characters): ${content.substring(0, 500)}`);

        const buttonState = await currentPage.evaluate(() => {
            const button = document.querySelector('button[type="submit"]');
            return button ? {
                disabled: button.disabled,
                visible: button.offsetParent !== null,
                text: button.textContent.trim()
            } : 'Button not found';
        });
        logger.info(`Send button state: ${JSON.stringify(buttonState)}`);
    } catch (error) {
        logger.error(`Error in logPageState: ${error.message}`);
    }
}


async function handlePopUps(page) {
    try {
        logger.info('Handling pop-ups or overlays...');

        const selectors = [
            '#enable-push-notifications .modal-footer button.btn-primary',
            '#nav-chat > a > div > span:nth-child(1)',
            '.modal-content button.btn-primary',
            '.modal-footer button.btn-secondary',
            'button[data-testid="push-notifications-dismiss"]'
        ];


        for (const selector of selectors) {
            const element = await page.$(selector);
            if (element) {
                await element.click();
                logger.info(`Clicked on ${selector}`);
                await delay(1000); // Wait for 1 second after each click
            }
        }


        logger.info('Pop-ups or overlays handled.');
    } catch (error) {
        logger.error(`Error during pop-up handling: ${error.message}`);
        // Don't throw the error, just log it
    }
}


async function handleEnableButton() {
    try {
        const enableButton = await page.evaluate(() => {
            const buttons = Array.from(document.querySelectorAll('button'));
            return buttons.find(button => button.textContent.includes('Enable'));
        });

        if (enableButton) {
            await page.evaluate((btn) => btn.click(), enableButton);
            logger.info('Clicked "Enable" button');
            await delay(2000);  // Wait for any changes after clicking Enable
            return true;
        } else {
            logger.info('No "Enable" button found. Proceeding without clicking.');
            return false;
        }
    } catch (error) {
        logger.warn('Error while handling Enable button:', error);
        return false;
    }
}


// Function to retrieve previous messages from the chat
async function getPreviousMessages() {
    try {
        // Wait for any content to load
        await page.waitForSelector('body', { timeout: 30000 });

        const messages = await page.evaluate(() => {
            // Log the entire body content for debugging
            console.log("Body content:", document.body.innerHTML);

            const messageElements = document.querySelectorAll('.chat-message, .message, [class*="message"]');
            console.log("Found message elements:", messageElements.length);

            return Array.from(messageElements).map(el => {
                console.log("Message element:", el.outerHTML);
                return {
                    text: el.textContent.trim(),
                    isSent: el.classList.contains('chat-message-sent') || el.classList.contains('sent') || el.classList.contains('outgoing'),
                    html: el.outerHTML
                };
            });
        });

        logger.info(`Retrieved ${messages.length} previous messages`);
        logger.info(`Messages: ${JSON.stringify(messages)}`);
        return messages;
    } catch (error) {
        logger.error('Error retrieving previous messages:', error);
        return [];
    }
}


// Function to check if a message is a duplicate
function isDuplicateMessage(existingMessages, newMessage) {
    if (existingMessages.length === 0) {
        return false;
    }

    const lastMessage = existingMessages[existingMessages.length - 1];
    const isDuplicate = lastMessage.isSent;

    logger.info(`Last message was sent by us (has 'Sent' status): ${isDuplicate}`);
    logger.info(`Last message: ${JSON.stringify(lastMessage)}`);
    logger.info(`New message to send: "${newMessage}"`);

    return isDuplicate;
}


async function logChatStructure() {
    try {
        const structure = await page.evaluate(() => {
            const body = document.body;
            const chatContainer = document.querySelector('.chat-messages, #chat-container');
            const textArea = document.querySelector('textarea[placeholder="Type something…"], input[type="text"]');
            const sendButton = document.querySelector('button[type="submit"], button:contains("Send")');
            
            return {
                bodyClasses: body.className,
                chatContainer: chatContainer ? chatContainer.outerHTML : 'Not found',
                textArea: textArea ? textArea.outerHTML : 'Not found',
                sendButton: sendButton ? sendButton.outerHTML : 'Not found',
                bodyChildren: Array.from(body.children).map(child => ({
                    tagName: child.tagName,
                    id: child.id,
                    className: child.className
                }))
            };
        });
        logger.info(`Chat structure: ${JSON.stringify(structure, null, 2)}`);
    } catch (error) {
        logger.error('Error logging chat structure:', error);
    }
}

async function scrapeExistingMessages() {
    try {
        const result = await page.evaluate(() => {
            const messageElements = document.querySelectorAll('.chat-message:not(.chat-no-messages)');
            console.log("Found message elements:", messageElements.length);
            const messages = Array.from(messageElements).map(el => {
                const textElement = el.querySelector('.chat-message-text');
                const sentIndicator = el.querySelector('.chat-message-status');
                console.log("Message element:", el.outerHTML);
                console.log("Text element:", textElement ? textElement.outerHTML : "Not found");
                console.log("Sent indicator:", sentIndicator ? sentIndicator.outerHTML : "Not found");
                return {
                    text: textElement ? textElement.textContent.trim() : '',
                    isSent: el.classList.contains('chat-message-sent') || el.classList.contains('outgoing'),
                    html: el.outerHTML
                };
            }).filter(msg => msg.text !== ''); // Filter out empty messages
            console.log("Processed messages:", JSON.stringify(messages, null, 2));
            
            // Get user ID from the URL
            const userId = window.location.href.split('/').pop();
            return { userId, messages };
        });
        logger.info(`Scraped messages: ${JSON.stringify(result, null, 2)}`);
        return result;
    } catch (error) {
        logger.error('Error scraping existing messages:', error);
        return { userId: null, messages: [] };
    }
}

async function logPageStructure() {
    try {
        const structure = await page.evaluate(() => {
            const chatContainer = document.querySelector('.chat-messages, #chat-container');
            const textArea = document.querySelector('textarea[placeholder="Type something…"], textarea');
            const sendButton = document.querySelector('button[type="submit"]');
            
            return {
                url: window.location.href,
                chatContainer: chatContainer ? 'Found' : 'Not found',
                textArea: textArea ? 'Found' : 'Not found',
                sendButton: sendButton ? 'Found' : 'Not found',
                relevantElements: {
                    chatMessages: document.querySelectorAll('.chat-message').length,
                    textareas: document.querySelectorAll('textarea').length,
                    submitButtons: document.querySelectorAll('button[type="submit"]').length
                }
            };
        });
        logger.info(`Page structure: ${JSON.stringify(structure, null, 2)}`);
    } catch (error) {
        logger.error('Error logging page structure:', error);
    }
}

let messageHistory = []

function addToHistory(message, timestamp) {
    // Check if a similar message was sent within the last 5 minutes
    const fiveMinutesAgo = Date.now() - 5 * 60 * 1000;
    const isDuplicate = messageHistory.some(entry => 
        entry.text.toLowerCase() === message.toLowerCase() &&
        entry.timestamp > fiveMinutesAgo
    );

    if (isDuplicate) {
        logger.info(`Duplicate message detected: "${message}". Skipping.`);
        return false;
    }

    // Add the new message to history
    messageHistory.push({ text: message, timestamp: timestamp || Date.now() });

    // Keep only the last 100 messages in history
    if (messageHistory.length > 100) {
        messageHistory = messageHistory.slice(-100);
    }

    return true;
}

let userLatestMessages = {};

function cleanupUserMessages() {
    const oneHourAgo = Date.now() - 60 * 60 * 1000;
    for (const userId in userLatestMessages) {
        if (userLatestMessages[userId].timestamp < oneHourAgo) {
            delete userLatestMessages[userId];
        }
    }
}

function main() {
    (async () => {
        try {
            await initBrowser();
            while (true) {
                await updateState();
                await processNextMessage();
                cleanupUserMessages();
                await delay(STATE_CHECK_INTERVAL);
            }
        } catch (error) {
            logger.error('Fatal error:', error);
            if (browser) await browser.close();
            process.exit(1);
        }
    })();
}

// Restart the script every two minutes
setInterval(async () => {
    logger.info('Restarting script...');
    if (browser) await browser.close();
    main();
}, 2 * 60 * 1000); // 2 minutes in milliseconds

// Initial run
main();

