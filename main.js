import { spawn } from 'child_process';
import logger from './src/utils/logger.js';

function startScript(scriptName) {
  logger.info(`Starting script: ${scriptName}`); // Log when starting a script

  const process = spawn('node', [scriptName]);
  
  process.stdout.on('data', (data) => {
    logger.info(`${scriptName} stdout: ${data}`);
  });

  process.stderr.on('data', (data) => {
    logger.error(`${scriptName} stderr: ${data}`);
  });

  process.on('close', (code) => {
    logger.info(`${scriptName} exited with code ${code}. Restarting...`);
    // Restart the script if it exits
    startScript(scriptName);
  });
}

// Start all scripts
//startScript('./fetchMessages.js');
startScript('./processMessages.mjs');
//startScript('./sendReplies.js');

logger.info('Process scripts started');
