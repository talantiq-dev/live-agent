import { ExpoTwoWayAudioEventMap } from "./events";
export declare const useMicrophonePermissions: (options?: import("expo-modules-core").PermissionHookOptions<object> | undefined) => [import("expo-modules-core").PermissionResponse | null, () => Promise<import("expo-modules-core").PermissionResponse>, () => Promise<import("expo-modules-core").PermissionResponse>];
export declare function useIsRecording(): boolean;
export declare function useExpoTwoWayAudioEventListener<K extends keyof ExpoTwoWayAudioEventMap>(eventName: K, listener: (ev: ExpoTwoWayAudioEventMap[K]) => void): void;
//# sourceMappingURL=hooks.d.ts.map