//src/controllers/messageProcessor.js

import { getCells, updateCells } from '../services/sheetsService.js';
import { sendMessageToAPI } from '../api/messageApi.js';
import { rateLimiter } from '../utils/rateLimiter.js';
import logger from '../utils/logger.js';

export async function processCells(authClient) {
  const cells = await getCells(authClient);
  let processedCount = 0;
  let lastProcessedRow = 0;

  for (let i = 1; i < cells.length; i++) {
    const cell = {
      rowIndex: i + 1,
      message: cells[i][3],
      status: cells[i][6],
    };

    if (cell.status === 'processed' || !cell.message) continue;

    try {
      await rateLimiter();
      const apiResponse = await sendMessageToAPI(cell.message);
      if (apiResponse) {
        await updateCells(authClient, [
          { range: `Sheet1!F${cell.rowIndex}`, values: [[apiResponse]] },
          { range: `Sheet1!G${cell.rowIndex}`, values: [['processed']] },
        ]);
        processedCount++;
        lastProcessedRow = cell.rowIndex;
        logger.info(`Processed row ${cell.rowIndex} successfully`);
      }
    } catch (error) {
      logger.error(`Error processing row ${cell.rowIndex}: ${error.message}`, { stack: error.stack });
      await updateCells(authClient, [
        { range: `Sheet1!G${cell.rowIndex}`, values: [['error']] },
      ]);
    }
  }

  return { processedCount, lastProcessedRow };
}