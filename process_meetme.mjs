// process_meetme.mjs
import amqp from 'amqplib';
import axios from 'axios';
import express from 'express';
import bodyParser from 'body-parser';
import winston from 'winston';
import { fileURLToPath } from 'url';
import path from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Configure logger
const logger = winston.createLogger({
  level: 'debug', // Set to 'debug' for more verbose logging
  format: winston.format.combine(
    winston.format.timestamp({
      format: 'YYYY-MM-DDTHH:mm:ss.sssZ'
    }),
    winston.format.printf(({ level, message, timestamp }) => {
      return `${timestamp} ${level}: ${message}`;
    })
  ),
  transports: [
    new winston.transports.Console(),
    new winston.transports.File({ filename: 'app.log' })
  ]
});

const FLOWISE_PORT = 3000;
const API_PORT = 2089;
const RABBITMQ_URL = 'amqp://localhost';
const INPUT_QUEUE = 'meetme_queue';
const OUTPUT_QUEUE = 'meetme_processed';

class MeetMeProcessor {
  constructor() {
    this.app = express();
    this.flowiseEndpoint = `http://localhost:${FLOWISE_PORT}/api/v1/prediction/3a0b9170-61a0-42a9-9bf2-142bd092dba7`;
    this.setupExpress();
  }

  setupExpress() {
    this.app.use(bodyParser.json());
    this.app.post('/api/message', this.handleApiMessage.bind(this));
  }

  async setupRabbitMQ() {
    try {
      this.connection = await amqp.connect(RABBITMQ_URL);
      this.channel = await this.connection.createChannel();
      await this.channel.assertQueue(INPUT_QUEUE, { durable: true });
      await this.channel.assertQueue(OUTPUT_QUEUE, { durable: true });
      logger.info('RabbitMQ setup completed');
      logger.debug(`RabbitMQ connected to ${RABBITMQ_URL}`);
      logger.debug(`Input queue: ${INPUT_QUEUE}, Output queue: ${OUTPUT_QUEUE}`);
    } catch (error) {
      logger.error(`Error setting up RabbitMQ: ${error.message}`);
      logger.debug(`RabbitMQ setup error stack: ${error.stack}`);
      throw error; // Rethrow the error to be caught in the start method
    }
  }

  async handleApiMessage(req, res) {
    logger.info('Received POST request to /api/message');
    logger.debug(`API request body: ${JSON.stringify(req.body)}`);
    
    const { name, message, timestamp, url } = req.body;
    
    if (!this.validateInput(name, message, timestamp, url)) {
      logger.warn('Missing required fields in request');
      logger.debug(`Invalid input: ${JSON.stringify(req.body)}`);
      return res.status(400).json({ error: 'Missing required fields' });
    }
    
    const data = { name, message, timestamp, url };
    logger.info(`Validated data: ${JSON.stringify(data)}`);
    
    try {
      await this.sendToRabbitMQ(data);
      logger.info('Successfully sent data to RabbitMQ');
      res.status(200).json({ message: 'Data received and sent to RabbitMQ' });
    } catch (error) {
      logger.error(`Error sending data to RabbitMQ: ${error.message}`);
      logger.debug(`RabbitMQ send error stack: ${error.stack}`);
      res.status(500).json({ error: 'Internal server error' });
    }
  }

  validateInput(name, message, timestamp, url) {
    return name && message && timestamp && url;
  }

  async sendToRabbitMQ(data) {
    try {
      this.channel.sendToQueue(INPUT_QUEUE, Buffer.from(JSON.stringify(data)));
      logger.info(`Message sent to RabbitMQ: ${JSON.stringify(data)}`);
    } catch (error) {
      logger.error(`Error sending message to RabbitMQ: ${error.message}`);
      logger.debug(`RabbitMQ send error stack: ${error.stack}`);
      throw error;
    }
  }

  async processMessage(message) {
    try {
      console.log('Processing message:', this.safeStringify(message));

      // Ensure the message content is not empty
      if (!message.message || message.message.trim() === '') {
        logger.warn('Empty message content received. Skipping processing.');
        return null;
      }

      // Construct the payload for Flowise
      const flowisePayload = {
        question: message.message,
        history: [], // Add chat history if needed
        overrideConfig: {
          name: message.name,
          timestamp: message.timestamp,
          url: message.url,
          currentPhase: message.currentPhase
        }
      };

      logger.debug(`Payload being sent to Flowise: ${JSON.stringify(flowisePayload)}`);

      const flowiseResponse = await axios.post(this.flowiseEndpoint, flowisePayload);
      
      logger.info('Message processed successfully by Flowise');
      logger.debug(`Flowise response: ${JSON.stringify(flowiseResponse.data)}`);

      return {
        original: message,
        flowiseResponse: flowiseResponse.data,
        timestamp: new Date().toISOString()
      };
    } catch (error) {
      console.error('Error processing message:', this.safeStringify(error));
      throw error;
    }
  }

  // Add this method to safely stringify objects with circular references
  safeStringify(obj) {
    const seen = new WeakSet();
    return JSON.stringify(obj, (key, value) => {
      if (typeof value === 'object' && value !== null) {
        if (seen.has(value)) {
          return '[Circular]';
        }
        seen.add(value);
      }
      return value;
    });
  }

  async start() {
    try {
      await this.setupRabbitMQ();
  
      this.app.listen(API_PORT, () => {
        logger.info(`API server started on http://localhost:${API_PORT}`);
      });
  
      this.channel.consume(INPUT_QUEUE, async (msg) => {
        if (msg !== null) {
          try {
            logger.info(`Received message from RabbitMQ: ${msg.content.toString()}`);
            const messageContent = JSON.parse(msg.content.toString());
            logger.debug(`Parsed message content: ${JSON.stringify(messageContent)}`);
            
            const processedMessage = await this.processMessage(messageContent);
            
            if (processedMessage) {
              const safeProcessedMessage = JSON.parse(JSON.stringify(processedMessage, (key, value) => {
                if (typeof value === 'object' && value !== null) {
                  if (key === 'request' || key === 'response' || key === 'socket' || key === '_httpMessage') {
                    return '[Circular]';
                  }
                }
                return value;
              }));
  
              await this.channel.sendToQueue(
                OUTPUT_QUEUE,
                Buffer.from(JSON.stringify(safeProcessedMessage)),
                { persistent: true }
              );
              logger.info(`Processed message sent to queue '${OUTPUT_QUEUE}'`);
              logger.debug(`Processed message content: ${JSON.stringify(safeProcessedMessage)}`);
            } else {
              logger.warn('Processed message was null. Not sending to output queue.');
            }
            
            this.channel.ack(msg);
          } catch (error) {
            logger.error(`Error processing message: ${error.message}`);
            logger.debug(`Message processing error stack: ${error.stack}`);
            
            // Implement a delay before retrying
            await new Promise(resolve => setTimeout(resolve, 5000));
            
            // Negative acknowledge the message, requeue it
            this.channel.nack(msg, false, true);
          }
        }
      });
  
      logger.info('MeetMe Processor started');
    } catch (error) {
      logger.error(`Failed to start MeetMe Processor: ${error.message}`);
      logger.debug(`Start error stack: ${error.stack}`);
      throw error;
    }
  }
}

// Usage
const startProcessor = async () => {
  try {
    const processor = new MeetMeProcessor();
    await processor.start();
  } catch (error) {
    logger.error(`Error starting MeetMe Processor: ${error.message}`);
    logger.debug(`Start error stack: ${error.stack}`);
    process.exit(1);
  }
};

startProcessor();

export default MeetMeProcessor;