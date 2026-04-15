/**
 * AudioWorkletProcessor that captures raw PCM audio data
 * and sends it to the main thread via MessagePort.
 */
class AudioCaptureProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this._stopped = false;
    this.port.onmessage = (event) => {
      if (event.data.command === 'stop') {
        this._stopped = true;
      }
    };
  }

  process(inputs) {
    if (this._stopped) {
      return false; // stop the processor
    }

    const input = inputs[0];
    if (input && input.length > 0) {
      const channelData = input[0];
      // Copy the data since the buffer is reused by the audio system
      const copy = new Float32Array(channelData.length);
      copy.set(channelData);
      this.port.postMessage({ audioData: copy }, [copy.buffer]);
    }

    return true;
  }
}

registerProcessor('audio-capture-processor', AudioCaptureProcessor);
