import express from 'express';
import bodyParser from 'body-parser';
import amqp from 'amqplib';

async function main() {
    const { chatPhaseAnalyzer } = await import('./chatPhaseAnalyzer.js');
    // ... other code ...
}

main().catch(console.error);

class ApiToRabbitMQBridge {
  constructor(port = 2090, rabbitmqUrl = 'amqp://localhost', queueName = 'meetme_queue') {
    this.port = port;
    this.rabbitmqUrl = rabbitmqUrl;
    this.queueName = queueName;
    this.app = express();
    this.setupMiddleware();
    this.setupRoutes();
    
    // Define the phases
    this.PHASES = {
      PHASE_1: 'Play It Cool (Gauge Interest)',
      PHASE_2: 'Light Flirting with a Catch (Learn Location)',
      PHASE_3: 'Building Up to the Ask (Invitation \'Over\')',
      PHASE_4: 'Gas Money Time (Cashapp Request)',
    };
  }

  setupMiddleware() {
    this.app.use(bodyParser.json());
  }

  setupRoutes() {
    this.app.post('/api/message', this.handleMessage.bind(this));
  }

  async handleMessage(req, res) {
    // Import chatPhaseAnalyzer
    const { chatPhaseAnalyzer } = await import('./chatPhaseAnalyzer.js');
    console.log('Received POST request to /api/message');

    const { name, message, timestamp, url } = req.body;

    if (!this.validateInput(name, message, timestamp, url)) {
      console.warn('Missing required fields in request');
      return res.status(400).json({ error: 'Missing required fields' });
    }

    // Determine the phase based on the message content
    const userHistory = [{ message }]; // Create a user history array for phase determination
    const currentPhase = chatPhaseAnalyzer.determinePhase(userHistory); // Get the current phase

    const data = { name, message, timestamp, url, currentPhase }; // Include currentPhase in the data
    console.log('Validated data:', data);

    try {
      await this.sendToRabbitMQ(data);
      console.log('Successfully sent data to RabbitMQ');
      res.status(200).json({ message: 'Data received and sent to RabbitMQ' });
    } catch (error) {
      console.error('Error sending data to RabbitMQ:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  }

  validateInput(name, message, timestamp, url) {
    return name && message && timestamp && url;
  }

  async sendToRabbitMQ(data) {
    console.log('Attempting to connect to RabbitMQ...');
    try {
      const connection = await amqp.connect(this.rabbitmqUrl);
      console.log('Connected to RabbitMQ');

      const channel = await connection.createChannel();
      console.log('Channel created');

      await channel.assertQueue(this.queueName, { durable: true });
      console.log(`Queue '${this.queueName}' asserted`);

      channel.sendToQueue(this.queueName, Buffer.from(JSON.stringify(data)));
      console.log('Message sent to RabbitMQ:', data);

      setTimeout(() => {
        connection.close();
        console.log('RabbitMQ connection closed');
      }, 500);
    } catch (error) {
      console.error('Error sending message to RabbitMQ:', error);
      throw error;
    }
  }

  start() {
    this.app.listen(this.port, () => {
      console.log(`Server started and running at http://localhost:${this.port}`);
    });

    process.on('unhandledRejection', (reason, promise) => {
      console.error('Unhandled Rejection at:', promise, 'reason:', reason);
    });

    process.on('uncaughtException', (error) => {
      console.error('Uncaught Exception:', error);
      process.exit(1);
    });
  }
}

// Usage
const bridge = new ApiToRabbitMQBridge();
bridge.start();
