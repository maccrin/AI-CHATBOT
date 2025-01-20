import dotenv from 'dotenv';
import { tmpdir } from 'os';
import { createClient } from '@supabase/supabase-js';
import schedule from 'node-schedule';
import puppeteer from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import AnonymizeUAPlugin from 'puppeteer-extra-plugin-anonymize-ua';
import AdblockerPlugin from 'puppeteer-extra-plugin-adblocker';
import fs from 'fs/promises';
import path from 'path';

// Load environment variables
dotenv.config();

// initialoze stealthplugin
const stealthPlugin = StealthPlugin();
stealthPlugin.enabledEvasions.delete('iframe.contentWindow');
stealthPlugin.enabledEvasions.delete('media.codecs');
//add plugin to puppeteer
puppeteer.use(StealthPlugin());
puppeteer.use(AnonymizeUAPlugin());
puppeteer.use(AdblockerPlugin({ blockTrackers: true }));

// Environment variables checking
const requiredEnvVars = ['SUPABASE_URL', 'SUPABASE_KEY', 'GOOGLE_EMAIL', 'GOOGLE_PASSWORD'];
for (const envVar of requiredEnvVars) {
  if (!process.env[envVar]) {
    throw new Error(`Missing required environment variable: ${envVar}`);
  }
}

// Initialize Supabase client
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY
);

// Constants
const stealth = StealthPlugin();
stealth.enabledEvasions.delete('iframe.contentWindow');
stealth.enabledEvasions.delete('media.codecs');
puppeteer.use(stealth);
const RECORDING_DIR = path.join(process.cwd(), 'recordings');
const SESSION_FILE = path.join(process.cwd(), 'google-session.json');
const MEETING_CHECK_INTERVAL = '*/1 * * * *';
const PAGE_LOAD_TIMEOUT = 60000;
const MAX_RETRIES = 6;
const RETRY_DELAY = 5000;
// Use 64-bit Chrome path
const CHROME_PATH = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';

// Helper function for waiting with retry
const waitForSelectorWithRetry = async (page, selector, options = {}) => {
  const maxRetries = options.retries || 5;
  const timeout = options.timeout || 30000;
  
  for (let i = 0; i < maxRetries; i++) {
    try {
      return await page.waitForSelector(selector, {
        visible: true,
        timeout: timeout
      });
    } catch (error) {
      if (i === maxRetries - 1) throw error;
      //await page.waitForTimeout(2000);
      await new Promise(res=> setTimeout(res,3000));
    }
  }
};

