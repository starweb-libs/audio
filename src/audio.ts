/** Represents a registered sound with its decoded buffer and active playback instances. */
export type Sound = { buffer: AudioBuffer; instances: Set<AudioBufferSourceNode> };

/** Options for {@link Audio.playSound}. */
export type PlaySoundOptions = {
  loop?: boolean
};

/** Manages Web Audio API playback, volume, and sound registration.
 *
 * Must be initialized with {@link Audio.init} before any other methods are called.
 */
export class Audio {
  private ctx:          AudioContext | null = null;
  private gain:         GainNode     | null = null;
  private sounds:       Map<string, Sound>  = new Map();

  private _initialized: boolean = false;
  private _volume:      number  = 1;
  private _muted:       boolean = false;

  /** `true` if {@link init} has been called and the context is active. */
  get initialized(): boolean { return this._initialized; }

  /** Current master volume level (`0`-`1`). */
  get volume():      number  { return this._volume; }

  /** `true` if audio is currently muted. */
  get muted():       boolean { return this._muted; }

  /** Current {@link AudioContextState} (`"running"`, `"suspended"`, etc.).
   * @throws {Error} If not initialized.
   */
  get state():       AudioContextState {
    if (!this.ctx) throw new Error("Audio: not initialized");
    return this.ctx.state;
  }

  /** Initializes the Web Audio context and master gain node.
   *
   * Automatically resumes the context on the first user interaction
   * (`pointerdown` or `keydown`), working around browser autoplay restrictions.
   *
   * @returns A cleanup function that stops all sounds and closes the context.
   * @throws {Error} If already initialized.
   */
  init(): () => void {
    if (this._initialized) throw new Error("Audio: already initialized");

    this.ctx  = new AudioContext();
    this.gain = this.ctx.createGain();
    this.gain.connect(this.ctx.destination);
    this._initialized = true;

    const unlock = () => {
      if (this.ctx?.state === "suspended") this.ctx.resume();
      window.removeEventListener("pointerdown", unlock);
      window.removeEventListener("keydown", unlock);
    };
    window.addEventListener("pointerdown", unlock);
    window.addEventListener("keydown", unlock);

    return () => {
      window.removeEventListener("pointerdown", unlock);
      window.removeEventListener("keydown", unlock);
      for (const key of this.sounds.keys()) this.stopSound(key);
      this.sounds.clear();
      this.ctx?.close();
      this.ctx          = null;
      this.gain         = null;
      this._muted       = false;
      this._initialized = false;
    };
  }

  /** Resumes the audio context if suspended.
   * @throws {Error} If not initialized.
   */
  resume(): Promise<void> {
    if (!this.ctx) throw new Error("Audio: not initialized");
    return this.ctx.resume();
  }

  /** Sets the master volume, clamped to `[0,1]`. Has no effect on gain while muted.
   * @param value - Volume level between `0` (silent) and `1` (full).
   * @throws {Error} If not initialized.
   */
  setVolume(value: number): void {
    if (!this.gain) throw new Error("Audio: not initialized");
    this._volume = Math.max(0, Math.min(1, value));
    if (!this._muted) this.gain.gain.value = this._volume;
  }

  /** Mutes or unmutes the master gain. Volume level is preserved across toggles.
   * @throws {Error} If not initialized.
   * @param value - Mute (true), or unmute (false).
   */
  setMuted(value: boolean): void {
    if (!this.gain) throw new Error("Audio: not initialized");
    this._muted = value;
    this.gain.gain.value = value ? 0 : this._volume;
  }

  /** Fetches, decodes, and registers an audio buffer under the given key.
   * @param key - Unique identifier for the sound.
   * @param path - Path or URL to the audio file.
   * @param baseUrl - Base URL for resolving relative paths. Default: `"/"`
   * @throws {Error} If not initialized.
   * @throws {Error} If the given key is already registered.
   * @throws {Error} If the fetch fails.
   */
  async registerSound(key: string, path: string, baseUrl = "/"): Promise<void> {
    if (!this.ctx) throw new Error("Audio: not initialized");
    if (this.sounds.has(key)) throw new Error(`Audio: key "${key}" already registered`);

    const url = new URL(path, new URL(baseUrl, location.href).href).toString();
    const res  = await fetch(url);
    if (!res.ok) throw new Error(`Audio: failed to load "${key}" (${res.status} ${res.statusText})`);

    const buffer = await this.ctx.decodeAudioData(await res.arrayBuffer());
    this.sounds.set(key, { buffer, instances: new Set() });
  }

  /** Plays a registered sound by key.
   * @param key - The key used when registering the sound.
   * @param opts - See {@link PlaySoundOptions}.
   * @throws {Error} If not initialized or if `key` is unknown.
   */
  playSound(key: string, opts: PlaySoundOptions = {}): void {
    if (!this.ctx || !this.gain) throw new Error("Audio: not initialized");
    const sound = this.sounds.get(key);
    if (!sound) throw new Error(`Audio: unknown key "${key}"`);

    const src = this.ctx.createBufferSource();
    src.buffer = sound.buffer;
    src.loop   = opts.loop ?? false;
    src.connect(this.gain);
    sound.instances.add(src);
    src.onended = () => sound.instances.delete(src);
    src.start();
  }

  /** Stops all active instances of a registered sound.
   * @param key - The key used when registering the sound.
   * @throws {Error} If not initialized or if `key` is unknown.
   */
  stopSound(key: string): void {
    if (!this.ctx || !this.gain) throw new Error("Audio: not initialized");
    const sound = this.sounds.get(key);
    if (!sound) throw new Error(`Audio: unknown key "${key}"`);
    for (const src of sound.instances) {
      try { src.stop(); }
      catch (e) {
        if (!(e instanceof DOMException) || e.name !== "InvalidStateError") throw e;
      }
    }
    sound.instances.clear();
  }
}
