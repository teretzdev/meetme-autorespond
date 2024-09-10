import { google } from 'googleapis';
import { JWT } from 'google-auth-library';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import logger from '../utils/logger.js';
import config from '../config/config.js';

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
            credentials = JSON.parse(fileContent);
            logger.info('Credentials file read successfully');
        } catch (readError) {
            logger.error(`Error reading credentials file: ${readError.message}`);
            throw readError;
        }

        if (!credentials.client_email || !credentials.private_key) {
            logger.error('Credentials file missing client_email or private_key');
            throw new Error('Missing required credential fields');
        }

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

async function getUncontactedUsers(authClient) {
    logger.info('Fetching uncontacted users from Google Sheets');
    const sheets = google.sheets({ version: 'v4', auth: authClient });
    try {
        const res = await sheets.spreadsheets.values.get({
            spreadsheetId: config.SPREADSHEET_ID,
            range: 'UncontactedUsers!A2:C',
        });
        const rows = res.data.values;
        if (!rows || rows.length === 0) {
            logger.warn('No uncontacted users found in Google Sheets');
            return [];
        }
        const uncontactedUsers = rows.map((row, index) => ({
            rowIndex: index + 2,
            username: row[0] || '',
            href: row[1] || '',
            status: row[2] || '',
        }));
        logger.info(`Found ${uncontactedUsers.length} uncontacted users`);
        return uncontactedUsers;
    } catch (error) {
        logger.error(`Error retrieving uncontacted users: ${error.message}`, { stack: error.stack });
        throw error;
    }
}

async function updateUserStatus(authClient, rowIndex, status) {
    const sheets = google.sheets({ version: 'v4', auth: authClient });
    try {
        await sheets.spreadsheets.values.update({
            spreadsheetId: config.SPREADSHEET_ID,
            range: `UncontactedUsers!C${rowIndex}`,
            valueInputOption: 'RAW',
            resource: { values: [[status]] },
        });
        logger.info(`Updated status for row ${rowIndex} to '${status}'`);
    } catch (error) {
        logger.error(`Error updating user status: ${error.message}`, { stack: error.stack });
    }
}

export { authorize, getUncontactedUsers, updateUserStatus };
