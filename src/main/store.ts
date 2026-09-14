import { safeStorage } from 'electron'
import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import type { Conversation, ReasoningEffort, Settings, SettingsUpdate, Theme } from '../shared/types'
import { DEFAULT_MODEL, MODELS, isKnownModel } from '../shared/models'
import { DEFAULT_PERSONA } from '../shared/personas'

interface StoredSettings extends Omit<Settings, 'hasApiKey'> {
  /** base64; DPAPI-encrypted via safeStorage when `apiKeyEncrypted` is true. */
  apiKey?: string
  apiKeyEncrypted?: boolean
}

const DEFAULTS: Omit<Settings, 'hasApiKey'> = {
  defaultModel: DEFAULT_MODEL,
  autoFallback: true,
  reasoningEffort: 'high',
  systemPrompt: '',
  theme: 'dark',
  assistantName: 'Orbis',
  userName: 'NxtOrbis',
  userTitle: 'Commander',
  effects: true
}

const THEMES: Theme[] = ['system', 'light', 'dark']
const EFFORTS: ReasoningEffort[] = ['low', 'high', 'max']
const ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/

export class Store {
  private readonly settingsPath: string
  private readonly conversationsDir: string
  private settings: StoredSettings | null = null
  private readonly writeQueues = new Map<string, Promise<void>>()

  constructor(userDataDir: string) {
    this.settingsPath = join(userDataDir, 'settings.json')
    this.conversationsDir = join(userDataDir, 'conversations')
  }

  async getSettings(): Promise<Settings> {
    const { apiKey, apiKeyEncrypted: _, ...rest } = await this.loadSettings()
    return { ...rest, hasApiKey: Boolean(apiKey) }
  }

  async updateSettings(update: SettingsUpdate): Promise<Settings> {
    const current = await this.loadSettings()
    const next: StoredSettings = { ...current }

    if (update.defaultModel !== undefined && MODELS.some((m) => m.id === update.defaultModel)) next.defaultModel = update.defaultModel
    if (typeof update.autoFallback === 'boolean') next.autoFallback = update.autoFallback
    if (update.reasoningEffort && EFFORTS.includes(update.reasoningEffort)) next.reasoningEffort = update.reasoningEffort
    if (typeof update.systemPrompt === 'string') next.systemPrompt = update.systemPrompt.slice(0, 8000)
    if (update.theme && THEMES.includes(update.theme)) next.theme = update.theme
    if (typeof update.effects === 'boolean') next.effects = update.effects
    if (typeof update.assistantName === 'string') next.assistantName = update.assistantName.trim().slice(0, 40) || DEFAULTS.assistantName
    if (typeof update.userName === 'string') next.userName = update.userName.trim().slice(0, 40) || DEFAULTS.userName
    if (typeof update.userTitle === 'string') next.userTitle = update.userTitle.trim().slice(0, 40)

    if (typeof update.apiKey === 'string') {
      const key = update.apiKey.trim()
      if (!key) {
        delete next.apiKey
        delete next.apiKeyEncrypted
      } else if (safeStorage.isEncryptionAvailable()) {
        next.apiKey = safeStorage.encryptString(key).toString('base64')
        next.apiKeyEncrypted = true
      } else {
        next.apiKey = Buffer.from(key, 'utf8').toString('base64')
        next.apiKeyEncrypted = false
      }
    }

    this.settings = next
    await this.writeJson(this.settingsPath, next)
    return this.getSettings()
  }

  async getApiKey(): Promise<string | null> {
    const { apiKey, apiKeyEncrypted } = await this.loadSettings()
    if (!apiKey) return null
    const bytes = Buffer.from(apiKey, 'base64')
    try {
      return apiKeyEncrypted ? safeStorage.decryptString(bytes) : bytes.toString('utf8')
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
        .map(async (f) => {
          try {
            const c = JSON.parse(await fs.readFile(join(this.conversationsDir, f), 'utf8')) as Conversation
            // Older chats may lack a persona or point at a model that was removed because it can't chat.
            return { ...c, model: isKnownModel(c.model) ? c.model : DEFAULT_MODEL, persona: c.persona ?? DEFAULT_PERSONA }
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
  }

  private async loadSettings(): Promise<StoredSettings> {
    if (this.settings) return this.settings
    try {
      const raw = JSON.parse(await fs.readFile(this.settingsPath, 'utf8')) as Partial<StoredSettings>
      this.settings = { ...DEFAULTS, ...raw }
      if (!MODELS.some((m) => m.id === this.settings!.defaultModel)) this.settings.defaultModel = DEFAULT_MODEL
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
      await fs.writeFile(tmp, JSON.stringify(data), 'utf8')
      await fs.rename(tmp, path)
    })
  }

  private enqueue(path: string, task: () => Promise<void>): Promise<void> {
    const run = (this.writeQueues.get(path) ?? Promise.resolve()).then(task, task)
    this.writeQueues.set(path, run.catch(() => undefined))
    return run
  }
}
