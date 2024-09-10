import fetch from 'node-fetch';
import logger from '../utils/logger.js';

async function query(data) {
  const response = await fetch(
    "http://localhost:3000/api/v1/prediction/3a0b9170-61a0-42a9-9bf2-142bd092dba7",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify(data)
    }
  );
  const result = await response.json();
  return result;
}

export async function sendMessageToAPI(message, retryAttempts = 3) {
  let attempts = 0;
  while (attempts < retryAttempts) {
    try {
      logger.info(`Sending request to API with message: ${message}`);
      const apiResponse = await query({ question: message });

      logger.info(`API response data: ${JSON.stringify(apiResponse)}`);
      return apiResponse;
    } catch (error) {
      attempts++;
      logger.error(`Error sending message to API (attempt ${attempts}): ${error.message}`);
      if (attempts >= retryAttempts) {
        throw error;
      }
      logger.info(`Retrying... (${attempts}/${retryAttempts})`);
    }
  }
}

// Add this script to handle the global object in the browser context
if (typeof global === "undefined") {
  var global = {};
}
