export function setupDatabase() {
    const sqlite3 = require('sqlite3').verbose();
    const db = new sqlite3.Database(':memory:', (err) => {
        if (err) {
            console.log('Error setting up database:', err.message);
            throw err;
        }
        console.log('Database setup successful');
    });
    return db;
}

async function initialize() {
    const logger = await import('./logger.js');
    const amqplib = require('amqplib');

    async function setupRabbitMQ() {
        const amqp = require('amqplib/callback_api');
        let connection = null;
        let channel = null;

        try {
            connection = await amqp.connect('rabbitmq://localhost');
            channel = await connection.createChannel();
            await channel.assertQueue('replies_to_send', { durable: true });
            logger.info('RabbitMQ setup successful');
            return { channel };
        } catch (error) {
            logger.error('Error setting up RabbitMQ: ', error);
            throw error;
        }
    }

    module.exports = { setupDatabase, setupRabbitMQ };
}

initialize().catch(err => console.error(err));