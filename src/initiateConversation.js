import puppeteer from 'puppeteer';
import logger from './utils/logger.js';
import config from './config/config.js';
import { authorize, getUncontactedUsers, updateUserStatus } from './services/auth.js';
import { loginToMeetMe } from './services/login.js';
import { navigateToMeetPage } from './services/navigation.js';
import { initiateConversation } from './services/conversation.js';

// Add this function
async function extractMemberLinks(page) {
    logger.info('Extracting member links...');
    try {
        // Wait for the member list to load
        await page.waitForSelector('.member-list a', { timeout: 10000 });

        // Extract all member links
        const memberLinks = await page.evaluate(() => {
            const links = Array.from(document.querySelectorAll('.member-list a'));
            return links.map(link => ({
                href: link.href,
                username: link.textContent.trim()
            }));
        });

        logger.info(`Extracted ${memberLinks.length} member links`);
        return memberLinks;
    } catch (error) {
        logger.error(`Error extracting member links: ${error.message}`);
        return [];
    }
}

async function processUsers(users, maxRetries = 3) {
    logger.info(`Starting to process ${users.length} users`);
    const browser = await puppeteer.launch({ headless: false });
    logger.info('Browser launched');
    const page = await browser.newPage();
    const authClient = await authorize();

    logger.info('Attempting to log in to MeetMe');
    const isLoggedIn = await loginToMeetMe(browser, page, config.MEETME_USERNAME, config.MEETME_PASSWORD);
    if (!isLoggedIn) {
        logger.error('Failed to log in to MeetMe. Exiting...');
        await browser.close();
        return;
    }
    logger.info('Successfully logged in to MeetMe');

    await navigateToMeetPage(page);

    for (const user of users) {
        logger.info(`Processing user at row ${user.rowIndex}`);
        let retries = 0;
        while (retries < maxRetries) {
            try {
                await initiateConversation(page, user, authClient, user.rowIndex);
                logger.info(`Successfully processed user at row ${user.rowIndex}`);
                break;
            } catch (error) {
                retries++;
                logger.warn(`Attempt ${retries} failed for user ${user.rowIndex}: ${error.message}`);
                if (retries >= maxRetries) {
                    logger.error(`Failed to process user ${user.rowIndex} after ${maxRetries} attempts`);
                    await updateUserStatus(authClient, user.rowIndex, 'failed');
                } else {
                    logger.info(`Waiting for ${5000 * retries}ms before retrying...`);
                    await new Promise(resolve => setTimeout(resolve, 5000 * retries));
                    logger.info('Retrying after checking login...');
                    await loginToMeetMe(browser, page, config.MEETME_USERNAME, config.MEETME_PASSWORD);
                }
            }
        }
    }

    logger.info('Closing browser');
    await browser.close();
    logger.info('Browser closed');
}

async function main() {
    logger.info('Starting initiate conversations script');
    try {
        const authClient = await authorize();
        const uncontactedUsers = await getUncontactedUsers(authClient);
        logger.info(`Found ${uncontactedUsers.length} uncontacted users to process`);
        await processUsers(uncontactedUsers);
        logger.info('Finished initiating conversations');
    } catch (error) {
        logger.error(`Script execution error: ${error.stack}`);
    }
}

// Modify the export statement to include extractMemberLinks
export { main as initiateConversations, extractMemberLinks };