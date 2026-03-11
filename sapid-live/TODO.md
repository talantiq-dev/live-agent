# Sapid Live TODOs

## Audio Engine Limitations
- **Interrupts & Gapless Playback**: Currently, when an agent is interrupted (e.g. via VAD speech detection), we clear the local JS `playbackQueueRef`. However, the underlying `@speechmatics/expo-two-way-audio` native module does not expose a way to completely purge the audio chunks that have already been handed down to the OS-level hardware player (`AudioTrack` on Android). This results in a tiny fraction of a second of "run-on" audio before the agent goes silent.
    - **Future Fix**: Consider forking the `@speechmatics/expo-two-way-audio` library to add a `clearAudioQueue()` native method that forcefully flushes the OS-level buffer.
