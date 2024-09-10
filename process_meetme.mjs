import amqp from 'amqplib';
import axios from 'axios';
import { ChatHistory } from './chatHistory.mjs'; // Change to named import if necessary
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import winston from 'winston'; // Import winston for logging
import { chatPhaseAnalyzer } from './chatPhaseAnalyzerSecondary.js'; // Use named import
import { promisify } from 'util';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const meetmeDataDir = path.join(__dirname, 'meetme_data');

// Ensure the directory exists
if (!fs.existsSync(meetmeDataDir)) {
  fs.mkdirSync(meetmeDataDir);
}

// Configure logger
const logger = winston.createLogger({
  level: 'info',
  format: winston.format.combine(
    winston.format.timestamp({
      format: 'YYYY-MM-DDTHH:mm:ss.sssZ' // Explicitly set the timestamp format
    }),
    winston.format.json()
  ),
  transports: [
    new winston.transports.Console(),
    new winston.transports.File({ filename: 'app.log' })
  ]
});

// Define the isValidTimestamp function
function isValidTimestamp(timestamp) {
    // Implement your validation logic here
    return !isNaN(Date.parse(timestamp)); // Example validation
}

// Static port for Flowise
const FLOWISE_PORT = 3000;

class RabbitMQFlowiseProcessor {
  constructor(rabbitmqUrl = 'amqp://localhost', inputQueue = 'meetme_queue', outputQueue = 'meetme_processed') {
    this.rabbitmqUrl = rabbitmqUrl;
    this.inputQueue = inputQueue;
    this.outputQueue = outputQueue;
    this.flowiseEndpoint = `http://localhost:${FLOWISE_PORT}/api/v1/prediction/3a0b9170-61a0-42a9-9bf2-142bd092dba7`;
    this.chatHistory = new ChatHistory(); // Create an instance of ChatHistory
    this.agentState = {};
    this.processMessage = this.processMessage.bind(this); // Ensure 'this' refers to the class instance
  }

  async processMessage(message) {
    // Your processing logic here
  }

  parseTimestamp(timestamp) {
    const now = Date.now();
    const timeUnits = {
      s: 1000,
      m: 60 * 1000,
      h: 60 * 60 * 1000,
      d: 24 * 60 * 60 * 1000,
      mo: 30 * 24 * 60 * 60 * 1000,
      y: 365 * 24 * 60 * 60 * 1000
    };

    // If it's already a number, assume it's a Unix timestamp in milliseconds
    if (!isNaN(timestamp)) {
      return parseInt(timestamp);
    }

    const match = timestamp.match(/^(\d+)\s*([a-z]+)$/i);
    if (match) {
      const [, value, unit] = match;
      const multiplier = timeUnits[unit.toLowerCase()];
      if (multiplier) {
        return now - (parseInt(value) * multiplier);
      }
    }

    // If it doesn't match any known format, log an error and return current timestamp
    logger.error(`Invalid timestamp format: ${timestamp}`);
    return now;
  }

  async start() {
    try {
      logger.info(`Flowise endpoint set to: ${this.flowiseEndpoint}`);

      const connection = await amqp.connect(this.rabbitmqUrl);
      logger.info('Connected to RabbitMQ');

      const channel = await connection.createChannel();
      logger.info('Channel created');

      await channel.assertQueue(this.inputQueue, { durable: true });
      await channel.assertQueue(this.outputQueue, { durable: true });
      logger.info(`Queues '${this.inputQueue}' and '${this.outputQueue}' asserted`);

      logger.info(`Waiting for messages in queue '${this.inputQueue}'`);

      channel.consume(this.inputQueue, async (msg) => {
        if (msg !== null) {
          const messageContent = JSON.parse(msg.content.toString());
          const processedMessage = await this.processMessage(messageContent);
          if (processedMessage) {
            await this.sendToFlowiseAndRequeue(channel, processedMessage);
          }
          channel.ack(msg);
        }
      });

    } catch (error) {
      logger.error('Error in RabbitMQ processing:', error);
    }
  }

  // ... rest of the class implementation ...
}

// Usage
const processor = new RabbitMQFlowiseProcessor();
processor.start();

export default RabbitMQFlowiseProcessor;
