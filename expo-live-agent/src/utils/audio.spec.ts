import { getRMS, base64ToBytes, bytesToBase64 } from '../utils/audio';

describe('Audio Utilities', () => {
    describe('getRMS', () => {
        it('should return 0 for silence', () => {
            const silence = Buffer.from(new Int16Array(100).fill(0).buffer).toString('base64');
            expect(getRMS(silence)).toBe(0);
        });

        it('should calculate RMS correctly', () => {
            // A simple sine wave or constant value
            const constant = Buffer.from(new Int16Array(100).fill(1000).buffer).toString('base64');
            expect(getRMS(constant)).toBeCloseTo(1000);
        });
    });

    describe('Base64 Conversion', () => {
        it('should round-trip bytes to base64 and back', () => {
            const original = new Uint8Array([0, 1, 2, 255, 128, 64]);
            const b64 = bytesToBase64(original);
            const back = base64ToBytes(b64);
            expect(back).toEqual(original);
        });
    });
});
