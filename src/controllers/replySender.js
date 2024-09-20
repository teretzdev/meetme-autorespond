import { loginToMeetMe, sendReply, handlePopUps } from '../services/meetmeService.js';
import { getCells, updateCells } from '../services/sheetsService.js';
import config from '../config/config.js';
import logger from '../utils/logger.js';

export async function sendProcessedReplies(authClient, browser) {
  let page;
  try {
    const cells = await getCells(authClient);
    const processedCells = cells.slice(1).filter(row => !row[5] || row[5].toLowerCase() === 'processed');

    const { page: loggedInPage, isLoggedIn } = await loginToMeetMe(browser, config.MEETME_USERNAME, config.MEETME_PASSWORD);
    if (!isLoggedIn) {
      logger.error('Failed to log in to MeetMe');
      throw new Error('Failed to log in to MeetMe');
    }
    page = loggedInPage;

    // Log the successful login
    logger.info('Successfully logged in to MeetMe. Now processing messages...');

    await processMessages(page); // Ensure this is called to process messages

  } catch (error) {
    logger.error(`Error in sendProcessedReplies: ${error.message}`, { stack: error.stack });
  } finally {
    if (page) await page.close(); // Close the page only after processing
  }
}