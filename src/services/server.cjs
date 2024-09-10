// server.cjs
const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const natural = require('natural');
const path = require('path');

const app = express();
const port = process.env.PORT || 3000;
const db = new sqlite3.Database('./chat.db');

// Middleware
app.use(express.json());
app.use('/api', express.static(path.join(__dirname, 'public')));

// NLP setup
const classifier = new natural.BayesClassifier();
const tokenizer = new natural.WordTokenizer();
const tfidf = new natural.TfIdf();

const trainingData = [
  { text: 'hello', label: 'greeting' },
  { text: 'hi there', label: 'greeting' },
  { text: 'good morning', label: 'greeting' },
  { text: 'bye', label: 'farewell' },
  { text: 'see you later', label: 'farewell' },
  { text: 'what is', label: 'inquiry' },
  { text: 'how does', label: 'inquiry' },
  { text: 'can you explain', label: 'inquiry' },
  { text: 'I need help', label: 'help' },
  { text: 'can you assist', label: 'help' },
  { text: 'thank you', label: 'gratitude' },
  { text: 'thanks a lot', label: 'gratitude' }
];

trainingData.forEach(({ text, label }) => classifier.addDocument(text, label));
classifier.train();

const documents = [
  'The quick brown fox jumps over the lazy dog',
  'Machine learning is a subset of artificial intelligence',
  'Natural language processing is used in chatbots'
];

documents.forEach(doc => tfidf.addDocument(doc));

// Database setup
db.serialize(() => {
  db.run(`CREATE TABLE IF NOT EXISTS messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    room TEXT NOT NULL,
    sender TEXT NOT NULL,
    content TEXT NOT NULL,
    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
  )`, (err) => {
    if (err) console.error('Failed to create table:', err);
    else console.log('Database and table are ready.');
  });
});

const sessions = new Map();

// API Endpoints

// GET /api/history/:room
app.get('/api/history/:room', async (req, res) => {
  const room = req.params.room;
  console.log(`[API] GET /api/history/${room} - Request received`);

  try {
    const history = await getMessageHistory(room);
    console.log(`[API] GET /api/history/${room} - History fetched:`, history);
    res.json(history);
  } catch (error) {
    console.error(`[API Error] GET /api/history/${room}:`, error);
    res.status(500).json({ error: 'Failed to fetch history' });
  }
});

// POST /api/chat
app.post('/api/chat', async (req, res) => {
  console.log(`[API] POST /api/chat - Request received`);
  const { room, sender, message } = req.body;

  if (!room || !sender || !message) {
    console.error('[API Error] POST /api/chat: Missing required fields', req.body);
    return res.status(400).json({ error: 'Missing required fields' });
  }

  try {
    console.log(`[API] POST /api/chat - Processing message:`, message);

    if (!sessions.has(sender)) {
      sessions.set(sender, []);
    }
    const conversationHistory = sessions.get(sender);

    const processedMessage = await processMessage({ content: message }, conversationHistory);

    conversationHistory.push({ sender: 'user', content: message });
    if (conversationHistory.length > 5) {
      conversationHistory.shift();
    }

    await storeMessage(room, sender, processedMessage.reply);

    res.json({ reply: processedMessage.reply });
  } catch (error) {
    console.error(`[API Error] POST /api/chat:`, error);
    res.status(500).json({ error: 'Failed to process message' });
  }
});

// Message processing logic
async function processMessage(message) {
  console.log(`[Message Processing] Received message:`, message);

  // Fetch user history
  const userHistory = await chatHistory.getHistory(message.username);
  
  // Determine the current phase
  const currentPhase = chatPhaseAnalyzer.determinePhase(userHistory);
  message.phase = currentPhase; // Add the phase to the message

  // Log the determined phase
  console.log(`Determined phase for ${message.username}: ${currentPhase}`);

  // Log the processed message
  console.log(`Processed message for ${message.username}:`, JSON.stringify(message, null, 2));

  // Further processing...
}

// Database functions
async function getMessageHistory(room) {
  return new Promise((resolve, reject) => {
    db.all('SELECT sender, content FROM messages WHERE room = ? ORDER BY timestamp DESC LIMIT 50', [room], (err, rows) => {
      if (err) reject(err);
      else resolve(rows.reverse()); // Reverse to display in chronological order
    });
  });
}

async function storeMessage(room, sender, content) {
  return new Promise((resolve, reject) => {
    db.run('INSERT INTO messages (room, sender, content) VALUES (?, ?, ?)', [room, sender, content], (err) => {
      if (err) reject(err);
      else resolve();
    });
  });
}

// Serve the index.html file
app.get('/', (req, res) => {
  console.log(`[Express] Serving index.html`);
  res.sendFile(path.join(__dirname, 'public', 'index.html')); // Correct the path if needed
});

// Start the server
app.listen(port, () => {
  console.log(`Server running at http://localhost:${port}`);
});
