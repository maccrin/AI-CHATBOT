import dotenv from 'dotenv';
import { tmpdir } from 'os';
import { createClient } from '@supabase/supabase-js';
import schedule from 'node-schedule';
import puppeteer from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import AnonymizeUAPlugin from 'puppeteer-extra-plugin-anonymize-ua';
import AdblockerPlugin from 'puppeteer-extra-plugin-adblocker';
import fs from 'fs';
import path from 'path';
import { launch, getStream } from 'puppeteer-stream';
import { promisify } from 'util';
import { exec } from 'child_process';
// Load environment variables
dotenv.config();

// @ts-nocheck
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

const execAsync = promisify(exec);

// Constants
const stealth = StealthPlugin();
stealth.enabledEvasions.delete('iframe.contentWindow');
stealth.enabledEvasions.delete('media.codecs');
puppeteer.use(stealth);
const RECORDING_DIR = path.join(process.cwd(), 'recordings');
const SESSION_FILE = path.join(process.cwd(), 'google-session.json');
const MEETING_CHECK_INTERVAL = '*/1 * * * *';
const PAGE_LOAD_TIMEOUT = 60000;
// Use 64-bit Chrome path
const CHROME_PATH = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';



// Handle individual meeting
const handleMeeting = async (meeting) => {
  console.log('inside handle meeting');
  let browser = null;
  let stream = null;
  let file = null;
  const USER_DATA_DIR = path.join(tmpdir(), `chrome_profile_${Date.now()}`);
  try {

// Ensure user data directory exists
try {
  fs.rmSync(USER_DATA_DIR, { recursive: true, force: true });
  fs.mkdirSync(USER_DATA_DIR, { recursive: true });
  console.log('Created user data directory:', USER_DATA_DIR);
} catch (error) {
  console.error('Failed to create user data directory:', error);
  throw error;
}

console.log('launching browser');
browser = await launch({
  headless: false,
  slowMo:50,
      ignoreDefaultArgs: ["--enable-automation","--disable-blink-features=AutomationControlled"],
      args: [
        `--user-data-dir=${USER_DATA_DIR}`,
        '--disable-gpu',
        '--disable-dev-shm-usage',
        '--disable-software-rasterizer',
        '--no-first-run',
        '--no-default-browser-check',
        '--start-maximized', 
        '--use-fake-ui-for-media-stream', // Automatically grant camera/microphone permissions
        '--use-fake-device-for-media-stream', // Use a fake device for media stream
        //additional features 
        '--allow-file-access',
        '--enable-usermedia-screen-capturing',
        '--auto-select-desktop-capture-source="Meet"',
        '--disable-features=IsolateOrigins',
        '--disable-site-isolation-trials',
        '--autoplay-policy=no-user-gesture-required',
        //additional features for not to recognize bot
        '--disable-features=ScreenCapture',
        '--disable-blink-features=MediaRecorder',
        '--allow-running-insecure-content',
        '--autoplay-policy=no-user-gesture-required'
    ],
      executablePath: CHROME_PATH,
      defaultViewport: null
});

const page = await browser.newPage();
const navigationPromise = page.waitForNavigation();
const context = browser.defaultBrowserContext();

// Set permissions for meet.google.com
await context.overridePermissions(
  "https://meet.google.com/", ["microphone", "camera", "notifications"]
);

console.log(` Starting meeting automation for meeting ID: ${meeting.id}`);
console.log('Meeting Details:', JSON.stringify(meeting, null, 2));


try {
  console.log('Starting Google authentication...');
  const navigationPromise = page.waitForNavigation({ waitUntil: 'networkidle0' });
await page.goto('https://accounts.google.com/',{ waitUntil: 'networkidle0' }); 
// Email input with enhanced waiting


await new Promise(resolve => setTimeout(resolve, 2000)); // 2000ms = 2 seconds
try {
 // First find and interact with the email input field
console.log('Looking for email input field...');
const emailField = await page.waitForSelector('input[type="email"]', {
visible: true,
timeout: 10000
});

if (!emailField) {
throw new Error('Email field not found');
}

// Focus and click the email field first
await emailField.click();
await new Promise(resolve => setTimeout(resolve, 2000));

// Now the passkey option should be visible if it exists
// Ignore it and proceed with email input
await emailField.click({ clickCount: 3 }); // Clear any existing text
await page.keyboard.press('Backspace');

// Type email with delay
await emailField.type(process.env.GOOGLE_EMAIL, { delay: 100 });

// Verify email was typed correctly
const emailValue = await page.$eval('input[type="email"]', el => el.value);
console.log('Email field value after typing:', emailValue);

} catch (error) {
  console.log('First method failed, trying alternative...');
  
  const emailField = await page.$('input[type="email"]');
  await emailField.focus();
  await emailField.type(process.env.GOOGLE_EMAIL, { delay: 50 });
}

await page.click('#identifierNext'); // Click "Next"
await new Promise(resolve => setTimeout(resolve, 2000));

//handling password input
console.log('Typing password...');
const passwordField  =await page.waitForSelector('input[type="password"]', { visible: true , timeout:10000});
//const passwordField = await page.$('input[type="password"]');
await passwordField.focus(); // Ensures focus on the input field
await passwordField.click({ clickCount: 3 });
await passwordField.type(process.env.GOOGLE_PASSWORD, { delay: 100 });
await page.click('#passwordNext'); // Click "Next"

  // Wait for navigation to confirm login success
await page.waitForNavigation({ waitUntil: 'networkidle0', timeout: 60000 });
console.log('Login sequence completed');
} 

catch (error) {
console.error('Login failed:', error);
}

// Go directly to meeting URL (assuming already authenticated)
await new Promise(resolve => setTimeout(resolve, 2000));
await page.goto(meeting.meeting_url + '?hl=en', {
  waitUntil: 'networkidle0',
  timeout: 10000,
});

await new Promise(resolve => setTimeout(resolve, 5000));
    
    const button = await page.evaluateHandle(() => {
      // First find the span with "Ask to join" text
      const span = Array.from(document.querySelectorAll('span')).find(
        span => span.textContent === 'Ask to join'
      );
      // If span found, get its parent button
      if (span) {
        return span.closest('button');
      }
      return null;
    });

    if (!button) {
      throw new Error('Join button not found');
    }

    console.log('Found join button, attempting to click...');
    
    // Get button position
    const buttonBox = await button.boundingBox();
    if (!buttonBox) {
      throw new Error('Could not get button position');
    }

    // Click in the center of the button
    await page.mouse.click(
      buttonBox.x + buttonBox.width/2,
      buttonBox.y + buttonBox.height/2
    );
    try {
      await page.waitForSelector('div[class="ne2Ple-oshW8e-V67aGc"]', { visible: true, timeout: 60000 });
      console.log('Detected "Present now" tooltip. You are in the meeting.');
    } catch (error) {
      console.log('Join confirmation failed or not detected:', error);
    }
    console.log('Join button clicked successfully');

// Wait for name input (indicates we're on the meeting join page)


// Turn off camera using Ctrl+E
await new Promise(resolve => setTimeout(resolve, 2000));
await page.keyboard.down('ControlLeft');
await page.keyboard.press('KeyE');
await page.keyboard.up('ControlLeft');
await new Promise(resolve => setTimeout(resolve, 2000));

// Turn off mic using Ctrl+D
await new Promise(resolve => setTimeout(resolve, 2000));
await page.keyboard.down('ControlLeft');
await page.keyboard.press('KeyD');
await page.keyboard.up('ControlLeft');
await new Promise(resolve => setTimeout(resolve, 2000));



// Wait for join confirmation and setup recording
console.log('Setting up recording...');
const audioFilename = path.join(RECORDING_DIR, `meeting-${meeting.id}-audio-${Date.now()}.webm`);
file = fs.createWriteStream(audioFilename);

// Add delay before starting stream
await new Promise(resolve => setTimeout(resolve, 3000));

stream = await getStream(page, { 
  audio: true, 
  mimeType: "audio/webm"
});
console.log("recording started");

if (stream) {
  stream.pipe(file);
} else {
  console.log("Failed to initialize stream");
}

// Calculate and wait for meeting duration
const meetingDuration = new Date(meeting.end_time) - new Date(meeting.start_time);
console.log(`Meeting duration: ${meetingDuration} ms`);

// Wait until meeting end time
await new Promise(resolve => setTimeout(resolve, meetingDuration));

// Update meeting status
await supabase
  .from('meeting')
  .update({ status: 'completed' })
  .eq('id', meeting.id);

console.log(`✅ Meeting ${meeting.id} completed successfully`);
  }
  catch (error) {
    console.error('Meeting automation failed:', error.message);
   // await takeScreenshot(page, 'error-state');
   
if (browser) {
  try {
    await browser.close();
  } catch (e) {
    console.log('Browser close failed, attempting force kill');
    if (browser.process()) {
      process.kill(browser.process().pid);
    }
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
  setTimeout(async () => {
		await stream.destroy();
		await browser.close();
		file.close();
		console.log("finished");
	}, 1000 * 10);

};
}
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