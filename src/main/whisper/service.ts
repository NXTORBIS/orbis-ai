import { WHISPER_MODEL_INFO, recommendedModel, type WhisperModelId, type WhisperDownloadProgress, type WhisperHardwareInfo } from '../../shared/whisperModels.ts'
import type { VoiceErrorCode } from '../../shared/voiceInput.ts'
import { ModelManager, type FetchFn } from './modelManager.ts'
import { readHardware, transcribeLocal, whisperBinaryDir, WhisperRuntimeError } from './runtime.ts'

/**
 * The Orbis Speech Input Service.
 *
 * Everything that turns a recording into words, for every microphone in Orbis, goes through this one object: it
 * knows which model is installed, downloads one that is not, and runs whisper.cpp against a recording once it is.
 * Nothing above this — the chat composer, the address bar, Orbis Search, Browser Orion — knows or cares that any of
 * that happens; they hand over audio and get back words, the same way they would from anything else.
 *
 * There is no other way words get produced. If the model is missing, that is the answer — not a cloud call standing
 * in for one.
 */

export class WhisperService {
  readonly models: ModelManager
  private readonly binaryDir: string

  constructor(userDataDir: string, resourcesPath: string, fetchFn: FetchFn) {
    this.models = new ModelManager(userDataDir, fetchFn)
    this.binaryDir = whisperBinaryDir(resourcesPath)
  }

  hardware(): WhisperHardwareInfo {
    const base = readHardware()
    // Best-effort only, and never required: a machine this cannot say anything about still gets a CPU model.
    const hasNvidiaGpu = false
    return { ...base, hasNvidiaGpu, recommended: recommendedModel(base.totalRamMb, hasNvidiaGpu) }
  }

  async status(): Promise<{ installed: WhisperModelId[]; downloading: WhisperModelId[] }> {
    const installed = await this.models.installed()
    const downloading = (Object.keys(WHISPER_MODEL_INFO) as WhisperModelId[]).filter((id) => this.models.isDownloading(id))
    return { installed, downloading }
  }

  download(id: WhisperModelId, onProgress?: (progress: WhisperDownloadProgress) => void): Promise<void> {
    return this.models.download(id, onProgress)
  }

  cancelDownload(id: WhisperModelId): void {
    this.models.cancelDownload(id)
  }

  delete(id: WhisperModelId): Promise<void> {
    return this.models.delete(id)
  }

  verify(id: WhisperModelId): Promise<boolean> {
    return this.models.verify(id)
  }

  /**
   * The words in a recording, run entirely on this machine.
   *
   * `wav` is already 16 kHz mono PCM — the window's own decoder did that conversion, because that is where Chromium
   * can make sense of whatever the microphone actually recorded. This only ever runs the model against it.
   */
  async transcribe(wav: Buffer, modelId: WhisperModelId, language: string | null, signal?: AbortSignal): Promise<string> {
    if (!(await this.models.isInstalled(modelId))) throw new LocalVoiceError('model-missing', `${WHISPER_MODEL_INFO[modelId].label} is not installed.`)

    try {
      return await transcribeLocal(this.binaryDir, {
        wav,
        modelPath: this.models.modelPath(modelId),
        language,
        signal
      })
    } catch (err) {
      if (err instanceof WhisperRuntimeError) {
        if (err.code === 'cancelled') throw new LocalVoiceError('cancelled', 'Cancelled.')
        if (err.code === 'timeout') throw new LocalVoiceError('timeout', err.message)
        if (err.code === 'model-missing') throw new LocalVoiceError('model-missing', err.message)
        // A model that fails to load has usually failed a checksum, or the file is simply not whisper.cpp's format.
        if (!(await this.models.verify(modelId))) throw new LocalVoiceError('model-corrupted', err.message)
        throw new LocalVoiceError('runtime-error', err.message)
      }
      throw new LocalVoiceError('runtime-error', err instanceof Error ? err.message : String(err))
    }
  }
}

export class LocalVoiceError extends Error {
  readonly code: VoiceErrorCode
  constructor(code: VoiceErrorCode, message?: string) {
    super(message ?? code)
    this.name = 'LocalVoiceError'
    this.code = code
  }
}
