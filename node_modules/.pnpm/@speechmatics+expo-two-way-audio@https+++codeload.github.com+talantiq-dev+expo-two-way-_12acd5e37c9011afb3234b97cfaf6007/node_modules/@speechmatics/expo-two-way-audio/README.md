# Expo Two-Way Audio (Extended)

An extended Expo module for high-performance, bidirectional PCM audio capturing and playback, specifically optimized for real-time conversational AI (like Gemini Live).

> [!NOTE]
> This is an extended version of `@speechmatics/expo-two-way-audio` with critical fixes for development and additional playback controls.

## Key Features

- **🚀 Hot Reload Resilient:** Fixed the common `IllegalArgumentException` on Android during development reloads.
- **⏹️ Advanced Playback Control:** Stop, pause, and resume audio playback programmatically.
- **🎙️ Clean Voice Input:** Built-in Acoustic Echo Cancellation (AEC) and noise suppression (16kHz PCM).
- **🔊 High Quality Output:** Optimized for 24kHz PCM playback (ideal for modern LLM voice APIs).
- **📊 Real-time Leveling:** Built-in volume meter for both input (mic) and output (speaker).
- **✨ iOS Voice Isolation:** Supports toggling system-level voice isolation modes on iOS.

## Installation

```bash
# If using from your local fork/path
npm install /path/to/expo-two-way-audio-extended

# Ensure buffer is installed (required for PCM handling)
npm install buffer
```

## Quick Start Guide

### 1. Initialize the Module
The module must be initialized once. In this extended version, re-initialization (e.g., during hot reload) is handled gracefully by tearing down stale audio engines automatically.

```tsx
import { initialize } from "expo-two-way-audio-extended";

useEffect(() => {
  initialize().then((success) => {
    console.log("Audio Engine ready:", success);
  });
}, []);
```

### 2. Play Audio with Playback Controls
You can now stop or pause playback immediately—critical for "interruptible" AI conversations.

```tsx
import { playPCMData, stopPlayback, pausePlayback, resumePlayback, isPlaying } from "expo-two-way-audio-extended";
import { Buffer } from "buffer";

// To play a chunk of base64 PCM data:
const playBuffer = (base64Data: string) => {
  const pcmData = new Uint8Array(Buffer.from(base64Data, "base64"));
  playPCMData(pcmData);
};

// To interrupt the AI:
const onUserInterrupted = () => {
  stopPlayback(); // Clears the queue and silences the speaker immediately
};
```

### 3. Handle Microphone Data
Toggle recording to start receiving PCM samples via the event listener.

```tsx
import { toggleRecording, useExpoTwoWayAudioEventListener } from "expo-two-way-audio-extended";

// 1. Listen for data
useExpoTwoWayAudioEventListener("onMicrophoneData", (event) => {
  // event.data is the raw PCM chunk
  sendToServer(event.data);
});

// 2. Start recording
toggleRecording(true);
```

### 4. Audio Visualization
Built-in volume levels allow for easy UI meters.

```tsx
useExpoTwoWayAudioEventListener("onInputVolumeLevelData", (event) => {
  // event.data is a float [0, 1]
  updateMicWaveform(event.data);
});

useExpoTwoWayAudioEventListener("onOutputVolumeLevelData", (event) => {
  // event.data is a float [0, 1]
  updateAIVoiceWaveform(event.data);
});
```

## API Reference

| Method | Description |
| :--- | :--- |
| `initialize()` | Standard setup. Safe to call multiple times (reloads). |
| `playPCMData(data)` | Schedules a `Uint8Array` for playback. |
| `stopPlayback()` | **New:** Stops active audio and clears all queued buffers. |
| `pausePlayback()` | **New:** Pauses the player without clearing the queue. |
| `resumePlayback()` | **New:** Resumes a paused player. |
| `isPlaying()` | **New:** Returns boolean state of the speaker. |
| `toggleRecording(bool)` | Mutes/Unmutes the microphone. |
| `clearAudioQueue()` | Clears pending audio without stopping the hardware immediately. |
| `tearDown()` | Fully releases audio hardware. |

## Background Audio
This module follows the **"Conversational UX"** pattern: 
- Conversations pause when the app is backgrounded.
- Interruptions (calls, alarms) are handled via the `onAudioInterruption` event.
- It is recommended to prompt the user to "Tap to Resume" when returning to the app rather than auto-starting background audio, which is notoriously flaky for bidirectional AEC processing.

## Platform Setup

### Android
Add these to your `app.json`:
```json
"expo": {
  "android": {
    "permissions": ["RECORD_AUDIO", "MODIFY_AUDIO_SETTINGS"]
  }
}
```

### iOS
The module handles `.playAndRecord` category with `.voiceChat` mode automatically for optimal AEC performance.

---
*Maintained as an extended version for enhanced developer experience and AI integration.*
