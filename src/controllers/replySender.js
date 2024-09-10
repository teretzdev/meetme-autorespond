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

    for (const cell of processedCells) {
      try {
        await handlePopUps(page);
        const success = await sendReply(page, cell[4], cell[3]);
        if (success) {
          await updateCells(authClient, [
            { range: `Sheet1!E${cell[0]}`, values: [['sent']] },
          ]);
          logger.info(`Reply sent successfully for row ${cell[0]}`);
        }
      } catch (error) {
        logger.error(`Error sending reply for row ${cell[0]}: ${error.message}`, { stack: error.stack });
        await updateCells(authClient, [
          { range: `Sheet1!E${cell[0]}`, values: [['error']] },
        ]);
      }
    }
  } catch (error) {
    logger.error(`Error in sendProcessedReplies: ${error.message}`, { stack: error.stack });
  } finally {
    if (page) await page.close();
  }
}