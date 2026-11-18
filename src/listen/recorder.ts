/**
 * Microphone recorder for Listen mode.
 *
 * Records with the browser's MediaRecorder and, while recording, reports a live
 * loudness level (0..1) so the screen can show the music being heard.
 * The browser's voice processing (echo cancellation, noise suppression, automatic
 * gain) is switched off: it is tuned for speech and would smear piano notes.
 *
 * The recording never leaves the device. It is decoded straight into an AudioBuffer.
 */

/** The longest recording we accept, in seconds (keeps transcription quick). */
export const MAX_SECONDS = 60;

export class Recorder {
  private stream: MediaStream | null = null;
  private recorder: MediaRecorder | null = null;
  private chunks: Blob[] = [];
  private context: AudioContext | null = null;
  private meterFrame = 0;
  private stopTimer = 0;

  /** Called about 60 times a second with the current loudness, 0..1. */
  onLevel: (level: number) => void = () => {};
  /** Called if recording stops on its own (the time limit). */
  onAutoStop: () => void = () => {};

  /** Ask for the microphone and start recording. Throws a friendly error if it's not possible. */
  async start(): Promise<void> {
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
      throw new Error('This browser cannot record audio. Try Chrome, Edge, Firefox or Safari.');
    }
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
      });
    } catch (err) {
      const name = err instanceof DOMException ? err.name : '';
      if (name === 'NotAllowedError' || name === 'SecurityError') {
        throw new Error('Microphone access was blocked. Allow the microphone for this site and try again.');
      }
      if (name === 'NotFoundError') throw new Error('No microphone was found.');
      throw new Error('The microphone could not be started.');
    }

    this.chunks = [];
    this.recorder = new MediaRecorder(this.stream);
    this.recorder.ondataavailable = (e) => e.data.size && this.chunks.push(e.data);
    this.recorder.start();
    this.startMeter(this.stream);
    this.stopTimer = window.setTimeout(() => this.onAutoStop(), MAX_SECONDS * 1000);
  }

  /** Stop recording and return the audio, decoded. */
  async stop(): Promise<AudioBuffer> {
    const recorder = this.recorder;
    if (!recorder) throw new Error('Nothing is being recorded.');
    const stopped = new Promise<void>((resolve) => (recorder.onstop = () => resolve()));
    recorder.stop();
    await stopped;
    this.release();
    const blob = new Blob(this.chunks, { type: recorder.mimeType });
    const data = await blob.arrayBuffer();
    // Decoding needs no running audio; an offline context avoids any autoplay rules.
    return new OfflineAudioContext(1, 1, 44100).decodeAudioData(data);
  }

  /** Stop without keeping anything (closing the panel mid-recording). */
  cancel(): void {
    if (this.recorder && this.recorder.state !== 'inactive') this.recorder.stop();
    this.release();
  }

  private startMeter(stream: MediaStream): void {
    this.context = new AudioContext();
    const analyser = this.context.createAnalyser();
    analyser.fftSize = 1024;
    this.context.createMediaStreamSource(stream).connect(analyser);
    const samples = new Float32Array(analyser.fftSize);
    const tick = () => {
      analyser.getFloatTimeDomainData(samples);
      let sum = 0;
      for (const s of samples) sum += s * s;
      const rms = Math.sqrt(sum / samples.length);
      this.onLevel(Math.min(1, rms * 6)); // scaled so a hum or a piano fills the meter nicely
      this.meterFrame = requestAnimationFrame(tick);
    };
    tick();
  }

  /** Turn the microphone off (the browser's recording light goes out) and stop the meter. */
  private release(): void {
    cancelAnimationFrame(this.meterFrame);
    clearTimeout(this.stopTimer);
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
    void this.context?.close();
    this.context = null;
    this.recorder = null;
  }
}
