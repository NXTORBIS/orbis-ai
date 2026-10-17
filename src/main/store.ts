import { promises as fs } from 'node:fs'
import { DEFAULT_AVATAR, isAvatar } from '../shared/avatars.ts'
import { damageNote, openStored } from './storedFile.ts'
import { nullPlatform } from './platform.ts'
import type { SecretStorePort } from './platform'
import { join } from 'node:path'
import { DEFAULT_IMAGE_PREFERENCES, cleanImagePreferences } from './fastsd/engine.ts'
import { readBranches } from '../shared/conversationBranch.ts'
import { readHistorySummary, type HistorySummary } from '../shared/historySummary.ts'
import { DEFAULT_SOURCE_PREFERENCES, readSourcePreferences } from '../shared/researchSources.ts'
import type { Conversation, ReasoningEffort, Settings, SettingsUpdate, Theme } from '../shared/types'
import { CHAT_MODELS, DEFAULT_MODEL, currentModelId } from '../shared/models.ts'
import { DEFAULT_PROFILE_ID, dataDirFor } from '../shared/profiles.ts'

interface StoredSettings extends Omit<Settings, 'hasApiKey' | 'hasJudge0Key'> {
  /** base64; DPAPI-encrypted via safeStorage when `judge0KeyEncrypted` is true. Same treatment as the model key. */
  judge0Key?: string
  judge0KeyEncrypted?: boolean
  /** base64; DPAPI-encrypted via safeStorage when `apiKeyEncrypted` is true. */
  apiKey?: string
  apiKeyEncrypted?: boolean
}

const DEFAULTS: Omit<Settings, 'hasApiKey' | 'hasJudge0Key'> = {
  defaultModel: DEFAULT_MODEL,
  autoFallback: true,
  reasoningEffort: 'high',
  systemPrompt: '',
  theme: 'dark',
  assistantName: 'Orbis',
  userName: 'NxtOrbis',
  userAvatar: DEFAULT_AVATAR,
  userTitle: 'Commander',
  effects: true,
  welcomeCompleted: false,
  introVersion: 0,
  searchSuggestions: true,
  visualSearch: true,
  researchSources: DEFAULT_SOURCE_PREFERENCES,
  showResearchPlan: false,
  personalizedSuggestions: true,
  imageSize: DEFAULT_IMAGE_PREFERENCES.size,
  imageSteps: DEFAULT_IMAGE_PREFERENCES.steps,
  openBrowserOnLaunch: false,
  keepSchedulesRunning: false,
  wakeForSchedules: false,
  judge0Url: '',
  judge0KeyHeader: 'X-Auth-Token'
}

const THEMES: Theme[] = ['system', 'light', 'dark']
const EFFORTS: ReasoningEffort[] = ['low', 'high', 'max']
const ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/

export class Store {
  private readonly settingsPath: string
  private readonly userDataDir: string
  /** Whose conversations these are. Settings stay shared; conversations belong to the profile that had them. */
  private conversationsDir: string
  private settings: StoredSettings | null = null
  /** False when a settings file is there that Orbis could not read, in which case it must not be written over. */
  private settingsWritable = true
  /** What to tell somebody about the settings file, if anything went wrong opening it. */
  private settingsProblem: string | null = null
  private readonly writeQueues = new Map<string, Promise<void>>()

  private readonly secrets: SecretStorePort

  /** Where a key is kept encrypted. Handed in, so this file knows nothing about which engine Orbis runs on. */
  constructor(userDataDir: string, secrets: SecretStorePort = nullPlatform().secrets) {
    this.secrets = secrets
    this.settingsPath = join(userDataDir, 'settings.json')
    this.userDataDir = userDataDir
    // The default profile keeps the folder conversations have always been in.
    this.conversationsDir = join(userDataDir, dataDirFor(DEFAULT_PROFILE_ID), 'conversations')
  }

  /**
   * Moves to another profile's conversations. A save already queued keeps the path it was queued with, so a
   * conversation can never be written into the profile that was switched to.
   */
  useProfile(profileId: string): void {
    this.conversationsDir = join(this.userDataDir, dataDirFor(profileId), 'conversations')
  }

  async getSettings(): Promise<Settings> {
    const { apiKey, apiKeyEncrypted: _, judge0Key, judge0KeyEncrypted: __, ...rest } = await this.loadSettings()
    // Checked on the way out as well as in, so a file edited by hand or written by an older version still produces a
    // setting research can use rather than one it has to guess about.
    return { ...rest, researchSources: readSourcePreferences(rest.researchSources), hasApiKey: Boolean(apiKey), hasJudge0Key: Boolean(judge0Key) }
  }

