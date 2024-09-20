import { google } from 'googleapis';
import { JWT } from 'google-auth-library';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import puppeteer from 'puppeteer';
import logger from '../utils/logger.js';
import config from '../config/config.js';
import { processMessages } from './processMeetMeMessages.js'; // Adjust the path as necessary

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function authorize() {
    logger.info('Starting authorization process');
    try {
      const credentialsPath = path.join(__dirname, '/credentials.json');
      logger.info(`Attempting to read credentials from: ${credentialsPath}`);
      
      let credentials;
      try {
        const fileContent = await fs.readFile(credentialsPath, 'utf8');
        logger.info(`File content: ${fileContent.substring(0, 100)}...`); // Log the first 100 characters
        credentials = JSON.parse(fileContent);
        logger.info('Credentials file read successfully');
        logger.info(`Credentials keys: ${Object.keys(credentials).join(', ')}`);
      } catch (readError) {
        logger.error(`Error reading credentials file: ${readError.message}`);
        throw readError;
      }
  
      if (!credentials.client_email || !credentials.private_key) {
        logger.error('Credentials file missing client_email or private_key');
        throw new Error('Missing required credential fields');
      }
  
      logger.info(`Client email: ${credentials.client_email}`);
      logger.info(`Private key length: ${credentials.private_key.length}`);
  
      const client = new JWT({
        email: credentials.client_email,
        key: credentials.private_key,
        scopes: ['https://www.googleapis.com/auth/spreadsheets'],
      });
  
      logger.info('JWT client created, attempting to authorize...');
      await client.authorize();
      logger.info('Authorization successful');
      return client;
    } catch (error) {
      logger.error(`Error in authorization: ${error.message}`, { stack: error.stack });
      throw error;
    }
  }


async function getProcessedCells(authClient) {
  logger.info('Fetching processed cells from Google Sheets');
  const sheets = google.sheets({ version: 'v4', auth: authClient });
  try {
    const res = await sheets.spreadsheets.values.get({
      spreadsheetId: config.SPREADSHEET_ID,
      range: config.RANGE_NAME,
    });
    const rows = res.data.values;
    if (!rows || rows.length === 0) {
      logger.warn('No data found in Google Sheets');
      return [];
    }
    const processedCells = rows.slice(1).filter(row => {
      const replyStatus = row[5] || '';
      return replyStatus === '' || replyStatus === null || replyStatus.toLowerCase() === 'processed';
    }).map((row, index) => ({
      rowIndex: index + 2,
      replyToSend: row[4] || '',
      href: row[3] || '',
      replyStatus: row[5] || '',
    }));
    logger.info(`Found ${processedCells.length} processed cells`);
    return processedCells;
  } catch (error) {
    logger.error(`Error retrieving cells: ${error.message}`, { stack: error.stack });
    throw error;
  }
}

async function loginToMeetMe(browser, page, username, password) {
  logger.info('Starting MeetMe login process');
  try {
    logger.info('Navigating to MeetMe homepage');
    await page.goto('https://www.meetme.com', { waitUntil: 'networkidle2' });
    logger.info(`Page loaded. Current URL: ${page.url()}`);

    logger.info('Waiting for login button');
    const loginButton = await page.waitForSelector('#marketing-header-login .btn-black', { visible: true, timeout: 25000 });
    logger.info('Login button found. Clicking...');
    await loginButton.click();

    logger.info('Waiting for email input field');
    await page.waitForSelector('#site-login-modal-email', { visible: true, timeout: 25000 });
    logger.info('Email input field found. Entering credentials...');
    await page.type('#site-login-modal-email', username);
    await page.type('#site-login-modal-password', password);

    logger.info('Credentials entered. Submitting login form...');
    await Promise.all([
      page.click('#site-login-modal-submit-group > button'),
      page.waitForNavigation({ waitUntil: 'load' })
    ]);

    logger.info('Initial navigation complete. Waiting for 5 seconds...');
    await page.waitForTimeout(5000);

    logger.info('Checking if we have reached the #meet page...');
    let currentUrl = page.url();
    let attempts = 0;
    const maxAttempts = 30;
    const checkInterval = 2000;

    while (!currentUrl.includes('#meet') && attempts < maxAttempts) {
      logger.info(`Current URL: ${currentUrl}. Waiting for #meet... (Attempt ${attempts + 1}/${maxAttempts})`);
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
        return true;
      } else {
        logger.warn('URL contains #meet, but expected elements not found. Considering login successful, but flagging for review.');
        return true;
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

      return false;
    }
  } catch (error) {
    logger.error(`Error during login process: ${error.message}`, { stack: error.stack });
    return false;
  }
}

