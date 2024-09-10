import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import logger from '../utils/logger.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export async function saveCookies(page) {
  const cookies = await page.cookies();
  const cookiePath = path.join(__dirname, '../../meetme_cookies.json');
  await fs.writeFile(cookiePath, JSON.stringify(cookies, null, 2));
  logger.info('Cookies saved successfully');
}

async function loadCookies(page) {
  const cookiePath = path.join(__dirname, '../../meetme_cookies.json');
  try {
    const cookieData = await fs.readFile(cookiePath, 'utf8');
    const cookies = JSON.parse(cookieData);
    await page.setCookie(...cookies);
    logger.info('Cookies loaded successfully');
    return true;
  } catch (error) {
    logger.warn(`Failed to load cookies: ${error.message}`);
    return false;
  }
}

export { loadCookies };