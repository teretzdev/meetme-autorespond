import { google } from 'googleapis';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { sendMessageToAPI } from '../api/messageApi.js';
import { rateLimiter } from '../utils/rateLimiter.js';
import config from '../config/config.js';
import logger from '../utils/logger.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const sheets = google.sheets('v4');

let CUSTOM_PROMPT;
try {
  CUSTOM_PROMPT = fs.readFileSync(path.join(__dirname, 'custom_prompt.txt'), 'utf8');
} catch (error) {
  logger.error(`Error loading custom prompt: ${error.message}`);
  process.exit(1);
}

async function authorize() {
  const auth = new google.auth.GoogleAuth({
    keyFile: path.join(__dirname, 'credentials.json'),
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });
  return auth.getClient();
}

async function getCells(authClient) {
  const request = {
    spreadsheetId: config.SPREADSHEET_ID,
    range: 'Sheet1!A:G',
    auth: authClient,
  };

  try {
    const response = await sheets.spreadsheets.values.get(request);
    return response.data.values;
  } catch (error) {
    logger.error(`Error fetching cells: ${error.message}`);
    throw error;
  }
}

async function updateCells(authClient, updates) {
  const request = {
    spreadsheetId: config.SPREADSHEET_ID,
    resource: {
      valueInputOption: 'RAW',
      data: updates,
    },
    auth: authClient,
  };

  try {
    await sheets.spreadsheets.values.batchUpdate(request);
  } catch (error) {
    logger.error(`Error updating cells: ${error.message}`);
    throw error;
  }
}

async function processCells(authClient, cells) {
  let processedCount = 0;
  let lastProcessedRow = 0;

  for (let rowIndex = 1; rowIndex < cells.length; rowIndex++) { // Start from 1 to skip the first row
    const cell = cells[rowIndex];
    try {
      // Skip processing if the message is marked as "Seen" or "Sent"
      const messageStatus = cell[4]; // Assuming column E (index 4) contains the status
      if (messageStatus === 'Seen' || messageStatus === 'Sent') {
        logger.info(`Skipping row ${rowIndex + 1} with status: ${messageStatus}`);
        continue; // Skip to the next iteration
      }

      if (messageStatus !== 'processed') {
        await rateLimiter();
        logger.info(`Processing row ${rowIndex + 1}`);
        const formattedMessage = `${CUSTOM_PROMPT}\n\nMessage:\n${cell[2]}`; // Using column C (index 2) as the message
        const apiResponse = await sendMessageToAPI(formattedMessage);

        // Log the API response to see what it contains
        logger.info(`API response for row ${rowIndex + 1}: ${JSON.stringify(apiResponse)}`);

        if (apiResponse && apiResponse.text) {
          logger.info(`Updating cell F${rowIndex + 1} with API response text`);
          const updates = [
            {
              range: `Sheet1!F${rowIndex + 1}`,
              values: [[apiResponse.text]], // Only update the text field
            },
            {
              range: `Sheet1!E${rowIndex + 1}`, // Update column E instead of G
              values: [['processed']],
            },
          ];
          await updateCells(authClient, updates);
          processedCount++;
          lastProcessedRow = rowIndex + 1;
        }
      }
    } catch (error) {
      logger.error(`Error processing row ${rowIndex + 1}: ${error.message}`);
    }
  }

  return { processedCount, lastProcessedRow };
}

export async function main(authClient) {
  try {
    const cells = await getCells(authClient);
    const { processedCount, lastProcessedRow } = await processCells(authClient, cells);
    logger.info(`Processed ${processedCount} messages. Last processed row: ${lastProcessedRow}`);
  } catch (error) {
    logger.error(`Main process error: ${error.message}`);
  }
}

import { fetchMessagesFromProcessed } from './fetchMessages.js'; // Adjust the path as necessary

export async function processMessages(page) {
    const messages = await fetchMessagesFromProcessed();

    if (!Array.isArray(messages)) {
        logger.error('Fetched messages is not an array:', messages);
        throw new Error('Fetched messages is not iterable');
    }

    for (const message of messages) {
        await sendReply(page, message.text, message.href);
    }
}