  async updateSettings(update: SettingsUpdate): Promise<Settings> {
    const current = await this.loadSettings()
    const next: StoredSettings = { ...current }

    if (update.defaultModel !== undefined && CHAT_MODELS.some((m) => m.id === update.defaultModel)) next.defaultModel = update.defaultModel
    if (typeof update.autoFallback === 'boolean') next.autoFallback = update.autoFallback
    if (update.reasoningEffort && EFFORTS.includes(update.reasoningEffort)) next.reasoningEffort = update.reasoningEffort
    if (typeof update.systemPrompt === 'string') next.systemPrompt = update.systemPrompt.slice(0, 8000)
    if (update.theme && THEMES.includes(update.theme)) next.theme = update.theme
    if (typeof update.effects === 'boolean') next.effects = update.effects
    if (typeof update.assistantName === 'string') next.assistantName = update.assistantName.trim().slice(0, 40) || DEFAULTS.assistantName
    if (typeof update.userName === 'string') next.userName = update.userName.trim().slice(0, 40) || DEFAULTS.userName
    // An id Orbis does not know is not kept: a settings file from a newer build would otherwise leave this account
    // with a picture that cannot be drawn, and nothing downstream would have anything to fall back to.
    if (isAvatar(update.userAvatar)) next.userAvatar = update.userAvatar
    if (typeof update.userTitle === 'string') next.userTitle = update.userTitle.trim().slice(0, 40)
    if (typeof update.welcomeCompleted === 'boolean') next.welcomeCompleted = update.welcomeCompleted
    if (typeof update.introVersion === 'number' && Number.isFinite(update.introVersion))
      next.introVersion = Math.max(0, Math.floor(update.introVersion))
    if (typeof update.searchSuggestions === 'boolean') next.searchSuggestions = update.searchSuggestions
    // Read through the checker rather than taken as given: a damaged setting must not widen what research reads.
    if (update.researchSources !== undefined) next.researchSources = readSourcePreferences(update.researchSources)
    if (typeof update.showResearchPlan === 'boolean') next.showResearchPlan = update.showResearchPlan
    if (typeof update.personalizedSuggestions === 'boolean') next.personalizedSuggestions = update.personalizedSuggestions
    if (update.imageSize !== undefined || update.imageSteps !== undefined) {
      // A value the engine does not offer is not stored.
      const chosen = cleanImagePreferences({ size: update.imageSize ?? next.imageSize, steps: update.imageSteps ?? next.imageSteps })
      next.imageSize = chosen.size
      next.imageSteps = chosen.steps
    }
    if (typeof update.openBrowserOnLaunch === 'boolean') next.openBrowserOnLaunch = update.openBrowserOnLaunch
    if (typeof update.keepSchedulesRunning === 'boolean') next.keepSchedulesRunning = update.keepSchedulesRunning
    if (typeof update.wakeForSchedules === 'boolean') next.wakeForSchedules = update.wakeForSchedules

    // The address is checked here rather than trusted. Without this, anything that could write a settings file
    // could point the main process's fetch at whatever it liked.
    if (typeof update.judge0Url === 'string') {
      const given = update.judge0Url.trim()
      if (given === '') next.judge0Url = ''
      else {
        let parsed: URL | null = null
        try {
          parsed = new URL(given)
        } catch {
          parsed = null
        }
        if (parsed && (parsed.protocol === 'http:' || parsed.protocol === 'https:')) {
          next.judge0Url = parsed.toString().replace(/\/+$/, '')
        }
      }
    }
    if (typeof update.judge0KeyHeader === 'string') {
      // A header name is a token. Anything else would let a newline be smuggled into the request.
      const header = update.judge0KeyHeader.trim()
      if (/^[A-Za-z0-9-]{1,64}$/.test(header)) next.judge0KeyHeader = header
      else if (header === '') next.judge0KeyHeader = 'X-Auth-Token'
    }
    if (typeof update.judge0Key === 'string') {
      const key = update.judge0Key.trim()
      if (!key) {
        delete next.judge0Key
        delete next.judge0KeyEncrypted
      } else if (this.secrets.available()) {
        next.judge0Key = this.secrets.encrypt(key).toString('base64')
        next.judge0KeyEncrypted = true
      } else {
        next.judge0Key = Buffer.from(key, 'utf8').toString('base64')
        next.judge0KeyEncrypted = false
      }
    }

    if (typeof update.apiKey === 'string') {
      const key = update.apiKey.trim()
      if (!key) {
        delete next.apiKey
        delete next.apiKeyEncrypted
      } else if (this.secrets.available()) {
        next.apiKey = this.secrets.encrypt(key).toString('base64')
        next.apiKeyEncrypted = true
      } else {
        next.apiKey = Buffer.from(key, 'utf8').toString('base64')
        next.apiKeyEncrypted = false
      }
    }

    this.settings = next
    // A settings file Orbis could not read is left exactly as it is: it holds the key for the model service and
    // everything that was set up, and writing defaults over it is not something that can be undone. The change still
    // applies for this run, so nothing the person just did is lost on screen.
    if (this.settingsWritable) await this.writeJson(this.settingsPath, next)
    return this.getSettings()
  }

  /** What went wrong opening the settings file, in plain words. Null when nothing did. */
  settingsFileProblem(): string | null {
    return this.settingsProblem
  }

  /** The Judge0 key, decrypted. Never leaves the main process, and never reaches the renderer. */
  async getJudge0Key(): Promise<string | null> {
    const { judge0Key, judge0KeyEncrypted } = await this.loadSettings()
    if (!judge0Key) return null
    const bytes = Buffer.from(judge0Key, 'base64')
    try {
      return judge0KeyEncrypted ? this.secrets.decrypt(bytes) : bytes.toString('utf8')
    } catch {
      return null
    }
  }

