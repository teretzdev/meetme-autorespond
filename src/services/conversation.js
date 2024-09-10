import logger from '../utils/logger.js';
import { updateUserStatus } from './auth.js';

async function initiateConversation(page, user, authClient, rowIndex) {
    logger.info(`Attempting to initiate conversation with ${user.username}`);
    try {
        logger.info(`Navigating to user profile: ${user.href}`);
        await page.goto(user.href, { waitUntil: 'networkidle0', timeout: 60000 });
        logger.info('Navigation to user profile completed');

        await handlePopUps(page);

        const introMessage = await getAIIntro(user.username);

        const chatButton = await page.waitForSelector('button:contains("Chat"), button:contains("Message")', { visible: true, timeout: 10000 });
        await chatButton.click();

        await page.waitForSelector('textarea.chat-input, textarea[placeholder="Type a message..."]', { visible: true, timeout: 10000 });

        await page.type('textarea.chat-input, textarea[placeholder="Type a message..."]', introMessage);
        await page.keyboard.press('Enter');

        await updateUserStatus(authClient, rowIndex, 'contacted');

        logger.info(`Successfully initiated conversation with ${user.username}`);
    } catch (error) {
        logger.error(`Error initiating conversation with ${user.username}: ${error.message}`, { stack: error.stack });
        throw error;
    }
}

async function handlePopUps(page) {
    const popupSelectors = [
        '#enable-push-notifications .modal-footer button.btn-primary',
        '#nav-chat > a > div > span:nth-child(1)'
    ];

    for (const selector of popupSelectors) {
        try {
            const popup = await page.$(selector);
            if (popup) {
                logger.info(`Closing popup: ${selector}`);
                await popup.click();
                await page.waitForTimeout(1000);
            }
        } catch (error) {
            logger.info(`No popup found or error closing popup: ${selector}`);
        }
    }
}

async function getAIIntro(username) {
    // Implement the logic to get an intro from your AI service
    return `Hi ${username}! I noticed your profile and thought we might have some things in common. How's your day going?`;
}

export { initiateConversation, handlePopUps };