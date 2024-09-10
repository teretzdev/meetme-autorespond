import puppeteer from 'puppeteer';
import { getTimestamp } from '../utils/timeUtils.js'; // Updated import statement
import { storeResponse } from '../services/sendProcessedReplies.js';
//import { queryJessAI } from '../jessAI';
import { sendMessageToAPI } from '../api/messageApi.js';
import logger from '../utils/logger.js';


async function queryJessAI(message) {
  try {
    const response = await sendMessageToAPI(message);
    return response;
  } catch (error) {
    console.error(`Error querying JessAI: ${error.message}`);
    return { message: 'Default reply message' };
  }
}

import fs from 'fs';
import { type } from 'os';

let skippedMessages = [];

export async function loginToMeetMe(browser, page, username, password) {
  logger.info('Starting MeetMe login process');
  const maxAttempts = 3;
  const waitTime = 3000; // 3 seconds

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      await page.goto('https://www.meetme.com', { waitUntil: 'networkidle2' });
      logger.info(`Page loaded. Current URL: ${page.url()}`);

      logger.info('Waiting for login button');
      const loginButton = await page.waitForSelector('#marketing-header-login .btn-black', { visible: true, timeout: 25000 });
      await loginButton.click();

      logger.info('Entering credentials');
      await page.waitForSelector('#site-login-modal-email', { visible: true, timeout: 25000 });
      await typeSlowly('#site-login-modal-email', username);
      await typeSlowly('#site-login-modal-password', password);

      logger.info('Submitting login form');
      await Promise.all([
        page.click('#site-login-modal-submit-group > button'),
        page.waitForNavigation({ waitUntil: 'networkidle0' })
      ]);

      for (let checkAttempt = 1; checkAttempt <= 3; checkAttempt++) {
        await page.waitForTimeout(waitTime);
        const currentUrl = page.url();
        logger.info(`Check attempt ${checkAttempt}: Current URL after login: ${currentUrl}`);

        if (currentUrl.includes('#meet') || currentUrl.includes('app.meetme.com')) {
          logger.info('Successfully logged in to MeetMe');
          return true;
        }
      }

      logger.warn(`Login attempt ${attempt} unsuccessful. URL does not indicate successful login.`);
      
      if (attempt < maxAttempts) {
        logger.info(`Retrying login in ${waitTime / 1000} seconds...`);
        await page.waitForTimeout(waitTime);
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
  return false;
}

export async function handlePopUps(page) {
  try {
    console.log('Handling pop-ups or overlays...');

    const selectors = [
      '#enable-push-notifications .modal-footer button.btn-primary',
      '#nav-chat > a > div > span:nth-child(1)'
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

export async function navigateToChatPage(page) {
  logger.info('Navigating to chat page...');
  try {
    const chatUrl = 'https://beta.meetme.com/#chat';
    
    // Use page.goto() to navigate to the chat URL
    await page.goto(chatUrl, { waitUntil: 'networkidle0', timeout: 30000 });
    
    logger.info('Navigation initiated. Waiting for page load...');
    
    // Wait for the chat section to be visible
    await page.waitForSelector('#chat-section', { visible: true, timeout: 30000 });
    
    const currentUrl = await page.url();
    logger.info(`Page loaded. Current URL: ${currentUrl}`);

    // Verify we're on the chat page
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
    // Log the current page content for debugging
    const currentUrl = await page.url();
    logger.error(`Current URL after navigation attempt: ${currentUrl}`);
    const pageContent = await page.content();
    logger.error(`Current page content: ${pageContent.substring(0, 500)}...`);
    return false;
  }
}

async function saveChatData(chatData) {
  try {
    console.log('Saving chat data...');
    const jsonData = JSON.stringify(chatData, null, 2);
    fs.writeFileSync('chatData.json', jsonData);
    console.log('Saved chat data successfully.');
    return true;
  } catch (error) {
    console.error('Error saving chat data:', error);
    return false;
  }
}
// Helper function to type slowly
async function typeSlowly(page, selector, text) {
  await page.waitForSelector(selector);
  for (let char of text) {
    await page.type(selector, char, { delay: 100 }); // 100ms delay between keystrokes
  }
}
async function fetchAndProcessMessages({ page }) {
  let messages = [];
  let totalMessagesCount = 0;
  let skippedMessagesCount = 0;
  let addedMessagesCount = 0;

  try {
    console.log('Fetching messages...');
    await handlePopUps(page);

    await page.waitForTimeout(5000);

    const chatItemElements = await page.$$('#chat-section ol.media-list.chat-list > li');
    totalMessagesCount = chatItemElements.length;

    if (totalMessagesCount === 0) {
      console.log('No chat items found.');
      return [];
    }

    console.log('Found', totalMessagesCount, 'chat items.');

    for (const chatItemElement of chatItemElements) {
      console.log('Extracting message...');
      const message = await extractMessage(chatItemElement);

      if (message) {
        console.log('Extracted message:', message.message);

        if (await isMessageUnique(message.message)) {
          console.log('Message is unique, processing...');
          await processUniqueMessage(page, message);
          addedMessagesCount++;
        } else {
          console.log('Message is not unique, skipping:', message.message);
          skippedMessagesCount++;
        }
      } else {
        console.log('Skipped a "typing" indicator or invalid message.');
        skippedMessagesCount++;
      }

      await page.waitForTimeout(1000);
    }

    console.log('Messages fetched and processed.');
    console.log(`Total messages: ${totalMessagesCount}`);
    console.log(`Skipped messages: ${skippedMessagesCount}`);
    console.log(`Added messages: ${addedMessagesCount}`);
  } catch (error) {
    console.error('Error during message processing:', error);
    throw error;
  }
}

export async function extractChatData(page) {
    logger.info('Starting chat data extraction');
    try {
      await page.waitForSelector('#chat-section', { timeout: 20000 });
      logger.info('Chat section found');
  
      const chatData = await page.evaluate(() => {
        const messages = document.querySelectorAll('#chat-section ol.media-list.chat-list > li');
        return Array.from(messages).map(message => {
          const username = message.querySelector('h5.media-heading')?.textContent.trim();
          const timeSent = message.querySelector('.media-date span')?.getAttribute('data-timestamp');
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

async function processUniqueMessage(page, message) {
  await storeMessage(message);

  const jessAIResponse = await queryJessAI(message.message);
  const reply = jessAIResponse.message || 'Default reply message';

  await sendMessageToMeetMe(page, message.respondLink, reply);
  await storeResponse(message.name, reply);
}

async function handleAIResponse(page, aiResponse, message) {
  if (aiResponse) {
    console.log(`AI response received, sending to MeetMe: ${aiResponse}`);
    await sendMessageToMeetMe(page, message.respondLink, aiResponse);
  } else {
    console.error('No AI response received, unable to send message to MeetMe.');
  }
}

async function sendMessageToMeetMe(page, respondLink, messageText) {
  console.log(`[${getTimestamp()}] Sending message to MeetMe...`);
  console.log(`[${getTimestamp()}] Respond Link: ${respondLink}`);
  console.log(`[${getTimestamp()}] Message Text: ${messageText}`);

  try {
    console.log(`[${getTimestamp()}] Navigating to chat URL`);
    await page.goto(respondLink);

    console.log(`[${getTimestamp()}] Waiting for message input field...`);
    await page.waitForSelector('.chat-form textarea', { timeout: 30000 });

    console.log(`[${getTimestamp()}] Typing message: ${messageText}`);
    await page.type('.chat-form textarea', messageText);

    console.log(`[${getTimestamp()}] Clicking send button...`);
    await page.click('.chat-form button[type="submit"]');

    console.log(`[${getTimestamp()}] Message sent successfully!`);
  } catch (error) {
    console.error(`[${getTimestamp()}] Error sending message to MeetMe:`, error);
  }
}

async function isMessageUnique(message) {
  // Implement your logic to check if the message is unique
  return true;
}

async function storeMessage(message) {
  // Implement your logic to store the message
}

export {
  //loginToMeetMe,
  //handlePopUps,
  fetchAndProcessMessages,
  sendMessageToMeetMe,
  //navigateToChatPage,
  saveChatData,
  handleAIResponse,
  //extractChatData,
};