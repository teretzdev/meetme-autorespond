import fs from 'fs/promises';
import path from 'path';

export class ChatHistory {
  constructor(dataDir = './meetme_data') {
    this.dataDir = dataDir;
  }

  async addToHistory(username, message, currentPhase) {
    const filePath = path.join(this.dataDir, `${username}.json`);
    
    try {
      let data = { chatHistory: [] };
      try {
        const fileContent = await fs.readFile(filePath, 'utf8');
        data = JSON.parse(fileContent);
        if (!Array.isArray(data.chatHistory)) {
          data.chatHistory = [];
        }
      } catch (error) {
        if (error.code !== 'ENOENT') {
          throw error;
        }
        // File doesn't exist, we'll create a new one
      }

      // Retrieve existing chat history
      const existingHistory = data.chatHistory;
      const mostRecentTimestamp = existingHistory.reduce((latest, entry) => Math.max(latest, entry.timestamp), 0);

      // Check if the message is unique and newer
      if (message.timestamp > mostRecentTimestamp) {
        const userHistoryEntry = {
          timestamp: message.timestamp,
          user: message.name,
          message: message.message,
          currentPhase: currentPhase // Now takes the phase as an argument
        };

        data.chatHistory.push(userHistoryEntry);
        await fs.writeFile(filePath, JSON.stringify(data, null, 2));
        console.log(`Message added to history for user ${username} with phase: ${currentPhase}`); // Log phase
      } else {
        console.log(`Skipping duplicate or older message for user ${username}: ${message.message}`);
      }
    } catch (error) {
      console.error(`Error adding message to history for user ${username}:`, error);
      throw error;
    }
  }



  async getHistory(username) {
    const filePath = path.join(this.dataDir, `${username}.json`);
    
    try {
      const data = await fs.readFile(filePath, 'utf8');
      const parsedData = JSON.parse(data);
      return Array.isArray(parsedData.chatHistory) ? parsedData.chatHistory : [];
    } catch (error) {
      if (error.code === 'ENOENT') {
        console.log(`No history found for user ${username}`);
        return [];
      }
      console.error(`Error reading history for user ${username}:`, error);
      throw error;
    }
  }
}

export default ChatHistory;

