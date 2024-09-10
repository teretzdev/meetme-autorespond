// src/auth/googleAuth.js
import { google } from 'googleapis';
import { JWT } from 'google-auth-library';
import { promises as fs } from 'fs'; // Correct import for fs/promises
import path from 'path';
import { fileURLToPath } from 'url';
import logger from '../utils/logger.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function authorize() {
  logger.info('Starting authorization process');
  try {
    const credentialsPath = path.join(__dirname, '../../credentials.json');
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

    // Check if credentials are nested under 'installed' key
    if (credentials.installed) {
      credentials = credentials.installed;
      logger.info('Credentials found under "installed" key');
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

export { authorize };