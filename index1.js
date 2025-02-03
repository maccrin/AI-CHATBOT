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
import { fileURLToPath } from 'url';
import { Readable } from "stream";
import dgram from "dgram";
import puppeteerCore from 'puppeteer-core';

// Fix for __dirname
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load environment variables
dotenv.config();

// Constants
const RECORDING_DIR = path.join(process.cwd(), 'recordings');
const MEETING_CHECK_INTERVAL = '*/1 * * * *';
const CHROME_PATH = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';

// Extension configuration
const extensionId = "bepmaejckfhbdbikphclmnmclpiheche";
const extensionPath = path.join(
  "C:",
  "Users",
  "Maddy",
  "AppData",
  "Local",
  "Google",
  "Chrome",
  "User Data",
  "Default",
  "Extensions",
  extensionId,
  "1.0.5_0"
);

// UDP Stream implementation following GitHub code
class UDPStream extends Readable {
  socket;
  constructor(port = 55200, onDestroy) {
    super({ highWaterMark: 1024 * 1024 * 8 });
    this.onDestroy = onDestroy;
    this.socket = dgram
      .createSocket("udp4", (data) => {
        this.push(data);
      })
      .bind(port, "127.0.0.1", () => {});

    this.resume();
  }

  _read(size) {}

  async destroy(error) {
    await this.onDestroy();
    this.socket.close();
    super.destroy();
    return this;
  }
}

// Launch configuration following GitHub implementation
async function launch(opts = {}) {
  if (!opts.args) opts.args = [];

  function addToArgs(arg, value) {
    if (!value) {
      if (opts.args.includes(arg)) return;
      return opts.args.push(arg);
    }
    let found = false;
    opts.args = opts.args.map((x) => {
      if (x.includes(arg)) {
        found = true;
        return x + "," + value;
      }
      return x;
    });
    if (!found) opts.args.push(arg + value);
  }

  addToArgs("--load-extension=", extensionPath);
  addToArgs("--disable-extensions-except=", extensionPath);
  addToArgs("--allowlisted-extension-id=", extensionId);
  addToArgs("--autoplay-policy=no-user-gesture-required");

  opts.headless = false;
  return await puppeteerCore.launch(opts);
}

// Get extension page following GitHub implementation
async function getExtensionPage(browser) {
  const extensionTarget = await browser.waitForTarget((target) => {
    return target.type() === "page" && target.url().includes(extensionId);
  });
  if (!extensionTarget) throw new Error("Cannot load extension");

  const extensionPage = await extensionTarget.page();
  if (!extensionPage) throw new Error("Cannot get page of extension");

  return extensionPage;
}

// Assert extension is loaded with GitHub retry policy
async function assertExtensionLoaded(ext, retryOpts = { each: 20, times: 3 }) {
  const wait = (ms) => new Promise(res => setTimeout(res, ms));
  
  for (let currentTick = 0; currentTick < retryOpts.times; currentTick++) {
    const isLoaded = await ext.evaluate(() => {
      return typeof START_RECORDING === "function" || 
             typeof startRecording === "function";
    });
    
    if (isLoaded) return;
    await wait(Math.pow(retryOpts.each, currentTick));
  }
  
  throw new Error("Could not find recording function in the browser context");
}

// Get stream following GitHub implementation
let currentIndex = 0;
async function getStream(page, opts) {
  if (!opts.audio && !opts.video) {
    throw new Error("At least audio or video must be true");
  }
  
  if (!opts.mimeType) {
    opts.mimeType = opts.video ? "video/webm" : "audio/webm";
  }
  
  if (!opts.frameSize) opts.frameSize = 20;
  const retryPolicy = { each: 20, times: 3, ...opts.retry };

  const extension = await getExtensionPage(page.browser());
  const index = currentIndex++;

  const stream = new UDPStream(55200 + index, () =>
    extension.evaluate((index) => {
      if (typeof STOP_RECORDING === "function") return STOP_RECORDING(index);
      if (typeof stopRecording === "function") return stopRecording(index);
      throw new Error("No recording stop function found");
    }, index)
  );

  await page.bringToFront();
  await assertExtensionLoaded(extension, retryPolicy);
  
  await extension.evaluate(
    (settings) => {
      if (typeof START_RECORDING === "function") return START_RECORDING(settings);
      if (typeof startRecording === "function") return startRecording(settings);
      throw new Error("No recording start function found");
    },
    { ...opts, index }
  );

  return stream;
}

