const amqp = require('amqplib');
const express = require('express');

class RabbitMQAutomaEndpoint {
  constructor(rabbitmqUrl = 'amqp://localhost', inputQueue = 'meetme_queue') {
    this.rabbitmqUrl = rabbitmqUrl;
    this.inputQueue = inputQueue;
    this.app = express();
    this.channel = null;
  }

  async start() {
    try {
      const connection = await amqp.connect(this.rabbitmqUrl);
      console.log('Connected to RabbitMQ');

      this.channel = await connection.createChannel();
      console.log('Channel created');

      await this.channel.assertQueue(this.inputQueue, { durable: true });
      console.log(`Queue '${this.inputQueue}' asserted`);

      this.setupHttpServer();
    } catch (error) {
      console.error('Error in RabbitMQ setup:', error);
    }
  }

  setupHttpServer() {
    this.app.get('/get-message', async (req, res) => {
      try {
        const message = await this.consumeMessage();
        if (message) {
          res.json(message);
        } else {
          res.json({ status: 'no_message', message: 'No message available in the queue' });
        }
      } catch (error) {
        console.error('Error processing request:', error);
        res.status(500).json({ status: 'error', message: error.message });
      }
    });

    const port = 3001;
    this.app.listen(port, () => {
      console.log(`HTTP server listening on port ${port}`);
    });
  }

  async consumeMessage() {
    const msg = await this.channel.get(this.inputQueue, { noAck: false });
    if (msg) {
      this.channel.ack(msg);
      return JSON.parse(msg.content.toString());
    }
    return null;
  }
}

// Usage
const endpoint = new RabbitMQAutomaEndpoint();
endpoint.start();

module.exports = RabbitMQAutomaEndpoint;
