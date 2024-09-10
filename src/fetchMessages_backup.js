import puppeteer from 'puppeteer';
import { google } from 'googleapis';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import amqp from 'amqplib';
import { navigateToChatPage, handlePopUps, extractChatData } from './meetme/loginMeetMe.js';
import { authorize, getChatHistory, updateChatHistory } from './services/sheetService.js';
import config from './config/config.js';
import logger from './utils/logger.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function sendToRabbitMQ(updates) {
  try {
    const connection = await amqp.connect('amqp://localhost');
    const channel = await connection.createChannel();
    const queue = 'meetme_updates';

    await channel.assertQueue(queue, {
      durable: true
    });

    updates.forEach(update => {
      const message = JSON.stringify(update);
      channel.sendToQueue(queue, Buffer.from(message), {
        persistent: true
      });
    });

    logger.info(`Sent ${updates.length} messages to RabbitMQ`);

    setTimeout(() => {
      connection.close();
    }, 500);
  } catch (error) {
    logger.error(`Error sending to RabbitMQ: ${error.message}`);
  }
}

import fs from 'fs/promises';

async function loginToMeetMe(browser, page, username, password) {
    try {
        await page.goto('https://www.meetme.com/', { waitUntil: 'networkidle0', timeout: 60000 });
        logger.info(`Page loaded. Current URL: ${page.url()}`);
        
        // Save the HTML content
        const htmlContent = await page.content();
        await fs.writeFile('meetme_login_page.html', htmlContent);
        logger.info('HTML content saved to meetme_login_page.html');
        
        // Log the current state
        logger.info('Login page HTML saved. Please analyze the file to determine correct selectors.');
        
        // For now, we'll just return false to indicate we haven't completed the login process
        return false;
    } catch (error) {
        logger.error(`Error during login process: ${error.message}`);
        return false;
    }
}

async function fetchMeetMeMessages() {
    const browser = await puppeteer.launch({ 
        headless: false,
        defaultNavigationTimeout: 60000 // Increase to 60 seconds
    });
    let page = await browser.newPage(); // Moved here to ensure fresh instance

    try {
        let isLoggedIn = false;
        let loginAttempts = 0;
        const maxLoginAttempts = 3;

        while (!isLoggedIn && loginAttempts < maxLoginAttempts) {
            try {
                console.log(`Type of page before login: ${typeof page}`); // Debugging line
                isLoggedIn = await loginToMeetMe(browser, page, config.MEETME_USERNAME, config.MEETME_PASSWORD);
                if (!isLoggedIn) {
                    logger.error(`Login attempt ${loginAttempts + 1} failed`);
                    await page.waitForTimeout(3000); // Wait for 3 seconds before retrying
                }
            } catch (loginError) {
                logger.error(`Error during login attempt ${loginAttempts + 1}: ${loginError.message}`);
            }
            loginAttempts++;
        }

        if (!isLoggedIn) {
            logger.error('All login attempts failed');
            throw new Error('Login failed');
        }

        logger.info('Login successful. Waiting before navigating to chat...');
        await page.waitForTimeout(5000);

        logger.info('Attempting to navigate to chat page...');
        let isChatPageLoaded = await navigateToChatPage(page);
        
        let retryCount = 0;
        while (!isChatPageLoaded && retryCount < 3) {
            logger.error(`Failed to navigate to chat page. Retry attempt ${retryCount + 1}`);
            await page.waitForTimeout(5000 * (retryCount + 1)); // Exponential backoff
            await page.reload({ waitUntil: 'networkidle0' });
            isChatPageLoaded = await navigateToChatPage(page);
            retryCount++;
        }

        if (!isChatPageLoaded) {
            throw new Error('Failed to navigate to chat page after multiple attempts');
        }

        logger.info('Successfully navigated to chat page. Handling pop-ups...');
        await handlePopUps(page);

        logger.info('Extracting chat data...');
        const chatData = await extractChatData(page);
        logger.info(`Extracted ${chatData.length} messages`);
        chatData.forEach((message, index) => {
            logger.info(`Message ${index + 1}:`, JSON.stringify(message, null, 2));
        });

        if (chatData.length === 0) {
            logger.info('No chat data extracted. Ending process.');
            return;
        }

        const authClient = await authorize();
        const existingChatHistory = await getChatHistory(authClient);
        logger.info(`Existing chat history: ${JSON.stringify(existingChatHistory, null, 2)}`);

        const updates = [];
        for (const message of chatData) {
            const existingEntry = existingChatHistory.find(entry => 
                entry.url === message.href && entry.message === message.shortMessage
            );

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
            logger.info('Google Sheets updated successfully');
            
            // Send updates to RabbitMQ
            await sendToRabbitMQ(updates);
        } else {
            logger.info('No new messages to update.');
        }

    } catch (error) {
        logger.error(`Error in fetchMeetMeMessages: ${error.message}`);
        logger.error(`Error stack: ${error.stack}`);
        // Log the final page state
        const finalUrl = await page.url();
        const finalContent = await page.content();
        logger.error(`Final URL: ${finalUrl}`);
        logger.error(`Final page content: ${finalContent.substring(0, 500)}...`);
    } finally {
        await browser.close();
    }
}

fetchMeetMeMessages();
