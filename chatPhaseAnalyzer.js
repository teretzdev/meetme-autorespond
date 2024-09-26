import express from 'express';
import bodyParser from 'body-parser';
import amqp from 'amqplib';
import winston from 'winston'; // Adding winston for logging

const app = express();
app.use(bodyParser.json());

const PHASES = {
  PHASE_1: 'Play It Cool (Gauge Interest)',
  PHASE_2: 'Light Flirting with a Catch (Learn Location)',
  PHASE_3: 'Building Up to the Ask (Invitation \'Over\')',
  PHASE_4: 'Gas Money Time (Cashapp Request)',
};

const logger = winston.createLogger({
  level: 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.json()
  ),
  transports: [
    new winston.transports.Console(),
    new winston.transports.File({ filename: 'app.log' })
  ]
});

// Moved determinePhase to the top level of the object
// determinePhase: function(userHistory, currentState) {
//     // function implementation
// },
function analyze(message, userHistory) {
  const currentPhase = determinePhase(userHistory);
  let nextPhase = currentPhase;
  let confidence = 0.5; // Default confidence

  // Check for phase progression
  const lowerMessage = message.toLowerCase();
  if (currentPhase === PHASES.PHASE_1 && lowerMessage.includes('where')) {
    nextPhase = PHASES.PHASE_2;
    confidence = 0.7;
  } else if (currentPhase === PHASES.PHASE_2 && (lowerMessage.includes('come over') || lowerMessage.includes('meet up'))) {
    nextPhase = PHASES.PHASE_3;
    confidence = 0.8;
  } else if (currentPhase === PHASES.PHASE_3 && (lowerMessage.includes('money') || lowerMessage.includes('cashapp'))) {
    nextPhase = PHASES.PHASE_4;
    confidence = 0.9;
  }

  return {
    phase: nextPhase,
    previousPhase: currentPhase,
    confidence: confidence,
    // Additional data...
  };
}

// Change from function declaration to function expression
export function determinePhase(userHistory) {
  if (!Array.isArray(userHistory) || userHistory.length === 0) {
    console.error('Invalid userHistory passed to determinePhase:', userHistory);
    return { phase: PHASES.PHASE_1, keyword: null, confidence: 0.5 }; // Default to Phase 1 if history is invalid
  }

  const phaseMapping = {
    PHASE_4: ['gas money', 'cashapp'],
    PHASE_3: ['come over', 'invite'],
    PHASE_2: ['where are you', 'location'],
    PHASE_1: ['plans', 'evening']
  };

  for (let i = userHistory.length - 1; i >= 0; i--) {
    const message = userHistory[i].message.toLowerCase();
    for (const [phase, keywords] of Object.entries(phaseMapping)) {
      const matchedKeyword = keywords.find(keyword => message.includes(keyword));
      if (matchedKeyword) {
        return { phase: PHASES[phase], keyword: matchedKeyword, confidence: 0.9 }; // Return detailed info
      }
    }
  }
  return { phase: PHASES.PHASE_1, keyword: null, confidence: 0.5 }; // Default to Phase 1 if no triggers are found
};

app.post('/analyze-chat', async (req, res) => {
  const { userId, chatHistory } = req.body;

  if (!userId || !chatHistory) {
    logger.warn('Missing userId or chatHistory in request');
    return res.status(400).send('Missing userId or chatHistory');
  }

  const currentPhase = determinePhase(chatHistory);
  logger.info(`Determined phase for user ${userId}: ${currentPhase}`); // Log the current phase

  try {
    const connection = await amqp.connect('amqp://localhost');
    const channel = await connection.createChannel();
    await channel.assertQueue('meetme_queue', { durable: true });

    const message = {
      userId,
      chatHistory,
      currentPhase, // Include currentPhase in the message
    };

    channel.sendToQueue('meetme_queue', Buffer.from(JSON.stringify(message)));
    logger.info(`Message sent to queue: ${JSON.stringify(message)}`);

    res.json({ currentPhase });
  } catch (error) {
    logger.error('Error sending message to queue:', error);
    res.status(500).send('Internal Server Error');
  }
});


const PORT = process.env.PORT || 2071;
app.listen(PORT, () => {
  logger.info(`Server is running on port ${PORT}`);
});

// Move determinePhase into the chatPhaseAnalyzer object
export const chatPhaseAnalyzer = {
  determinePhase: function(userHistory) {
    if (!Array.isArray(userHistory) || userHistory.length === 0) {
      console.error('Invalid userHistory passed to determinePhase:', userHistory);
      return PHASES.PHASE_1; // Default to Phase 1 if history is invalid
    }

    const phaseMapping = {
      PHASE_4: ['gas money', 'cashapp'],
      PHASE_3: ['come over', 'invite'],
      PHASE_2: ['where are you', 'location'],
      PHASE_1: ['plans', 'evening']
    };

    for (let i = userHistory.length - 1; i >= 0; i--) {
      const message = userHistory[i].message.toLowerCase();
      for (const [phase, keywords] of Object.entries(phaseMapping)) {
        if (keywords.some(keyword => message.includes(keyword))) {
          return PHASES[phase];
        }
      }
    }
    return PHASES.PHASE_1; // Default to Phase 1 if no triggers are found
  },

  analyze: function(userHistory, currentState) {
    if (!Array.isArray(userHistory) || userHistory.length === 0) {
      console.log('Invalid or empty userHistory:', userHistory);
      return PHASES.PHASE_1;
    }

    return this.determinePhase(userHistory); // Use this.determinePhase
  }
};

