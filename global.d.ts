// global.d.ts
export {};

declare global {
  interface Window {
    meetingRecorder?: MediaRecorder;
  }
}
