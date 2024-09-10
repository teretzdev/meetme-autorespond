import amqp from 'amqplib';
import puppeteer from 'puppeteer';
import logger from './src/utils/logger.js';

const rateLimit = 10; // Maximum number of requests per second
const tokenBucket = [];

// Define states
const States = {
  INIT: 'Init',
  CONSUME: 'Consume',
  PROCESS_MESSAGE: 'Process Message',
  ERROR: 'Error',
};

// State machine implementation
class ConsumerStateMachine {
  constructor() {
    this.state = States.INIT;
  }

  async transition(newState) {
    logger.info(`Transitioning from ${this.state} to ${newState}`);
    this.state = newState;

    switch (this.state) {
      case States.INIT:
        await this.initialize();
        break;
      case States.CONSUME:
        await this.consumeMessages();
        break;
      case States.PROCESS_MESSAGE:
        // This state is handled within the consumeMessages method
        break;
      case States.ERROR:
        this.handleError();
        break;
      default:
        logger.error('Unknown state:', this.state);
    }
  }

  async initialize() {
    try {
      logger.info('Initializing consumer...');
      await this.transition(States.CONSUME);
    } catch (error) {
      logger.error('Initialization error:', error);
      this.transition(States.ERROR);
    }
  }

  async consumeMessages() {
    try {
      const connection = await amqp.connect('amqp://localhost');
      const channel = await connection.createChannel();
      const queue = 'meetme_queue';

      await channel.assertQueue(queue, { durable: true });

      logger.info(`Waiting for messages in queue: ${queue}`);
      channel.consume(queue, async (msg) => {
        if (msg !== null) {
          const message = JSON.parse(msg.content.toString());
          await this.processMessage(message, channel, msg);
        }
      }, { noAck: false });
    } catch (error) {
      logger.error('Error consuming messages:', error);
      this.transition(States.ERROR);
    }
  }

  async processMessage(message, channel, msg) {
    const { replyText, href } = message;

    // Rate limiting logic
    if (tokenBucket.length >= rateLimit) {
      await new Promise(resolve => setTimeout(resolve, 1000)); // Wait for a second
      tokenBucket.shift();
    }
    tokenBucket.push(true);

    try {
      logger.info(`Processing message: ${JSON.stringify(message)}`);
      const browser = await puppeteer.launch();
      const page = await browser.newPage();
      await page.goto(href);

      // ... your sendReply logic here ...

      await browser.close();
      channel.ack(msg); // Acknowledge the message after successful reply
      logger.info('Message processed and acknowledged:', message);
    } catch (error) {
      logger.error('Error processing message:', error);
      // Handle error, e.g., retry, dead-letter exchange, logging
      channel.nack(msg, false, false); // Negative acknowledgment
    } finally {
      tokenBucket.shift();
    }
  }

  handleError() {
    logger.error('An error occurred in state:', this.state);
    // Handle error logic, e.g., logging, cleanup, etc.
  }
}

// Start the consumer state machine
const consumer = new ConsumerStateMachine();
consumer.transition(States.INIT);