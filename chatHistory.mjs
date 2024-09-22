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

      // Check if the message should be ignored
      if (message.message.startsWith('Liked your photo!') || 
          message.message.startsWith('Seen') || 
          message.message.startsWith('Sent')) {
        console.log(`Message ignored for user ${username}: ${message.message}`);
        return;
      }

      // Check for message uniqueness
      const isUnique = !data.chatHistory.some(entry => 
        entry.message === message.message && entry.timestamp === message.timestamp
      );

      if (!isUnique) {
        console.log(`Duplicate message skipped for user ${username}: ${message.message}`);
        return;
      }

      const userHistoryEntry = {
        timestamp: message.timestamp,
        user: message.name,
        message: message.message,
        currentPhase: currentPhase
      };

      data.chatHistory.push(userHistoryEntry);

      await fs.writeFile(filePath, JSON.stringify(data, null, 2));
      console.log(`Message added to history for user ${username} with phase: ${currentPhase}`);
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

