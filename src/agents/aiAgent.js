// src/agents/aiAgent.js

import { queryJessAI } from '../services/jessAI.js';

class AIAgent {
  constructor() {
    // Initialize any necessary properties for the AI agent
    this.lastResponse = null;
  }

  async processMessage(message, chatHistory) {
    try {
      // Use queryJessAI to generate a response based on the incoming message and chat history
      const response = await queryJessAI(message, chatHistory);
      this.lastResponse = response.message;
    } catch (error) {
      console.error('Error processing message with AI agent:', error);
      this.lastResponse = 'Sorry, I encountered an error. Please try again later.';
    }
  }

  getResponse() {
    // Return the generated response
    return this.lastResponse;
  }
}

export default AIAgent;

