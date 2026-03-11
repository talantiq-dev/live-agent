/**
 * Calculates the Root Mean Square (RMS) energy of a base64-encoded PCM audio chunk.
 * Used for software-level audio gating, interruption detection, and visual dynamics.
 */
export function getRMS(base64: string): number {
    try {
        const binary = atob(base64);
        const len = binary.length;
        // Each sample is 2 bytes (16-bit PCM)
        const samples = new Int16Array(len / 2);
        for (let i = 0; i < len; i += 2) {
            // Little-endian PCM
            const low = binary.charCodeAt(i);
            const high = binary.charCodeAt(i + 1);
            samples[i / 2] = (high << 8) | low;
        }

        let squareSum = 0;
        for (let i = 0; i < samples.length; i++) {
            const sample = samples[i];
            squareSum += sample * sample;
        }

        return Math.sqrt(squareSum / samples.length);
    } catch (e) {
        return 0;
    }
}
