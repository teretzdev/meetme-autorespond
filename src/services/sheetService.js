// src/services/sheetsService.js
import { google } from 'googleapis';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs'; // Ensure fs is imported correctly
import config from '../config/config.js';
import logger from '../utils/logger.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export async function authorize() {
  try {
    const credentialsPath = path.resolve(__dirname, '..', '..', config.CREDENTIALS_PATH);
    logger.info(`Attempting to load credentials from: ${credentialsPath}`);

    // Check if the file exists
    if (!fs.existsSync(credentialsPath)) {
      throw new Error(`Credentials file not found at ${credentialsPath}`);
    }

    // Log the contents of the credentials file (be careful with sensitive information)
    const credentialsContent = fs.readFileSync(credentialsPath, 'utf8');
    logger.info(`Credentials file content: ${credentialsContent.substring(0, 100)}...`);

    const auth = new google.auth.GoogleAuth({
      keyFile: credentialsPath,
      scopes: ['https://www.googleapis.com/auth/spreadsheets'],
    });

    const client = await auth.getClient();
    logger.info('Google Sheets API authorization successful.');
    return client;
  } catch (error) {
    logger.error(`Error authorizing Google Sheets API: ${error.message}`);
    throw error;
  }
}

export async function getCells(authClient, range) {
  const sheets = google.sheets({ version: 'v4', auth: authClient });
  try {
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId: config.SPREADSHEET_ID,
      range: range,
    });
    return response.data.values;
  } catch (error) {
    logger.error(`Error fetching cells: ${error.message}`);
    throw error;
  }
}

export async function updateCells(auth, updates) {
  const sheets = google.sheets({ version: 'v4', auth });

  try {
    const response = await sheets.spreadsheets.values.batchUpdate({
      spreadsheetId: config.SPREADSHEET_ID,
      resource: {
        valueInputOption: 'USER_ENTERED',
        data: updates
      }
    });
    logger.info(`${response.data.totalUpdatedCells} cells updated.`);
  } catch (error) {
    logger.error('Error updating cells:', error);
    throw error;
  }
}

export async function getChatHistory(authClient) {
  const sheets = google.sheets({ version: 'v4', auth: authClient });
  const range = 'Sheet1!A2:D'; // Adjust this range as needed

  try {
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId: config.SPREADSHEET_ID,
      range: range,
    });

    const rows = response.data.values;
    if (!rows || rows.length === 0) {
      logger.info('No data found in the sheet.');
      return [];
    }

    // Ensure each row has exactly 4 elements in the correct order
    return rows.map(row => {
      if (row.length !== 4) {
        logger.warn(`Row with incorrect number of elements: ${JSON.stringify(row)}`);
        // Pad the row with empty strings if necessary
        return [
          row[0] || '', // username
          row[1] || '', // timestamp
          row[2] || '', // message
          row[3] || ''  // href
        ];
      }
      return row;
    });
  } catch (error) {
    logger.error('Error fetching chat history:', error);
    throw error;
  }
}

export async function updateChatHistory(authClient, updates) {
  const sheets = google.sheets({ version: 'v4', auth: authClient });
  
  logger.info(`Attempting to update chat history with ${updates.length} records`);

  // Reformat the updates to match the desired column order
  const formattedUpdates = updates.map(update => [
    update[0],  // Column A: Username
    update[1],  // Column B: Timestamp
    update[2],  // Column C: Short message
    update[3],  // Column D: User code (from href)
  ]);

  logger.info(`Formatted updates to be written: ${JSON.stringify(formattedUpdates, null, 2)}`);

  try {
    // Clear existing data (rows 2-26)
    await sheets.spreadsheets.values.clear({
      spreadsheetId: config.SPREADSHEET_ID,
      range: 'Sheet1!A2:D26',
    });
    logger.info('Cleared existing data from Sheet1!A2:D26');

    if (formattedUpdates.length > 0) {
      // Write the new data
      const response = await sheets.spreadsheets.values.update({
        spreadsheetId: config.SPREADSHEET_ID,
        range: 'Sheet1!A2:D',
        valueInputOption: 'USER_ENTERED',
        resource: { values: formattedUpdates },
      });

      logger.info(`Sheets API response: ${JSON.stringify(response.data, null, 2)}`);
      logger.info(`Chat history updated successfully. ${formattedUpdates.length} records written.`);
    } else {
      logger.warn('No updates to write to the sheet.');
    }
  } catch (error) {
    logger.error(`Error updating chat history: ${error.message}`);
    logger.error(`Error stack: ${error.stack}`);
    throw error;
  }
}

export function formatChatHistory(chatHistory) {
    if (!Array.isArray(chatHistory)) {
      logger.error(`Invalid chat history format: ${JSON.stringify(chatHistory)}`);
      return [];
    }
    return chatHistory.map(entry => {
      if (Array.isArray(entry) && entry.length >= 3) {
        return `${entry[1]}: ${entry[2]}\nJess: ${entry[4] || ''}`;
      } else {
        logger.error(`Invalid entry format: ${JSON.stringify(entry)}`);
        return '';
      }
    }).filter(Boolean);
  }