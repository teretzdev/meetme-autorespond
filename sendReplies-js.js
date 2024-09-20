async function loginToMeetMe(page) {
    logger.info('Starting MeetMe login process');
    const maxAttempts = 3;

    // Check if environment variables are set
    if (!process.env.MEETME_EMAIL || !process.env.MEETME_PASSWORD) {
        logger.error('MEETME_EMAIL or MEETME_PASSWORD environment variables are not set');
        return false;
    }

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        const currentUrl = await page.url();
        if (currentUrl.includes('#meet') || currentUrl.includes('app.meetme.com')) {
            logger.info('User is already logged in.');
            return true;
        }

        try {
            await page.goto('https://www.meetme.com', { waitUntil: 'networkidle2' });
            logger.info(`Page loaded. Current URL: ${page.url()}`);

            const loginButton = await page.waitForSelector('#marketing-header-login .btn-black', { visible: true, timeout: 25000 });
            await loginButton.click();

            logger.info('Entering credentials');
            await page.waitForSelector('#site-login-modal-email', { visible: true, timeout: 25000 });
            
            // Use page.type instead of typeSlowly for more reliable input
            await page.type('#site-login-modal-email', process.env.MEETME_EMAIL);
            await page.type('#site-login-modal-password', process.env.MEETME_PASSWORD);

            logger.info('Submitting login form');
            await Promise.all([
                page.click('#site-login-modal-submit-group > button'),
                page.waitForNavigation({ waitUntil: 'networkidle0' })
            ]);

            const newUrl = await page.url();
            logger.info(`Current URL after login submission: ${newUrl}`);

            if (newUrl.includes('#meet') || newUrl.includes('app.meetme.com')) {
                logger.info('Successfully logged in to MeetMe');
                return true;
            }

            logger.warn(`Login attempt ${attempt} unsuccessful. URL does not indicate successful login.`);

            if (attempt < maxAttempts) {
                logger.info(`Retrying login in 3 seconds...`);
                await new Promise(resolve => setTimeout(resolve, 3000));
            }
        } catch (error) {
            logger.error(`Error during login attempt ${attempt}: ${error.message}`);
            if (attempt === maxAttempts) {
                logger.error('Max login attempts reached. Login failed.');
                return false;
            }
            await new Promise(resolve => setTimeout(resolve, 3000));
        }
    }

    return false;
}
