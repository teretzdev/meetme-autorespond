import { authorize } from './src/auth/googleAuth.js';
import pkg from './src/utils/setup.cjs';
import { setupDatabase, setupRabbitMQ } from './src/utils/setup.cjs'; // Changed from import to require
import { AIAgent } from './src/agents/aiAgent.js';
import { updateChatHistory, formatChatHistory } from './src/services/sheetService.js';
import logger from './src/utils/logger.js';
import { ChatHistory } from './chatHistory.mjs'; // Import ChatHistory class

async function processMessages(db, channel, authClient) {
  const aiAgent = new AIAgent(); // Initialize the AI agent
  channel.consume('meetme_processed', async (msg) => {
    logger.info('Received a message to process'); // Log when a message is received
    if (msg !== null) {
      const message = JSON.parse(msg.content.toString());
      try {
        logger.info(`Processing message ${message.id}`);
        
        // Load user's chat history
        const chatHistory = new ChatHistory();
        const userHistory = await chatHistory.getHistory(message.username);

        // Skip processing if message is older or same timestamp
        const isOlderOrSame = userHistory.some(entry => 
          entry.timestamp >= message.timestamp
        );
        if (isOlderOrSame) {
          logger.info(`Skipping message for user ${message.username} due to older or same timestamp`);
          channel.ack(msg);
          return;
        }

        const formattedHistory = formatChatHistory(userHistory);
        
        // Determine the user's phase
        const currentPhase = determinePhase(userHistory);
        const phaseNumber = getPhaseNumber(currentPhase); // Use getPhaseNumber to get the phase number

        await aiAgent.processMessage(message.shortMessage, formattedHistory); // Use AI agent to process message
        const aiResponse = aiAgent.getResponse(); // Get the response from AI agent
        logger.info(`AI Response for user ${message.username}: ${JSON.stringify(aiResponse)}`);

        // Check for duplicate reply
        const lastSentMessage = userHistory.reverse().find(entry => entry.user === 'AI');
        if (lastSentMessage && lastSentMessage.message === aiResponse.message) {
          logger.info(`Duplicate reply detected for user ${message.username}. Skipping processing.`);
          channel.ack(msg);
          return;
        }
        
        await db.run("UPDATE messages SET reply_to_send = ?, status = 'processed' WHERE id = ?", [aiResponse.message, message.id]);
        
        const updates = [[
          message.username,
          message.timeSent,
          message.shortMessage,
          message.href,
          aiResponse.message,
          'processed',
          currentPhase, // Include the current phase
          phaseNumber   // Include the phase number
        ]];
        await updateChatHistory(authClient, updates);
        
        // Update user's chat history
        await chatHistory.addToHistory(message.username, message, currentPhase);

        channel.sendToQueue('replies_to_send', Buffer.from(JSON.stringify({
          id: message.id,
          href: message.href,
          reply: aiResponse.message,
          phase: currentPhase, // Include the phase in the message
          phaseNumber: phaseNumber // Include the phase number in the message
        })), { persistent: true });

        console.log(`Sent message to queue with phase: ${currentPhase}`); // Log phase

        channel.ack(msg);
      } catch (error) {
        logger.error(`Error processing message ${message.id}: ${error.message}`);
        await db.run("UPDATE messages SET status = 'error' WHERE id = ?", message.id);
        channel.ack(msg);
      }
    }
  });
}

async function startProcessing() {
  try {
    logger.info('Starting message processing');
    const authClient = await authorize();
    logger.info('Authorization successful'); // Log after successful authorization
    const db = await setupDatabase();
    logger.info('Database setup successful'); // Log after database setup
    const { channel } = await setupRabbitMQ();
    logger.info('RabbitMQ setup successful'); // Log after RabbitMQ setup
    await processMessages(db, channel, authClient);
  } catch (error) {
    logger.error(`Error in message processing: ${error.message}`, { stack: error.stack });
  }
}

startProcessing();