// Helper function to handle popups
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

export async function sendReply(page, replyText, href) {
    logger.info(`Attempting to send reply to ${href}`);
    try {
        // Log the URL before navigation
        logger.info(`Navigating to URL: ${href}`);

        // Validate the URL
        if (!href || typeof href !== 'string' || !href.startsWith('http')) {
            logger.error(`Invalid URL: ${href}`);
            throw new Error('Invalid URL for navigation');
        }

        await page.goto(href, { waitUntil: 'networkidle0', timeout: 60000 });
        logger.info('Navigation to chat page completed');

        // Handle sending the reply
        await page.type('selector-for-reply-input', replyText); // Adjust selector as needed
        await page.click('selector-for-send-button'); // Adjust selector as needed
        logger.info('Reply sent successfully');
    } catch (error) {
        logger.error(`Error sending reply: ${error.message}`);
        // Optionally, you can handle specific error types here
    }
}

async function processCells(cells, maxRetries = 3) {
  logger.info(`Starting to process ${cells.length} cells`);
  const browser = await puppeteer.launch({ headless: false });
  logger.info('Browser launched');
  const page = await browser.newPage();
  logger.info('New page created');
  const authClient = await authorize();

  // Login to MeetMe
  logger.info('Attempting to log in to MeetMe');
  const isLoggedIn = await loginToMeetMe(browser, page, config.MEETME_USERNAME, config.MEETME_PASSWORD);
  if (!isLoggedIn) {
    logger.error('Failed to log in to MeetMe. Exiting...');
    await browser.close();
    return;
  }
  logger.info('Successfully logged in to MeetMe');

  for (const cell of cells) {
    logger.info(`Processing cell at row ${cell.rowIndex}`);
    let retries = 0;
    while (retries < maxRetries) {
      try {
        await sendReply(page, cell.replyToSend, cell.href, authClient, cell.rowIndex);
        logger.info(`Successfully processed cell at row ${cell.rowIndex}`);
        break;
      } catch (error) {
        retries++;
        logger.warn(`Attempt ${retries} failed for cell ${cell.rowIndex}: ${error.message}`);
        if (retries >= maxRetries) {
          logger.error(`Failed to process cell ${cell.rowIndex} after ${maxRetries} attempts`);
          await updateCellStatus(authClient, cell.rowIndex, 'failed');
        } else {
          logger.info(`Waiting for ${5000 * retries}ms before retrying...`);
          await new Promise(resolve => setTimeout(resolve, 5000 * retries));
          logger.info('Retrying after checking login...');
          await loginToMeetMe(browser, page, config.MEETME_USERNAME, config.MEETME_PASSWORD);
        }
      }
    }
  }

  logger.info('Closing browser');
  await browser.close();
  logger.info('Browser closed');
}

async function storeResponse(name, reply) {
  try {
    const timestamp = getTimestamp();
    const response = { name, reply, timestamp };
    const data = JSON.stringify(response, null, 2);
    fs.appendFileSync('responses.json', data + ',\n');
    logger.info(`Response stored successfully for ${name}`);
  } catch (error) {
    logger.error(`Error storing response for ${name}: ${error.message}`);
  }
}


async function main() {
    logger.info('Starting send processed replies script');
    try {
      const authClient = await authorize();
      const processedCells = await getProcessedCells(authClient);
      logger.info(`Found ${processedCells.length} processed cells to send`);
      await processCells(processedCells);
      logger.info('Finished sending processed replies');
    } catch (error) {
      logger.error(`Script execution error: ${error.stack}`);
    }
  }

export { main, storeResponse };

export async function processMessages(page) {
    const messages = await fetchMessagesFromProcessed(); // Ensure this function is defined
    logger.info(`Fetched ${messages.length} messages from RabbitMQ.`); // Log the number of messages

    for (const message of messages) {
        logger.info(`Processing message: ${JSON.stringify(message)}`); // Log each message being processed

        // Extract the URL from the message
        const url = message.original.url; // Adjust this line based on your message structure
        if (!url || typeof url !== 'string' || !url.startsWith('http')) {
            logger.error(`Invalid or missing URL in message: ${JSON.stringify(message)}`);
            continue; // Skip this message if URL is not valid
        }

        await sendReply(page, message.flowiseResponse.text, url); // Pass the URL to sendReply
    }
}