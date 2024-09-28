import puppeteer from 'puppeteer';
import { google } from 'googleapis';
import { authorize, getChatHistory, updateChatHistory } from './src/services/sheetService.js';
import { initializeBrowser, loginToMeetMe, navigateToChatPage, handlePopUps, extractChatData } from './src/services/meetmeService.js';
import { AIAgent } from './src/agents/aiAgent.js';
import config from './src/config/config.js';
import logger from './src/utils/logger.js';
import { setupDatabase, setupRabbitMQ } from './src/utils/setup.cjs';

async function fetchMeetMeMessages() {
  const browser = await puppeteer.launch({ headless: false });
  const page = await browser.newPage();

  const aiAgent = new AIAgent(); // Initialize the AI agent

  try {
    const authClient = await authorize();
    const db = await setupDatabase();
    const { channel } = await setupRabbitMQ();

    let isLoggedIn = false;
    for (let attempt = 1; attempt <= 3; attempt++) {
      isLoggedIn = await loginToMeetMe(page, config.MEETME_USERNAME, config.MEETME_PASSWORD);
      if (isLoggedIn) break;
      logger.warn(`Login attempt ${attempt} failed. Retrying...`);
      await page.waitForTimeout(3000); // Wait before retrying
    }
    if (!isLoggedIn) throw new Error('Login failed after multiple attempts');

    logger.info('Login successful. Waiting before navigating to chat...');
    await page.waitForTimeout(1000);

    logger.info('Attempting to navigate to chat page...');
    let isChatPageLoaded = await navigateToChatPage(page);
    
    if (!isChatPageLoaded) {
      logger.error('Failed to navigate to chat page. Retrying with forced reload...');
      await page.reload({ waitUntil: 'networkidle0' });
      isChatPageLoaded = await navigateToChatPage(page);
      if (!isChatPageLoaded) {
        logger.error('Failed to navigate to chat page after first retry. Waiting 5 seconds before second retry...');
        await page.waitForTimeout(5000);
        await page.reload({ waitUntil: 'networkidle0' });
        isChatPageLoaded = await navigateToChatPage(page);
        if (!isChatPageLoaded) {
          throw new Error('Failed to navigate to chat page after multiple attempts');
        }
      }
    }

    logger.info('Successfully navigated to chat page. Handling pop-ups...');
    await handlePopUps(page);

    logger.info('Extracting chat data...');
    let chatData = [];
    try {
      chatData = await extractChatData(page);
      if (!Array.isArray(chatData) || chatData.length === 0) {
        throw new Error('No chat data extracted or data structure is invalid');
      }
      logger.info(`Extracted chat data: ${JSON.stringify(chatData, null, 2)}`);
    } catch (error) {
      logger.error(`Error extracting chat data: ${error.message}`);
      return; // Exit if chat data extraction fails
    }

    if (chatData.length === 0) {
      logger.info('No chat data extracted. Ending process.');
      return;
    }

    const existingChatHistory = await getChatHistory(authClient);
    logger.info(`Existing chat history: ${JSON.stringify(existingChatHistory, null, 2)}`);

    for (const message of chatData) {
      // Skip messages that should not be processed
      if (message.shortMessage.startsWith('Liked your photo!') || 
          message.shortMessage.startsWith('Seen') || 
          message.shortMessage.startsWith('Sent')) {
        logger.info(`Skipping message: ${message.shortMessage}`);
        continue;
      }

      const userCode = message.href.match(/\/(\d+)\/chat$/)[1];
      const userHistory = existingChatHistory.filter(entry => entry[0] === message.username);
      const mostRecentMessage = userHistory.reduce((latest, entry) => entry[1] > latest ? entry[1] : latest, 0);

      // Only process messages newer than the most recent message in the user's history
      if (message.timeSent <= mostRecentMessage) {
        logger.info(`Skipping older message: ${message.shortMessage}`);
        continue;
      }

      const existingEntry = existingChatHistory.find(entry => entry[3] === message.href && entry[2] === message.shortMessage);
      if (!existingEntry) {
        try {
          // Retrieve and format the user's chat history
          const userChatHistory = existingChatHistory.filter(entry => entry[0] === message.username);
          const formattedChatHistory = userChatHistory.map(entry => ({
            timestamp: entry[1],
            message: entry[2],
            href: entry[3]
          }));

          // Include chat history in the message payload
          const messageWithHistory = {
            ...message,
            chatHistory: formattedChatHistory
          };

          channel.sendToQueue('meetme_processed', Buffer.from(JSON.stringify(messageWithHistory)), { persistent: true });
          logger.info(`Sent message with history to 'messages_to_process': ${JSON.stringify(messageWithHistory)}`);
        } catch (error) {
          logger.error(`Failed to send message to 'meetme_processed': ${error.message}`);
        }
      }
    }

    logger.info('Messages fetched and queued for processing');

  } catch (error) {
    logger.error(`Error in fetchMeetMeMessages: ${error.message}`);
    logger.error(`Error stack: ${error.stack}`);
  } finally {
    await browser.close();
  }
}

// Run fetch job every X minutes
const fetchInterval = config.FETCH_INTERVAL || 15 * 60 * 1000; // Default 15 minutes
setInterval(fetchMeetMeMessages, fetchInterval);

// Initial run
fetchMeetMeMessages();

