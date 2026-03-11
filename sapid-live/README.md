# react-native-sapid-live

> Open-source React Native library powering the Sapid AI Sous-Chef.
> Built for the **#GeminiLiveAgentChallenge**.

## Overview

This library contains everything needed to connect a React Native (Expo) app to the `sapid-live-agent-backend`, enabling real-time, hands-free voice and vision assistance in the kitchen.

## Architecture

```
react-native-sapid-live
├── src/
│   ├── index.ts                   # Public exports
│   ├── types.ts                   # Shared type definitions
│   ├── hooks/
│   │   ├── useLiveConnection.ts   # WebSocket connection manager
│   │   ├── useAudioStream.ts      # Mic capture & audio playback
│   │   └── useVisionStream.ts     # 1fps camera frame extraction
│   └── components/
│       ├── LiveAssistantOverlay.tsx  # Bottom overlay UI (mode selector / waveform)
│       └── WaveformVisualizer.tsx   # Animated waveform bars
```

## Usage in the Sapid App

```tsx
import {
  useLiveConnection,
  useAudioStream,
  useVisionStream,
  LiveAssistantOverlay,
} from 'react-native-sapid-live';

function CookingScreen({ recipe }) {
  const { connect, disconnect, sendMedia, sendAppState, mode, setMode } =
    useLiveConnection(
      { serverUrl: 'wss://your-backend.run.app', authToken: userToken },
      (event) => {
        if (event.type === 'serverContent') {
          // Play back audio from the agent
          playAudioChunk(event.data.audioData);
        }
      },
    );

  const { startRecording, stopRecording, playAudioChunk } = useAudioStream(
    (base64Pcm) => sendMedia('audio/pcm;rate=16000', base64Pcm),
  );

  const { cameraRef } = useVisionStream(
    mode === 'multimodal',
    (base64Jpeg) => sendMedia('image/jpeg', base64Jpeg),
  );

  // Sync recipe state on every step change
  useEffect(() => {
    sendAppState({
      currentScreen: 'cooking',
      recipeId: recipe.id,
      currentStep: recipe.currentStep,
      timers: recipe.activeTimers,
      userId: user.id,
    });
  }, [recipe.currentStep, recipe.activeTimers]);

  return (
    <View>
      {/* ... Recipe UI ... */}
      <LiveAssistantOverlay
        mode={mode}
        onStartVoice={() => {
          setMode('audio');
          connect({ currentScreen: 'cooking', recipeId: recipe.id, userId: user.id });
          startRecording();
        }}
        onStartMultimodal={() => {
          setMode('multimodal');
          connect({ currentScreen: 'cooking', recipeId: recipe.id, userId: user.id });
          startRecording();
        }}
        onStop={() => {
          stopRecording();
          disconnect();
          setMode('idle');
        }}
      />
    </View>
  );
}
```

## Integration Notes

### Audio (Native Module Required)

The `useAudioStream` hook contains clear `// IMPLEMENTATION NOTE` comments where you plug in the native audio library of your choice.  
Recommended: `react-native-audio-record` for raw PCM, or `expo-av` for a managed Expo workflow.

### Vision Camera

The `useVisionStream` hook contains `// IMPLEMENTATION NOTE` comments for integrating `react-native-vision-camera`. Use `takeSnapshot()` at 1fps and convert to base64 JPEG.

## WebSocket Message Protocol

| Direction | Event | Payload |
|---|---|---|
| Client → Server | `media` | `{ mimeType: string, data: string (base64) }` |
| Client → Server | `app_state` | `AppContext` object |
| Server → Client | `serverContent` | Gemini Live API message |
| Server → Client | `error` | `{ message: string }` |
