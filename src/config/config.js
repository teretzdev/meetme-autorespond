// /src/config/config.js

import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config();

const config = {
  FETCH_INTERVAL: 5 * 60 * 1000, // 5 minutes
  CREDENTIALS_PATH: path.join(__dirname, 'credentials.json'), // Adjust this path as needed
  SPREADSHEET_ID: '1f4kV0ni9qtHO7JySis5ggNkJl_w6b4YMcUNcThetNWc',
  RANGE_NAME: 'Sheet1!A1:F1000',
  MEETME_USERNAME: 'cts89@myyahoo.com',
  MEETME_PASSWORD: 'Meetme1',
  API_ENDPOINT: process.env.API_ENDPOINT || 'https://toasty-cobra.loca.lt',
  PORT: process.env.PORT || 3001,
};

console.log('Loaded configuration:', config);

export default config;