// Configure Puppeteer plugins
const stealthPlugin = StealthPlugin();
stealthPlugin.enabledEvasions.delete('iframe.contentWindow');
stealthPlugin.enabledEvasions.delete('media.codecs');
puppeteer.use(stealthPlugin);
puppeteer.use(AnonymizeUAPlugin());
puppeteer.use(AdblockerPlugin({ blockTrackers: true }));

// Initialize Supabase client
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY
);

// Handle individual meeting with improved stability
const handleMeeting = async (meeting) => {
  let browser = null;
  let page = null;
  let stream = null;
  let recordingFile = null;
  
  try {
    console.log(`Starting meeting automation for meeting ID: ${meeting.id}`);

    // Create recordings directory
    fs.mkdirSync(RECORDING_DIR, { recursive: true });

    // Setup Chrome profile
    const USER_DATA_DIR = path.join(tmpdir(), `chrome_profile_${Date.now()}`);
    fs.rmSync(USER_DATA_DIR, { recursive: true, force: true });
    fs.mkdirSync(USER_DATA_DIR, { recursive: true });

    // Launch browser using GitHub implementation
    browser = await launch({
      executablePath: CHROME_PATH,
      ignoreDefaultArgs: ["--enable-automation"],
      args: [
        '--no-sandbox',
        `--user-data-dir=${USER_DATA_DIR}`,
        '--disable-gpu',
        '--disable-dev-shm-usage',
        '--start-maximized',
        '--use-fake-ui-for-media-stream',
        '--disable-features=IsolateOrigins,site-per-process',
        '--disable-site-isolation-trials',
      ],
      defaultViewport: null,
      timeout: 180000
    });

    // Set up main page
    page = await browser.newPage();
    await page.setDefaultTimeout(60000);
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');

    // Handle dialogs automatically
    page.on('dialog', async dialog => {
      await dialog.accept();
    });

    // Login process
    console.log('Starting Google authentication...');
    await page.goto('https://accounts.google.com/', { waitUntil: 'networkidle0' });
    
    const emailField = await page.waitForSelector('input[type="email"]');
    await emailField.type(process.env.GOOGLE_EMAIL, { delay: 100 });
    await page.click('#identifierNext');
    
    await page.waitForSelector('input[type="password"]', { visible: true });
    const passwordField = await page.$('input[type="password"]');
    await passwordField.type(process.env.GOOGLE_PASSWORD, { delay: 100 });
    await page.click('#passwordNext');
    
    await page.waitForNavigation({ waitUntil: 'networkidle0' });

    // Join meeting
    console.log('Joining meeting:', meeting.meeting_url);
    await page.goto(meeting.meeting_url, { waitUntil: 'networkidle0' });
    await new Promise(r => setTimeout(r, 8000));

    // Set up keep-alive mechanism
    const keepAliveInterval = setInterval(async () => {
      try {
        await page.evaluate(() => {
          // Simulate mouse movement
          const event = new MouseEvent('mousemove', {
            bubbles: true,
            cancelable: true,
            clientX: Math.random() * window.innerWidth,
            clientY: Math.random() * window.innerHeight
          });
          document.dispatchEvent(event);
        });
      } catch (err) {
        console.warn('Keep-alive action failed:', err);
      }
    }, 30000);

    // Handle pre-join controls
    try {
      // Turn off camera if present
      const cameraButton = await page.$('button[aria-label*="camera" i]');
      if (cameraButton) {
        await cameraButton.click();
        console.log('Camera turned off');
      }

      // Mute microphone if present
      const micButton = await page.$('button[aria-label*="microphone" i]');
      if (micButton) {
        await micButton.click();
        console.log('Microphone muted');
      }
    } catch (e) {
      console.warn('Error handling pre-join controls:', e);
    }

    // Join meeting
    try {
      const joinButton = await page.evaluateHandle(() => {
        const buttons = Array.from(document.querySelectorAll('button'));
        return buttons.find(button => {
          const text = button.textContent?.toLowerCase() || '';
          return text.includes('join') || text.includes('ask to join');
        });
      });

      if (joinButton) {
        await joinButton.click();
        console.log('Clicked join button');
        await new Promise(r => setTimeout(r, 5000));
      }
    } catch (e) {
      console.warn('Error clicking join button:', e);
    }

    // Start recording
    console.log('Starting recording...');
    const audioFilename = path.join(RECORDING_DIR, `meeting-${meeting.id}-audio-${Date.now()}.webm`);
    recordingFile = fs.createWriteStream(audioFilename);

    // Initialize stream with retry policy
    stream = await getStream(page, {
      audio: true,
      video: false,
      mimeType: "audio/webm;codecs=opus",
      audioBitsPerSecond: 128000,
      frameSize: 20,
      retry: {
        each: 20,
        times: 5
      }
    });

    stream.pipe(recordingFile);
    console.log('Recording started successfully');

    // Wait for meeting duration
    const meetingDuration = new Date(meeting.end_time) - new Date(meeting.start_time);
    console.log(`Waiting for meeting duration: ${meetingDuration}ms`);
    await new Promise(r => setTimeout(r, meetingDuration));

    // Cleanup
    clearInterval(keepAliveInterval);
    
    if (stream) {
      await stream.destroy();
    }
    
    if (recordingFile) {
      recordingFile.end();
    }
    
    console.log('Recording completed successfully');

    await supabase
      .from('meeting')
      .update({ 
        status: 'completed',
        recording_path: audioFilename 
      })
      .eq('id', meeting.id);

  } catch (error) {
    console.error('Meeting automation failed:', error);
    
    if (stream) {
      try {
        await stream.destroy();
      } catch (e) {
        console.error('Stream destroy failed:', e);
      }
    }
    
    if (recordingFile) {
      try {
        recordingFile.end();
      } catch (e) {
        console.error('File close failed:', e);
      }
    }
    
    await supabase
      .from('meeting')
      .update({
        status: 'cancelled',
        error_message: error.message
      })
      .eq('id', meeting.id);

  } finally {
    if (browser) {
      try {
        await browser.close();
      } catch (e) {
        console.error('Browser close failed:', e);
      }
    }
  }
};

