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

    const isLoggedIn = await loginToMeetMe(page, config.MEETME_USERNAME, config.MEETME_PASSWORD);
    if (!isLoggedIn) throw new Error('Login failed');

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
        await page.waitForTimeout(1000);
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
    const chatData = await extractChatData(page);
    logger.info(`Extracted chat data: ${JSON.stringify(chatData, null, 2)}`);

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
          const formattedHistory = formatChatHistory(userHistory);
          await aiAgent.processMessage(message.shortMessage, formattedHistory);
          const aiResponse = aiAgent.getResponse();
          message.aiResponse = aiResponse.message; // Attach AI response to the message

          channel.sendToQueue('meetme_processed', Buffer.from(JSON.stringify(message)), { persistent: true });
          logger.info(`Sent message to 'meetme_processed': ${JSON.stringify(message)}`);
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

