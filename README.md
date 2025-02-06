# Automated Google Meet Recorder ( Through Puppeteer)

This project automates the process of joining Google Meet meetings after successful google authetication, recording audio using FFmpeg, and updating meeting status on Supabase. It uses Puppeteer with extra plugins to bypass bot detection and schedule meeting joins based on data fetched from a Supabase database.

## Features

- **Automated Meeting Scheduling:** Checks a Supabase table called meeting for upcoming meetings and schedules them.
- **Google Authentication:** Uses Puppeteer to automate login to your Google account.
- **Meeting Join & Audio Recording:** Automatically joins meetings, mutes the microphone, and records audio using FFmpeg.
- **Stealth & Anonymity:** Employs puppeteer-extra plugins (Stealth, Anonymize-UA, and Adblocker) to avoid detection.
- **Graceful Shutdown:** Listens for process signals to shutdown gracefully.

## Requirements

- **Node.js** (v12.x or later is recommended)
- **npm** (installed with Node.js)
- **Google Chrome:** Ensure Google Chrome is installed. The project uses a specific executable path .

1. **Clone the Repository**
   git clone https://github.com/your-username/your-repo.git
   cd your-repo
2. **Run the Command**
   npm install

   This will install all the dependencies listed in your package.json, including:

   ## dotenv for loading environment variables ##
  @supabase/supabase-js for interacting with the Supabase database.
  puppeteer, puppeteer-core, and puppeteer-extra (with plugins) for browser automation.
  node-schedule for scheduling meetings.
  fluent-ffmpeg and @ffmpeg-installer/ffmpeg for audio recording.
  
   ## (Optional) Global Installation for Development ##

  npm install -g nodemon

   ## Configure your .env file with the following credentials ##

  SUPABASE_URL=your_supabase_project_url
  SUPABASE_KEY=your_supabase_anon_or_service_role_key
  GOOGLE_EMAIL=your_google_email
  GOOGLE_PASSWORD=your_google_password

  Ensure your Google account settings allow automated access.
  The project uses FFmpeg from the @ffmpeg-installer/ffmpeg package, so no extra FFmpeg installation is needed.

   ## Chrome executable Path ##

  const CHROME_PATH = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';

   ## Entry Point ##
  index.js

  ## To run in Dev Environment ##
  npm run dev

  ## Code Flow ##

  Meeting Monitoring:
  The scheduler (using node-schedule) queries the Supabase meeting table for upcoming meetings (status: pending) and schedules each meeting based on its start time.

  Google Authentication & Meeting Join:
  When a meeting is scheduled to start:

  A headless Chrome instance is launched with a custom user data directory.
  The application automates logging into Google using credentials from the .env file.
  It navigates to the meeting URL and handles the pre-join steps (muting the microphone, clicking join, etc.).
  Audio Recording:
  FFmpeg is used to capture audio from the available system audio device (preferring “Stereo Mix” if available , in my case it was not available). The audio is recorded and saved as an MP3 file in the recordings folder.

  Meeting Completion:
  Once the meeting ends (based on the scheduled end time), the audio recording stops, and the meeting status is updated in Supabase. In case of errors, the meeting status is updated to cancelled along with an error message.

  ## Dependencies ##
  Key dependencies used in this project include:

  @ffmpeg-installer/ffmpeg & fluent-ffmpeg: For handling audio recording.
  @supabase/supabase-js: For interacting with the Supabase backend.
  puppeteer, puppeteer-core, puppeteer-extra: For browser automation and stealth navigation.
  node-schedule: For scheduling meetings based on their start time.
  dotenv: For managing environment variables.
  Please refer to the package.json file for complete list.