// Handle individual meeting
const handleMeeting = async (meeting) => {
  console.log('inside handle meeting');
  
  // Detailed selectors object
  const SELECTORS = {
    // Google Login Selectors
    SECURITY_WARNING: 'div:has-text("This browser or app may not be secure")',
    TRY_AGAIN_BUTTON: 'button:has-text("Try again"), button[jsname="LgbsSe"]',
    CHALLENGE_FRAME: 'iframe[title="Challenge"]',
    EMAIL_INPUT: 'input[type="email"]',
    PASSWORD_INPUT: 'input[type="password"]',
    NEXT_BUTTON: '#identifierNext',
    PASSWORD_NEXT: '#passwordNext',
    SECURITY_WARNING: 'text/This browser or app may not be secure',
    TRY_AGAIN_BUTTON: 'button:has-text("Try again")',
    VERIFY_IDENTITY: 'div[data-identifier]',
    
    // Meeting Join Selectors
    NAME_INPUT: 'input[jsname="YPqjbf"]',
    CAMERA_BUTTON: '[aria-label="Turn off camera"]',
    MIC_BUTTON: '[aria-label="Mute"]',
    JOIN_BUTTON: '[jsname="Cuz2Ue"]'
  };

  // Screenshot utility
  const takeScreenshot = async (page, name) => {
    try {
      const timestamp = Date.now();
      let screenshotDir = path.join(process.cwd(), 'debug-screenshots');
      
      // Try multiple potential directories
      const fallbackDirs = [
        screenshotDir,
        path.join(process.env.TEMP || '', 'debug-screenshots'),
        path.join(tmpdir(), 'debug-screenshots')
      ];
  
      // Find a writable directory
      for (const dir of fallbackDirs) {
        try {
          await fs.mkdir(dir, { recursive: true });
          screenshotDir = dir;
          break;
        } catch (mkdirError) {
          console.warn(`Could not create directory: ${dir}`, mkdirError);
        }
      }
  
      const screenshotPath = path.join(screenshotDir, `${timestamp}-${name}.png`);
      await page.screenshot({ path: screenshotPath, fullPage: true });
      console.log(`Screenshot saved: ${screenshotPath}`);
    } catch (error) {
      console.error('Screenshot Error:', error);
    }
  };
  let retryCount = 0;
  let browser = null;
  let page = null;
  try {
    console.log(` Starting meeting automation for meeting ID: ${meeting.id}`);
    console.log('Meeting Details:', JSON.stringify(meeting, null, 2));

    // Validate meeting object
    if (!meeting?.id || !meeting?.meeting_url || !meeting?.start_time || !meeting?.end_time) {
      throw new Error('Invalid meeting object: missing required fields');
    }
    
    // Create recordings directory
    await fs.mkdir(RECORDING_DIR, { recursive: true });
    process.env.PUPPETEER_SKIP_CHROMIUM_DOWNLOAD = 'true';
// Create a separate user data directory for the automation
const USER_DATA_DIR = path.join(tmpdir(), `chrome_profile_${Date.now()}`);
;

// Ensure user data directory exists
try {
  await fs.rm(USER_DATA_DIR, { recursive: true, force: true });
  await fs.mkdir(USER_DATA_DIR, { recursive: true });
  console.log('Created user data directory:', USER_DATA_DIR);
} catch (error) {
  console.error('Failed to create user data directory:', error);
  throw error;
}
    console.log('launching browser');
     browser = await puppeteer.launch({
      headless: false,
      ignoreDefaultArgs: ["--enable-automation","--disable-blink-features=AutomationControlled"],
      args: [
        `--user-data-dir=${USER_DATA_DIR}`,
        '--disable-gpu',
        '--disable-dev-shm-usage',
        '--disable-software-rasterizer',
        '--no-first-run',
        '--no-default-browser-check',
        '--start-maximized'
    ],
      executablePath: CHROME_PATH,
      defaultViewport: null
  });
    
   // Wait for browser to be properly initialized
   await new Promise(resolve => setTimeout(resolve, 3000));
   // Close initial blank page and create new page
   const pages = await browser.pages();
   page = pages[0];  // Just use the first auto-created page
   const client = await page.target().createCDPSession();
   await client.send('Network.clearBrowserCookies');
   await client.send('Network.clearBrowserCache');
await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36')
 
page.setDefaultNavigationTimeout(60000);
console.log('Browser and page setup complete');
    // Anti-detection setup
   

    // Page event listeners
    page.on('dialog', async (dialog) => {
      console.log('Dialog message:', dialog.message());
      await dialog.accept();
    });

    page.on('response', async response => {
      if (response.status() === 403 || response.status() === 401) {
        console.log(`Received ${response.status()} response from ${response.url()}`);
      }
    });
// Override navigator.webdriver
await page.evaluateOnNewDocument(() => {
  delete Object.getPrototypeOf(navigator).webdriver;
  // Overwrite the automation property
  Object.defineProperty(navigator, 'webdriver', {
    get: () => undefined
  });
});
    try {
      console.log('Starting Google authentication...');
      const navigationPromise = page.waitForNavigation({ waitUntil: 'networkidle0' });
    await page.goto('https://accounts.google.com/',{ waitUntil: 'networkidle0' });
    //await navigationPromise;
    await page.waitForNavigation({ waitUntil: 'networkidle0' });
    
   // Email input with enhanced waiting
    // Wait for and fill email
    console.log('Handling email input...');
    await page.waitForSelector('input[type="email"]', { 
      visible: true, 
      timeout: 30000 
    });
     // Add a small delay before interaction
  await new Promise(r => setTimeout(r, 2000));
      // Clear the field and type email with explicit clicks
  await page.click('input[type="email"]', { clickCount: 3 });
  await new Promise(r => setTimeout(r, 500));
  await page.keyboard.press('Backspace');
  await new Promise(r => setTimeout(r, 500));
  
  // Type email character by character with delay
  const email = process.env.GOOGLE_EMAIL;
  for (const char of email) {
    await page.keyboard.type(char);
    await new Promise(r => setTimeout(r, 100));
  }
  console.log('Email entered');
  
  // Wait for and click Next with explicit delay
  await new Promise(r => setTimeout(r, 1000));
  const nextButton = await page.waitForSelector('#identifierNext button', {
    visible: true,
    timeout: 20000
  });
  await nextButton.click();
  console.log('Clicked next after email');
    
    // Wait for password field with longer timeout
    await page.waitForSelector('input[type="password"]', {
      visible: true,
      timeout: 20000
    });
    
    // Clear any existing input and type password
    await page.click('input[type="password"]');
    await page.keyboard.down('Control');
    await page.keyboard.press('A');
    await page.keyboard.up('Control');
    await page.keyboard.press('Backspace');
    await new Promise(r => setTimeout(r, 1000));
    
    // Type password
    await page.type('input[type="password"]', process.env.GOOGLE_PASSWORD, { delay: 100 });
    console.log('Password entered');
    
    // Click next after password
    const passwordNext = await page.waitForSelector('button[type="button"]:not([disabled])', {
      visible: true,
      timeout: 15000
    });
    await passwordNext.click();
    console.log('Clicked next after password');
    
    // Wait for navigation to complete
    await page.waitForNavigation({ 
      waitUntil: 'networkidle0',
      timeout: 30000 
    });
    
    console.log('Login sequence completed');
  } catch (error) {
    console.error('Login failed:', error);
    
    // Take error screenshot
    try {
      const screenshotPath = `login-error-${Date.now()}.png`;
      await page.screenshot({ path: screenshotPath, fullPage: true });
      console.log(`Error screenshot saved to: ${screenshotPath}`);
    } catch (screenshotError) {
      console.error('Failed to save error screenshot:', screenshotError);
    }
    
    throw error;
  }
    

    // Perform login
    //await attemptLogin();

    // Join meeting
    console.log(`Joining meeting: ${meeting.id}`);
    await page.goto(meeting.meeting_url, {
      waitUntil: 'networkidle0',
      timeout: PAGE_LOAD_TIMEOUT
    });
     // Check for permission errors
     const permissionError = await page.$('text/You can\'t create a meeting yourself');
     if (permissionError) {
       throw new Error('Account does not have permission to join meetings');
     }

    // Wait for pre-join screen and set name
    console.log('Setting up for meeting join...');
    await waitForSelectorWithRetry(page, 'div[jscontroller]', { timeout: 30000 });

    const nameInput = await page.$(SELECTORS.NAME_INPUT);
    if (nameInput) {
      await nameInput.click({ clickCount: 3 });
      await nameInput.type('Recording Bot');
    }

    // Handle camera and mic
    console.log('Configuring camera and mic...');
    try {
      await waitForSelectorWithRetry(page, SELECTORS.CAMERA_BUTTON, { timeout: 5000 });
      await page.click(SELECTORS.CAMERA_BUTTON);
      await waitForSelectorWithRetry(page, SELECTORS.MIC_BUTTON, { timeout: 5000 });
      await page.click(SELECTORS.MIC_BUTTON);
    } catch (e) {
      console.log('Camera/mic buttons not found, continuing...');
    }

    // Function to check for multiple possible join button selectors
    const findJoinButton = async () => {
      const selectors = [
        '[jsname="Cuz2Ue"]',  // Standard join button
        'button[jsname="A5il2e"]',  // Alternate join button
        'button[jsname="QgSmzd"]',  // "Ask to join" button
        'button:has-text("Join now")',  // Text-based selector
        'button:has-text("Ask to join")'  // Text-based selector
      ];

      for (const selector of selectors) {
        const button = await page.$(selector);
        if (button) {
          console.log(`Found join button with selector: ${selector}`);
          return button;
        }
      }
      return null;
    };

    // Handle pre-join settings
    console.log('Setting up pre-join configurations...');
    
    // Wait for the page to stabilize
    await new Promise(r => setTimeout(r, 5000));

    // Handle camera and microphone permissions
    const mediaButtons = await page.$$('[role="button"]');
    for (const button of mediaButtons) {
      const ariaLabel = await button.evaluate(el => el.getAttribute('aria-label'));
      if (ariaLabel?.includes('camera') || ariaLabel?.includes('microphone')) {
        await button.click().catch(() => {});
        await new Promise(r => setTimeout(r, 1000));
      }
    }

    // Look for join button
    console.log('Looking for join button...');
    const joinButton = await findJoinButton();
    if (!joinButton) {
      throw new Error('Join button not found after checking all possible selectors');
    }

    // Click join button
    console.log('Clicking join button...');
    await joinButton.click();

    // Wait for join confirmation
    console.log('Waiting for join confirmation...');
    await new Promise(r => setTimeout(r, 5000));

    // Calculate and wait for meeting duration
    const meetingDuration = new Date(meeting.end_time) - new Date(meeting.start_time);
    console.log(`Meeting duration: ${meetingDuration} ms`);

    if (meetingDuration <= 0) {
      throw new Error('Invalid meeting duration: end date must be after start date');
    }

    await new Promise(resolve => setTimeout(resolve, meetingDuration));

    // Update meeting status
    await supabase
      .from('meeting')
      .update({ status: 'completed' })
      .eq('id', meeting.id);

    console.log(`✅ Meeting ${meeting.id} completed successfully`);

  } catch (error) {
    console.error('Meeting automation failed:', error.message);
   // await takeScreenshot(page, 'error-state');
   if (page) {
    try {
        await page.close();
    } catch (e) {
        console.error('Error closing page:', e);
    }
}
if (browser) {
    try {
        await browser.close();
    } catch (e) {
        console.error('Error closing browser:', e);
    }
   
    // Update meeting status with error
    await supabase
      .from('meeting')
      .update({
        status: 'cancelled',
        error_message: error.message
      })
      .eq('id', meeting.id);

  }
 } finally {
  if (browser) {
    try {
        await browser.close();
    } catch (e) {
        console.error('Error in final browser cleanup:', e);
    }
  }
}
};

