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
import ffmpeg from 'fluent-ffmpeg';
import ffmpegInstaller from '@ffmpeg-installer/ffmpeg';
import { exec } from 'child_process';
import { promisify } from 'util';
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
// Set ffmpeg path
ffmpeg.setFfmpegPath(ffmpegInstaller.path);

// Function to parse audio devices from FFmpeg output
const parseAudioDevices = (stderr) => {
  const devices = [];
  const lines = stderr.split('\n');
  let currentDevice = null;

  for (const line of lines) {
    // Look for audio device entries
    const deviceMatch = line.match(/"([^"]+)"\s*\(audio\)/);
    if (deviceMatch) {
      currentDevice = {
        name: deviceMatch[1],
        alternative: null
      };
      devices.push(currentDevice);
    }
    // Look for alternative names
    const altMatch = line.match(/Alternative name\s*"([^"]+)"/);
    if (altMatch && currentDevice) {
      currentDevice.alternative = altMatch[1];
    }
  }
  return devices;
};

// Function to list available audio devices
const listAudioDevices = async () => {
  try {
    const { stderr } = await execAsync('ffmpeg -list_devices true -f dshow -i dummy');
    const devices = parseAudioDevices(stderr);
    console.log('Available audio devices:', devices);
    return devices;
  } catch (error) {
    // FFmpeg returns error code 1 when listing devices, but still outputs the list
    if (error.stderr) {
      const devices = parseAudioDevices(error.stderr);
      console.log('Available audio devices:', devices);
      return devices;
    }
    throw error;
  }
};
let audioCommand;

// Audio recording function
const startAudioRecording = (outputPath) => {
  return new Promise(async (resolve, reject) => {
    try {
     // List available devices
    const devices = await listAudioDevices();
    if (!devices.length) throw new Error('No audio devices found');

    // Select the correct device (try 'Stereo Mix' if available)
    const device = devices.find(d => d.name.includes('Stereo Mix')) || devices[0];

      const command = ffmpeg()
        .input(`audio=${device.name}`)
        .inputFormat('dshow')
        .inputOptions([
          '-thread_queue_size 4096',
          '-channels 2',
          '-sample_rate 44100'
        ])
        .outputOptions([
          '-acodec libmp3lame',
          '-ar 44100',
          '-ab 128k',
          '-ac 2'
        ])
        .on('start', (commandLine) => {
          console.log('FFmpeg process started:', commandLine);
          resolve(command); // 🔥 Ensure `command` is returned
        })
        .on('error', (err) => {
          console.error('Audio recording error:', err);
          reject(err);
        });

      // Add output file
      command.save(outputPath);
    } catch (error) {
      reject(error);
    }
  });
};


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
  let browser = null;
  let page = null;
  
  try {
    console.log(` Starting meeting automation for meeting ID: ${meeting.id}`);
    await listAudioDevices();
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
      headless: true,
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
    
   // Wait for browser to be properly initialized
   await new Promise(resolve => setTimeout(resolve, 3000));
   // Close initial blank page and create new page
   const pages = await browser.pages();
   page = pages[0];  // Just use the first auto-created page
   // Create CDP session
   const filename = path.join(RECORDING_DIR, `meeting-${meeting.id}-${Date.now()}.webm`);
  
    const client = await page.createCDPSession();
   await client.send('Network.clearBrowserCookies');
   await client.send('Network.clearBrowserCache');
await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36')
 
page.setDefaultNavigationTimeout(60000);

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

//Google Authentication starts
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
    await page.waitForSelector('input[type="password"]', { visible: true, timeout: 30000 });
    const passwordField = await page.$('input[type="password"]');
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

    // Join meeting
    console.log(`Joining meeting: ${meeting.id}`);

// Check if we're on the Google account page and force redirect to the meeting URL
if (page.url() === 'https://myaccount.google.com/?pli=1') {

  console.log('Detected redirection to Google account page, navigating to meeting URL...');
  await page.goto(meeting.meeting_url, { waitUntil: 'networkidle0', timeout: PAGE_LOAD_TIMEOUT });
} else {
  console.log('Logged in successfully, navigating to meeting URL...');
  await page.goto(meeting.meeting_url, { waitUntil: 'networkidle0', timeout: PAGE_LOAD_TIMEOUT });
}

     // Check for permission errors
     const permissionError = await page.$('text/You can\'t create a meeting yourself');
     if (permissionError) {
       throw new Error('Account does not have permission to join meetings');
     }

    // Wait for pre-join screen and set name
    console.log('Setting up for meeting join...');
  await new Promise( resolve=> setTimeout(resolve,6000));

    // Handle camera and mic
    const findJoinButton = async () => {
      console.log('Inside "Ask to join" button function');
      
  try {
    // Wait for page stability
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

    // Wait for the microphone button and click on it
await page.waitForSelector('button[aria-label="Turn off microphone"]', { timeout: 60000 });  // Set to 60 seconds

await page.click('button[aria-label="Turn off microphone"]');  // This simulates the microphone toggle

// Start recording
const audioFilename = path.join(RECORDING_DIR, `meeting-${meeting.id}-audio-${Date.now()}.mp3`);
audioCommand = await startAudioRecording(audioFilename);
console.log('Audio recording started');
//add some delay here to get selector 
await new Promise(r => setTimeout(r, 5000));
// Optional: Verify if the button now has the 'aria-pressed="false"' attribute, which indicates it's muted
const isMuted = await page.evaluate(() => {
  const micButton = document.querySelector('button[aria-label="Turn off microphone"]');
  return micButton ? micButton.getAttribute('aria-pressed') === 'true' : false;
});

console.log(isMuted ? 'Microphone is on' : ' Bot Microphone is muted');
  } 
    catch(error){

      console.error('Error interacting with "Ask to join" button:', error);
    } 
    
  };

 // Wait for the page to stabilize
    await new Promise(r => setTimeout(r, 5000));

    // Look for join button
    console.log('Looking for join button...');
     await findJoinButton();
     await new Promise(r => setTimeout(r, 5000));; // Wait for the bot to join

// Listen to browser console logs and print them to the terminal
page.on('console', (msg) => {
  console.log('Browser log:', msg.text());
});
    // Calculate and wait for meeting duration
    const meetingDuration = new Date(meeting.end_time) - new Date(meeting.start_time);
    console.log(`Meeting duration: ${meetingDuration} ms`);

    if (meetingDuration <= 0) {
      throw new Error('Invalid meeting duration: end date must be after start date');
    }
    await new Promise(r => setTimeout(r, 5000));
   
    // Wait until end time is reached
    while (new Date() < new Date(meeting.end_time)) {
      await new Promise(resolve => setTimeout(resolve, 1000));
    }

// Short wait for file saving (5 seconds should be enough)
await new Promise(r => setTimeout(r, 5000));

// Stop recording after some time (example: 10 seconds)
setTimeout(() => {
  if (audioCommand && audioCommand.ffmpegProc) {
    console.log('Stopping audio recording...');
    audioCommand.ffmpegProc.kill('SIGINT'); // Properly stop FFmpeg
  }}, 10000); // 10 seconds example

console.log('Recording completed');
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
    await page.evaluate(() => {
      if (window.meetingRecorder) {
        window.meetingRecorder.stop();
      }
    });
}

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
  if (browser) {
    try {
      await browser.close();
    } catch (e) {
      console.log('Browser close failed, attempting force kill');
      if (browser.process()) {
        process.kill(browser.process().pid);
      }
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