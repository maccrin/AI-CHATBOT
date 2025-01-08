import dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';
import puppeteer from 'puppeteer';
import schedule from 'node-schedule';
import fs from 'fs/promises';
import path from 'path';

// Load environment variables
dotenv.config();

// environment variables checking
const requiredEnvVars = ['SUPABASE_URL', 'SUPABASE_KEY'];
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
const RECORDING_DIR = path.join(process.cwd(), 'recordings');
const MEETING_CHECK_INTERVAL = '*/1 * * * *';
const PAGE_LOAD_TIMEOUT = 60000;
const RECORDING_CHUNK_SIZE = 1000;

// Handle individual meeting
const handleMeeting = async (meeting) => {
  let browser = null;
  
  try {
   
    if (!meeting?.id || !meeting?.meeting_url || !meeting?.start_date || !meeting?.end_date) {
      throw new Error('Invalid meeting object: missing required fields');
    }

    browser = await puppeteer.launch({
      headless: true,
      args: [
        '--use-fake-ui-for-media-stream',
        '--use-fake-device-for-media-stream',
        '--allow-file-access-from-files',
        '--enable-audio-service-sandbox',
        '--no-sandbox',
        '--disable-setuid-sandbox'
      ]
    });

    const page = await browser.newPage();
    
    // Set default timeout
    page.setDefaultTimeout(PAGE_LOAD_TIMEOUT);

    // Inject audio recording 
    await page.evaluateOnNewDocument(() => {
      // Create a recording context object instead of using window properties directly ( some ts error was there so for work around implemented this way )
      const recordingContext = {
        audioChunks: [],
        mediaRecorder: null
      };

      // Attach the recording context to window
      window.recordingContext = recordingContext;

      window.startRecording = async () => {
        try {
          const constraints = { 
            audio: {
              echoCancellation: true,
              noiseSuppression: true,
            },
            video: true 
          };
          
          const stream = await navigator.mediaDevices.getUserMedia(constraints);
          const mediaRecorder = new MediaRecorder(stream, {
            mimeType: 'audio/webm;codecs=opus'
          });
// check if the mimeType supported by browser or not 
const isSupported = MediaRecorder.isTypeSupported('audio/webm;codecs=opus');
console.log(isSupported ? 'Supported' : 'Not supported');

          mediaRecorder.addEventListner ('dataAvailable',(event) => {
            if (event.data.size > 0) {
              recordingContext.audioChunks.push(event.data);
            }
          });

          mediaRecorder.onerror = (error) => {
            console.error('MediaRecorder error:', error);
          };

          mediaRecorder.start(1000); // 1 second chunks
          recordingContext.mediaRecorder = mediaRecorder;
          return true;
        } catch (error) {
          console.error('Error starting recording:', error);
          return false;
        }
      };

      window.stopRecording = () => {
        return new Promise((resolve) => {
          const recorder = recordingContext.mediaRecorder;
          if (recorder && recorder.state !== 'inactive') {
            recorder.onstop = () => {
              const blob = new Blob(recordingContext.audioChunks, { 
                type: 'audio/webm;codecs=opus' 
              });
              recordingContext.audioChunks = [];
              resolve(blob);
            };
            recorder.stop();
          } else {
            resolve(null);
          }
        });
      };
    });


    console.log(`Joining meeting: ${meeting.id}`);
    await page.goto(meeting.meeting_url, {
      waitUntil: 'networkidle0',
      timeout: PAGE_LOAD_TIMEOUT
    });

    await fs.mkdir(RECORDING_DIR, { recursive: true });

    const recordingStarted = await page.evaluate(() => window.startRecording());
    if (!recordingStarted) {
      throw new Error('Failed to start recording');
    }
    console.log(`Started recording meeting: ${meeting.id}`);

    const meetingDuration = new Date(meeting.end_date) - new Date(meeting.start_date);
    if (meetingDuration <= 0) {
      throw new Error('Invalid meeting duration: end date must be after start date');
    }

    await Promise.race([
      new Promise(resolve => setTimeout(resolve, meetingDuration)),
      new Promise((_, reject) => setTimeout(() => 
        reject(new Error('Meeting duration timeout exceeded')), 
        meetingDuration + 5000))
    ]);

    const audioBase64 = await page.evaluate(async () => {
      const blob = await window.stopRecording();
      if (!blob) return null;

      return new Promise((resolve) => {
        const reader = new FileReader();
        reader.onloadend = () => resolve(reader.result.split(',')[1]);
        reader.readAsDataURL(blob);
      });
    });

    if (audioBase64) {
      const audioPath = path.join(RECORDING_DIR, `meeting_${meeting.id}.webm`);
      await fs.writeFile(audioPath, Buffer.from(audioBase64, 'base64'));
      console.log(`Saved meeting recording: ${audioPath}`);

      await supabase
        .from('meetings')
        .update({ 
          status: 'completed',
          recording_path: audioPath
        })
        .eq('id', meeting.id);
    }

  } catch (error) {
    console.error(`Error in meeting ${meeting.id}:`, error);

    await supabase
      .from('meetings')
      .update({
        status: 'canceled',
        error_message: error.message
      })
      .eq('id', meeting.id);

  } finally {
    if (browser) {
      await browser.close().catch(console.error);
    }
  }
};

// Schedule individual meeting
const scheduleMeeting = (meeting) => {
  const startDate = new Date(meeting.start_date);
  if (startDate <= new Date()) {
    console.warn(`Meeting ${meeting.id} start date is in the past, skipping`);
    return null;
  }

  return schedule.scheduleJob(startDate, async () => {
    try {
      console.log(`Starting scheduled meeting: ${meeting.id}`);
      await supabase
        .from('meetings')
        .update({ status: 'in_progress' })
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
        .from('meetings')
        .select('*')
        .eq('status', 'pending')
        .gte('start_date', new Date().toISOString());

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