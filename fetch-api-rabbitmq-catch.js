const express = require('express');
const amqp = require('amqplib');
const bodyParser = require('body-parser');

class ApiToRabbitMQBridge {
  constructor(port = 2090, rabbitmqUrl = 'amqp://localhost', queueName = 'meetme_queue') {
    this.port = port;
    this.rabbitmqUrl = rabbitmqUrl;
    this.queueName = queueName;
    this.app = express();
    this.setupMiddleware();
    this.setupRoutes();
  }

  setupMiddleware() {
    this.app.use(bodyParser.json());
  }

  setupRoutes() {
    this.app.post('/api/message', this.handleMessage.bind(this));
  }

  async handleMessage(req, res) {
    console.log('Received POST request to /api/message');
    console.log('Request body:', req.body);

    const { name, message, timestamp, url } = req.body;
    
    if (!this.validateInput(name, message, timestamp, url)) {
      console.warn('Missing required fields in request');
      return res.status(400).json({ error: 'Missing required fields' });
    }
    
    // Determine the phase based on the message content
    const phase = determinePhase(message); // Assuming you have a function to determine the phase

    const data = { name, message, timestamp, url, phase }; // Include phase in the data
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
      
     // await channel.assertQueue(this.queueName, { durable: false });
     // console.log(`Queue '${this.queueName}' asserted`);

      channel.sendToQueue(this.queueName, Buffer.from(JSON.stringify(data)));
      console.log('Message sent to RabbitMQ:', data);
	
	const queueInfo = await channel.assertQueue(this.queueName, { durable: true }); 
	console.log('Queue asserted:', queueInfo);
      
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
