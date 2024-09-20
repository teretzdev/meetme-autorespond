import puppeteer from 'puppeteer';
import { google } from 'googleapis';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { loginToMeetMe } from './services/login.js';
import { extractChatData } from './meetme/loginMeetMe.js';
import { authorize, getChatHistory, updateChatHistory } from './services/sheetService.js';
import config from './config/config.js';
import logger from './utils/logger.js';
import { saveCookies } from './services/cookies.js';

let filterAttempts = 0; // Add this line at the top of the file, outside any function

async function applyFilters(page) {
    filterAttempts++; // Increment the counter
    logger.info(`Attempting to apply filters (Attempt ${filterAttempts})`);
    try {
        // Wait for the filter button to be visible and clickable
        await page.waitForSelector('#filter-button', { visible: true, timeout: 10000 });
        await page.click('#filter-button');

        // Wait for the filter modal to appear
        await page.waitForSelector('#filter-modal', { visible: true, timeout: 5000 });

        // Apply your specific filters here
        // For example, to select 'Female' gender:
        await page.click('#gender-female');

        // Apply age range (adjust selectors as needed)
        await page.type('#age-min', '18');
        await page.type('#age-max', '30');

        // Click apply button
        await page.click('#apply-filters');

        // Wait for the modal to disappear and the page to update
        await page.waitForSelector('#filter-modal', { hidden: true, timeout: 5000 });
        await page.waitForTimeout(2000); // Wait for the page to update

        logger.info(`Filters applied successfully on attempt ${filterAttempts}`);
        return true;
    } catch (error) {
        logger.error(`Error applying filters on attempt ${filterAttempts}: ${error.message}`);
        return false;
    }
}

async function startPeriodicCookieSaving(page) {
    setInterval(async () => {
        try {
            await saveCookies(page);
            logger.info('Cookies saved periodically');
        } catch (error) {
            logger.error(`Error saving cookies periodically: ${error.message}`);
        }
    }, 60000); // 60000 ms = 1 minute
}

async function navigateToChatPage(page) {
    logger.info('Attempting to navigate to chat page...');
    try {
        await page.goto('https://beta.meetme.com/#chat', { waitUntil: 'networkidle0', timeout: 60000 });
        
        // Wait for the chat section to be visible
        await page.waitForSelector('#chat-section', { visible: true, timeout: 30000 });
        
        logger.info('Successfully navigated to chat page');
        return true;
    } catch (error) {
        logger.error(`Error navigating to chat page: ${error.message}`);
        
        // Log the current URL and page content for debugging
        const currentUrl = await page.url();
        const pageContent = await page.content();
        logger.error(`Current URL: ${currentUrl}`);
        logger.error(`Page content: ${pageContent.substring(0, 500)}...`);
        
        return false;
    }
}

export async function fetchMeetMeMessages() {
    const browser = await puppeteer.launch({ headless: false });
    const page = await browser.newPage();

    try {
        const isLoggedIn = await loginToMeetMe(browser, page, config.MEETME_USERNAME, config.MEETME_PASSWORD);
        if (!isLoggedIn) throw new Error('Login failed');

        // Start periodic cookie saving
        startPeriodicCookieSaving(page);

        logger.info('Login successful. Waiting before navigating to chat...');
        await page.waitForTimeout(5000);

        logger.info('Attempting to navigate to chat page...');
        let isChatPageLoaded = await navigateToChatPage(page);
        
        let attempts = 0;
        const maxAttempts = 3;
        while (!isChatPageLoaded && attempts < maxAttempts) {
            logger.warn(`Failed to navigate to chat page. Attempt ${attempts + 1} of ${maxAttempts}`);
            await page.waitForTimeout(5000);
            isChatPageLoaded = await navigateToChatPage(page);
            attempts++;
        }

        if (!isChatPageLoaded) {
            throw new Error('Failed to navigate to chat page after multiple attempts');
        }

        logger.info('Successfully navigated to chat page. Applying filters...');
        let filtersApplied = await applyFilters(page);

        if (!filtersApplied) {
            logger.warn('Failed to apply filters. Proceeding without filters.');
        }

        logger.info('Extracting chat data...');
        const chatData = await extractChatData(page);
        logger.info(`Extracted chat data: ${JSON.stringify(chatData, null, 2)}`);

        const authClient = await authorize();
        const existingChatHistory = await getChatHistory(authClient);
        logger.info(`Existing chat history: ${JSON.stringify(existingChatHistory, null, 2)}`);

        const updates = [];
        for (const message of chatData) {
            const existingEntry = existingChatHistory.find(entry => 
                entry[3] === message.href && entry[2] === message.shortMessage);
            if (!existingEntry) {
                updates.push([
                    message.username,
                    message.timeSent,
                    message.shortMessage,
                    message.href
                ]);
            }
        }

        logger.info(`Updates to be applied: ${JSON.stringify(updates, null, 2)}`);

        if (updates.length > 0) {
            await updateChatHistory(authClient, updates);
            logger.info('Records written successfully. Exiting script.');
        } else {
            logger.info('No new messages to update.');
        }

    } catch (error) {
        logger.error(`Error in fetchMessages: ${error.message}`);
        const finalUrl = await page.url();
        const finalContent = await page.content();
        logger.error(`Final URL: ${finalUrl}`);
        logger.error(`Final page content: ${finalContent.substring(0, 500)}...`);
    } finally {
        await browser.close();
        process.exit(0); // Exit the script after closing the browser
    }
}
fetchMeetMeMessages();

export async function fetchMessagesFromProcessed() {
    const messages = [];
    let msg;

    try {
        // Attempt to fetch messages from the queue
        while (true) {
            msg = await channel.get('meetme_processed', { noAck: false });
            if (!msg) {
                logger.info('No more messages in the meetme_processed queue.');
                break; // Exit the loop if no more messages are available
            }
            const messageContent = JSON.parse(msg.content.toString());
            messages.push(messageContent);
            logger.info(`Fetched message: ${JSON.stringify(messageContent)}`);
            channel.ack(msg); // Acknowledge the message
        }
    } catch (error) {
        logger.error(`Error fetching messages from meetme_processed: ${error.message}`);
    }

    logger.info(`Total messages fetched: ${messages.length}`);
    return messages;
}