// Schedule individual meeting
const scheduleMeeting = (meeting) => {
  const startDate = new Date(meeting.start_time);
  if (startDate <= new Date()) {
    console.warn(`Meeting ${meeting.id} start date is in the past, skipping`);
    return null;
  }

  return schedule.scheduleJob(startDate, async () => {
    try {
      console.log(`Starting scheduled meeting: ${meeting.id}`);
      await supabase
        .from('meeting')
        .update({ status: 'ongoing' })
        .eq('id', meeting.id);

      await handleMeeting(meeting);

    } catch (error) {
      console.error(`Error executing meeting ${meeting.id}:`, error);
    }
  });
};

// Monitor meetings
const monitorMeetings = async () => {
  const activeJobs = new Map();

  // Check for new meetings every minute
  const monitorJob = schedule.scheduleJob(MEETING_CHECK_INTERVAL, async () => {
    try {
      // Fetch upcoming scheduled meetings
      const { data: meetings, error } = await supabase
        .from('meeting')
        .select('*')
        .eq('status', 'pending')
        .gte('start_time', new Date().toISOString());

      if (error) throw error;

      // Schedule new meetings
      meetings?.forEach(meeting => {
        if (!activeJobs.has(meeting.id)) {
          const job = scheduleMeeting(meeting);
          if (job) {
            activeJobs.set(meeting.id, job);
            console.log(`Scheduled new meeting: ${meeting.id}`);
          }
        }
      });

      // Cleanup completed meetings
      for (const [meetingId, job] of activeJobs.entries()) {
        const meeting = meetings?.find(m => m.id === meetingId);
        if (!meeting) {
          job.cancel();
          activeJobs.delete(meetingId);
          console.log(`Cleaned up completed meeting: ${meetingId}`);
        }
      }

    } catch (error) {
      console.error('Error in meeting monitor:', error);
    }
  });

  // Return cleanup function
  return () => {
    monitorJob.cancel();
    activeJobs.forEach(job => job.cancel());
    activeJobs.clear();
  };
};

// Handle graceful shutdown
const cleanup = async () => {
  console.log('Gracefully shutting down...');
  try {
    await schedule.gracefulShutdown();
    return process.exit(0);
  } catch (error) {
    console.error('Error during shutdown:', error);
    process.exit(1);
  }
};

process.on('SIGTERM', cleanup);
process.on('SIGINT', cleanup);

// Start the application
console.log('Starting meeting monitor...');
monitorMeetings().catch(error => {
  console.error('Fatal error in meeting monitor:', error);
  process.exit(1);
});