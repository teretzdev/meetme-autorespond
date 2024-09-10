import { queryJessAI } from './services/jessAI.js';
import config from './config/config.js';

// Simulated chat history
const testChatHistory = [
  "User: Hi there!",
  "Jess: Hello! How can I help you today?",
  "User: I'm looking for new friends.",
  "Jess: That's great! MeetMe is a perfect place to make new connections. What kind of friends are you looking for?"
];

// Test message
const testMessage = "I'm interested in meeting people who like hiking and outdoor activities.";

async function testAIResponse() {
  try {
    const formattedHistory = testChatHistory.join('\n');
    const formattedInput = `${formattedHistory}\nUser: ${testMessage}\nJess:`;
    
    console.log("Input to Jess AI:");
    console.log(formattedInput);
    console.log("\n---\n");

    const aiResponse = await queryJessAI(testMessage, formattedHistory);

    console.log("Response from Jess AI:");
    console.log(aiResponse.message);
  } catch (error) {
    console.error(`Error: ${error.message}`);
  }
}

testAIResponse();