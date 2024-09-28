import { loginToMeetMe, sendReply, handlePopUps } from '../services/meetmeService.js';
import { getCells, updateCells } from '../services/sheetsService.js';
import config from '../config/config.js';
import logger from '../utils/logger.js';

export async function sendProcessedReplies(authClient, browser) {
  let page;
  try {
    const cells = await getCells(authClient);
    const processedCells = cells.slice(1).filter(row => !row[5] || row[5].toLowerCase() === 'processed');

    const { page: loggedInPage, isLoggedIn } = await loginToMeetMe(browser, config.MEETME_USERNAME, config.MEETME_PASSWORD, 3);
    if (!isLoggedIn) {
      logger.error('Failed to log in to MeetMe after multiple attempts');
      throw new Error('Failed to log in to MeetMe');
    }
    page = loggedInPage;

    logger.info('Successfully logged in to MeetMe. Now processing messages...');

    for (const cell of processedCells) {
      try {
        if (cell[4] && cell[4].toLowerCase() === 'duplicate') {
          logger.info(`Skipping duplicate message for ${cell[0]}`);
          continue;
        }
        await sendReply(page, cell[4], cell[3]);
        await updateCells(authClient, [{ range: `Sheet1!F${cell.rowIndex}`, values: [['sent']] }]);
        logger.info(`Message sent to ${cell[0]}`);
      } catch (sendError) {
        logger.error(`Failed to send message to ${cell[0]}: ${sendError.message}`);
      }
    }

  } catch (error) {
    logger.error(`Error in sendProcessedReplies: ${error.message}`, { stack: error.stack });
  } finally {
    if (page) await page.close();
  }
}