// Your existing scheduling code remains the same
const scheduleMeeting = (meeting) => {
  const startDate = new Date(meeting.start_time);
  if (startDate <= new Date()) {
    console.warn(`Meeting ${meeting.id} start date is in the past, skipping`);
    return null;
  }

  return schedule.scheduleJob(startDate, async () => {
    try {
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

const monitorMeetings = async () => {
  const activeJobs = new Map();

  const monitorJob = schedule.scheduleJob(MEETING_CHECK_INTERVAL, async () => {
    try {
      const { data: meetings, error } = await supabase
        .from('meeting')
        .select('*')
        .eq('status', 'pending')
        .gte('start_time', new Date().toISOString());

      if (error) throw error;

      meetings?.forEach(meeting => {
        if (!activeJobs.has(meeting.id)) {
          const job = scheduleMeeting(meeting);
          if (job) {
            activeJobs.set(meeting.id, job);
            console.log(`Scheduled new meeting: ${meeting.id}`);
          }
        }
      });

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

  return () => {
    monitorJob.cancel();
    activeJobs.forEach(job => job.cancel());
    activeJobs.clear();
  };
};

const cleanup = async () => {
  console.log('Shutting down...');
  try {
    await schedule.gracefulShutdown();
    process.exit(0);
  } catch (error) {
    console.error('Error during shutdown:', error);
    process.exit(1);
  }
};

process.on('SIGTERM', cleanup);
process.on('SIGINT', cleanup);

console.log('Starting meeting monitor...');
monitorMeetings().catch(error => {
  console.error('Fatal error in meeting monitor:', error);
  process.exit(1);
});