  async getApiKey(): Promise<string | null> {
    const { apiKey, apiKeyEncrypted } = await this.loadSettings()
    if (!apiKey) return null
    const bytes = Buffer.from(apiKey, 'base64')
    try {
      return apiKeyEncrypted ? this.secrets.decrypt(bytes) : bytes.toString('utf8')
    } catch {
      return null
    }
  }

  async listConversations(): Promise<Conversation[]> {
    let files: string[]
    try {
      files = await fs.readdir(this.conversationsDir)
    } catch {
      return []
    }
    const conversations = await Promise.all(
      files
        .filter((f) => f.endsWith('.json'))
        .map(async (f): Promise<Conversation | null> => {
          try {
            const c = JSON.parse(await fs.readFile(join(this.conversationsDir, f), 'utf8')) as Conversation
            // Older chats may point at a model Groq retired (moved to its replacement) or that can't chat.
            // Parked answers are checked on the way in: a damaged one is dropped rather than loaded as something the
            // conversation could be switched to and then found to be empty.
            return { ...c, model: currentModelId(c.model), branches: readBranches(c.branches) }
          } catch {
            return null
          }
        })
    )
    return conversations.filter((c): c is Conversation => c !== null).sort((a, b) => b.updatedAt - a.updatedAt)
  }

  async saveConversation(conversation: Conversation): Promise<void> {
    if (!ID_PATTERN.test(conversation.id)) throw new Error('Invalid conversation id')
    await this.writeJson(join(this.conversationsDir, `${conversation.id}.json`), conversation)
  }

  async deleteConversation(id: string): Promise<void> {
    if (!ID_PATTERN.test(id)) throw new Error('Invalid conversation id')
    const path = join(this.conversationsDir, `${id}.json`)
    await this.enqueue(path, () => fs.rm(path, { force: true }))
    const summary = this.summaryPath(id)
    await this.enqueue(summary, () => fs.rm(summary, { force: true }))
  }

  /**
   * The rolling summary of a conversation's older turns, kept BESIDE the conversation (a `summaries` folder next to
   * `conversations`), not inside its file: the window saves whole conversations and would write over a field it never
   * loaded. Derived data -- anything unreadable is simply "no summary", and the conversation file is never touched.
   */
  private summaryPath(id: string): string {
    return join(this.conversationsDir, '..', 'summaries', `${id}.json`)
  }

  async getHistorySummary(id: string): Promise<HistorySummary | null> {
    if (!ID_PATTERN.test(id)) return null
    try {
      return readHistorySummary(JSON.parse(await fs.readFile(this.summaryPath(id), 'utf8')))
    } catch {
      return null
    }
  }

  async saveHistorySummary(id: string, summary: HistorySummary): Promise<void> {
    if (!ID_PATTERN.test(id)) return
    await this.writeJson(this.summaryPath(id), summary)
  }

  private async loadSettings(): Promise<StoredSettings> {
    if (this.settings) return this.settings
    /*
     * A file that could not be read is not a file that is not there.
     *
     * This used to be one catch around the read and the parse, so a settings file something else had open for a
     * moment looked exactly like a first run: Orbis started from defaults, and the next save wrote them over the real
     * settings -- the model key with them. Now an unreadable file keeps everything in memory and is not written over,
     * and a file that is really damaged is moved aside with the time on it rather than replaced.
     */
    const opened = await openStored(this.settingsPath, (text) => JSON.parse(text) as Partial<StoredSettings>, () => null)
    this.settingsWritable = opened.mayWrite
    this.settingsProblem = damageNote(opened, 'settings')
    try {
      const raw = opened.value
      // Anything but an object is corrupt; the catch below starts setup again from defaults.
      if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('Corrupt settings')
      this.settings = { ...DEFAULTS, ...raw }
      // Installations set up before the welcome screen existed are already configured.
      if (typeof raw.welcomeCompleted !== 'boolean') this.settings.welcomeCompleted = true
      this.settings.defaultModel = currentModelId(this.settings.defaultModel)
    } catch {
      this.settings = { ...DEFAULTS }
    }
    return this.settings
  }

  /** Atomic write (temp file + rename), serialized per path so saves never interleave. */
  private writeJson(path: string, data: unknown): Promise<void> {
    return this.enqueue(path, async () => {
      await fs.mkdir(join(path, '..'), { recursive: true })
      const tmp = `${path}.tmp`
      // Readable by this account only. settings.json holds the key for the model service; conversations hold
      // everything that was ever said.
      await fs.writeFile(tmp, JSON.stringify(data), { encoding: 'utf8', mode: 0o600 })
      await fs.rename(tmp, path)
    })
  }

  private enqueue(path: string, task: () => Promise<void>): Promise<void> {
    const run = (this.writeQueues.get(path) ?? Promise.resolve()).then(task, task)
    this.writeQueues.set(path, run.catch(() => undefined))
    return run
  }
}
