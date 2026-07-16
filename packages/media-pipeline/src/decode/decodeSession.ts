/**
 * Thin lifecycle wrapper around WebCodecs VideoDecoder with backpressure
 * hooks. Frame ownership passes to the sink — the sink MUST close() every
 * frame it receives.
 */
export class VideoDecodeSession {
  #decoder: VideoDecoder;
  #error: Error | null = null;

  constructor(
    config: VideoDecoderConfig,
    sink: (frame: VideoFrame) => void,
    onError: (e: Error) => void,
  ) {
    this.#decoder = new VideoDecoder({
      output: sink,
      error: (e) => {
        this.#error = e instanceof Error ? e : new Error(String(e));
        onError(this.#error);
      },
    });
    this.#decoder.configure(config);
  }

  static async isSupported(config: VideoDecoderConfig): Promise<boolean> {
    if (typeof VideoDecoder === "undefined") return false;
    try {
      const res = await VideoDecoder.isConfigSupported(config);
      return res.supported === true;
    } catch {
      return false;
    }
  }

  get queueSize(): number {
    return this.#decoder.decodeQueueSize;
  }

  get state(): CodecState {
    return this.#decoder.state;
  }

  decode(chunk: EncodedVideoChunk): void {
    if (this.#error) throw this.#error;
    this.#decoder.decode(chunk);
  }

  async flush(): Promise<void> {
    if (this.#decoder.state === "configured") await this.#decoder.flush();
  }

  close(): void {
    if (this.#decoder.state !== "closed") this.#decoder.close();
  }
}
