import { sendMessageToAPI } from '../api/messageApi.js';
import logger from '../utils/logger.js';

export async function queryJessAI(message, chatHistory = '') {
  logger.info(`Querying JessAI with message: ${message}`);
  logger.info(`Chat history: ${chatHistory}`);

  try {
    // Format the input with chat history
    const formattedInput = `${chatHistory}\nUser: ${message}\nJess:`;
    logger.info(`Formatted input: ${formattedInput}`);

    // Send the formatted input to the API
    const response = await sendMessageToAPI(formattedInput);
    logger.info(`API response: ${JSON.stringify(response)}`);

    // Process the response
    const processedResponse = processResponse(response);
    logger.info(`Processed response: ${JSON.stringify(processedResponse)}`);

    return processedResponse;
  } catch (error) {
    logger.error(`Error querying JessAI: ${error.message}`);
    logger.error(`Error stack: ${error.stack}`);
    return { 
      message: 'Sorry, I encountered an error. Please try again later.',
      replyStatus: 'error'
    };
  }
}

function processResponse(response) {
  // Extract the message and replyStatus from the API response
  const message = response.message || 'No response received';
  const replyStatus = response.replyStatus || 'sent';

  // You can add additional processing here if needed
  // For example, you might want to clean up the message or handle specific replyStatus values

  return {
    message: message,
    replyStatus: replyStatus
  };
}

export function restoreReplyStatus(message, chatHistory) {
  // Find the message in the chat history
  const historyEntry = chatHistory.find(entry => entry.message === message);
  
  // If found, return the stored replyStatus, otherwise return 'unknown'
  return historyEntry ? historyEntry.replyStatus : 'unknown';
}