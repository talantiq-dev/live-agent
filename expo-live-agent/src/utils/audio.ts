/**
 * Audio processing utilities for the Live Agent SDK.
 */

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

const b64chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const b64tab = new Uint8Array(256);
for (let i = 0; i < b64chars.length; i++) {
    b64tab[b64chars.charCodeAt(i)] = i;
}

/**
 * Optimized base64 to Uint8Array conversion.
 */
export function base64ToBytes(base64: string): Uint8Array {
    let len = base64.length;
    if (base64[len - 1] === '=') len--;
    if (base64[len - 1] === '=') len--;

    const out = new Uint8Array((len * 3) / 4);
    let outIdx = 0;

    for (let i = 0; i < base64.length; i += 4) {
        const c1 = b64tab[base64.charCodeAt(i)];
        const c2 = b64tab[base64.charCodeAt(i + 1)];
        const c3 = b64tab[base64.charCodeAt(i + 2)];
        const c4 = b64tab[base64.charCodeAt(i + 3)];

        out[outIdx++] = (c1 << 2) | (c2 >> 4);
        if (base64[i + 2] !== '=') {
            out[outIdx++] = ((c2 & 15) << 4) | (c3 >> 2);
        }
        if (base64[i + 3] !== '=') {
            out[outIdx++] = ((c3 & 3) << 6) | c4;
        }
    }
    return out;
}

/**
 * Optimized Uint8Array to base64 conversion.
 */
export function bytesToBase64(bytes: Uint8Array): string {
    let out = '';
    const len = bytes.length;
    for (let i = 0; i < len; i += 3) {
        out += b64chars[bytes[i] >> 2];
        out += b64chars[((bytes[i] & 3) << 4) | (bytes[i + 1] >> 4)];
        out += (i + 1 < len) ? b64chars[((bytes[i + 1] & 15) << 2) | (bytes[i + 2] >> 6)] : '=';
        out += (i + 2 < len) ? b64chars[bytes[i + 2] & 63] : '=';
    }
    return out;
}
