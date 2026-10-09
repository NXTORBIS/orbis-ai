import { randomUUID } from 'node:crypto'
import { ipcMain } from 'electron'
import type { BrowserWindow, IpcMainInvokeEvent } from 'electron'
import { StudentService } from './service.ts'
import { StudentStore } from './store.ts'
import { ENVIRONMENTS, PRESETS, SOUNDS, playableSounds } from '../../shared/student/atmosphere.ts'
import { FOCUS_LEVELS, FOCUS_PRESETS, POMODORO } from '../../shared/student/focus.ts'
import { ACHIEVEMENTS, QUESTS, achievementById } from '../../shared/student/progress.ts'
import { COSMETICS } from '../../shared/student/orbi.ts'
import { RESET_SCOPES, WIDGETS } from '../../shared/student/prefs.ts'
import { BAND_LABELS, CATEGORY_LABELS, canonical, categorise } from '../../shared/student/safety.ts'
import { dayKey, lastDays, monthKey, weekKey } from '../../shared/student/days.ts'
import { MISTAKE_LABELS, mistakePattern, mistakesToReview, quizSummary, struggling } from '../../shared/student/learn.ts'
import { heatmap, recapFor, timeline, weekReview } from '../../shared/student/insight.ts'
import { dueCounts, estimateAccuracy, goalProgress, planTime, studyQueue } from '../../shared/student/goals.ts'
import type { ResetScope } from '../../shared/student/prefs.ts'

/**
 * What the Orbis window may ask Orbis Student.
 *
 * One channel, `student:do`, with an operation name -- the same shape Orbis Music uses. Student has something like a
 * hundred and forty things a surface can ask for, and a hundred and forty IPC channels would be a hundred and forty
 * lines in the channel map for one feature, each of which has to be documented and none of which would be read.
 *
 * Everything that changes anything goes through `StudentService`, never into the store directly, so the service stays
 * the only thing that can settle a session or pay anything out. The handlers here do three things and nothing else:
 * check the sender, coerce what arrived into something safe, and hand it on.
 */

export interface StudentIpcOptions {
  service: StudentService
  store: StudentStore
  getWindow(): BrowserWindow | null
}

const id = (value: unknown): string | null => (typeof value === 'string' && value.length > 0 && value.length <= 80 ? value : null)
const text = (value: unknown, limit: number): string => (typeof value === 'string' ? value.trim().slice(0, limit) : '')
const num = (value: unknown, fallback = 0): number => (typeof value === 'number' && Number.isFinite(value) ? value : fallback)
const object = (value: unknown): Record<string, unknown> => (value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {})
const strings = (value: unknown, limit: number, each = 200): string[] =>
  Array.isArray(value) ? value.filter((one): one is string => typeof one === 'string').map((one) => one.slice(0, each)).slice(0, limit) : []

export function registerStudentIpc(o: StudentIpcOptions): void {
  const { service, store } = o
  const mine = (event: IpcMainInvokeEvent): boolean => event.sender === o.getWindow()?.webContents

  ipcMain.handle('student:do', async (event, op: unknown, a?: unknown, b?: unknown, c?: unknown) => {
    if (!mine(event)) throw new Error('Not allowed.')
    const at = Date.now()

    switch (op) {
      // ---------------------------------------------------------------- looking
      case 'snapshot':
        return service.snapshot()
      case 'progress':
        return service.progress()
      case 'moment':
        return service.momentNow()
      case 'problems':
        return store.problems()
      case 'today-learning':
        return service.today()
      case 'preview-policy':
        return service.preview({ level: (text(a, 10) || 'focus') as 'light' | 'focus' | 'deep', ...object(b) })

      /**
       * Everything that never changes: levels, presets, quests, achievements, sounds, widgets, labels.
       *
       * Sent once rather than duplicated in the renderer, so a quest's wording or an achievement's threshold exists
       * in exactly one place. Two copies of a threshold is two thresholds, and the wrong one is always the one on
       * screen.
       */
      case 'catalogue':
        return {
          levels: FOCUS_LEVELS,
          presets: FOCUS_PRESETS,
          pomodoro: POMODORO,
          quests: QUESTS,
          achievements: ACHIEVEMENTS,
          cosmetics: COSMETICS,
          sounds: SOUNDS,
          playableSounds: playableSounds([]).map((one) => one.id),
          atmospheres: PRESETS,
          environments: ENVIRONMENTS,
          widgets: WIDGETS,
          resetScopes: RESET_SCOPES,
          categories: CATEGORY_LABELS,
          bands: BAND_LABELS,
          mistakeKinds: MISTAKE_LABELS
        }

      // ---------------------------------------------------------------- onboarding and settings
      case 'onboard': {
        const answers = object(a)
        await service.onboard({
          name: text(answers.name, 60),
          dob: typeof answers.dob === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(answers.dob) ? answers.dob : null,
          learning: strings(answers.learning, 12, 60),
          workingToward: strings(answers.workingToward, 12, 60),
          focusStyle: (text(answers.focusStyle, 20) || 'unsure') as 'short' | 'pomodoro' | 'long' | 'deep' | 'flexible' | 'unsure',
          atmosphere: text(answers.atmosphere, 40) || 'minimal'
        })
        return { ok: true }
      }
      case 'save-settings':
        await service.savePreferences(object(a))
        return { ok: true }
      case 'save-orbi': {
        const held = await store.orbi.read()
        const patch = object(a)
        await store.orbi.write({
          ...held,
          name: text(patch.name, 40) || held.name,
          worn: Array.isArray(patch.worn) ? strings(patch.worn, 20, 60).filter((one) => held.unlocked.includes(one)) : held.worn,
          room: Array.isArray(patch.room)
            ? patch.room
                .filter((one): one is Record<string, unknown> => !!one && typeof one === 'object')
                .map((one) => ({ itemId: text(one.itemId, 60), x: num(one.x), y: num(one.y) }))
                // Only what has actually been unlocked may be placed, whatever arrives here.
                .filter((one) => held.unlocked.includes(one.itemId))
                .slice(0, 60)
            : held.room,
          updatedAt: at
        })
        store.changed()
        return { ok: true }
      }
      case 'reset':
        await service.reset((text(a, 20) || 'everything') as ResetScope)
        return { ok: true }
      case 'rest-day':
        await service.restDay()
        return { ok: true }

      // ---------------------------------------------------------------- a session
      case 'start-focus':
        return service.startFocus(object(a) as never)
      case 'pause-focus':
        return { ok: await service.pauseFocus() }
      case 'resume-focus':
        return { ok: await service.resumeFocus() }
      case 'start-break':
        return { ok: await service.startBreak() }
      case 'end-break':
        return { ok: await service.endBreak() }
      case 'carry-on':
        return { ok: await service.carryOnFocus() }
      case 'end-focus':
        return service.endFocus({ reason: text(a, 120) })
      case 'journal':
        return { ok: id(a) ? await service.journal(a as string, text(b, 2000)) : false }
      case 'extra-minute':
        return service.extraMinute()
      case 'move-orbi': {
        // Where Orbi was put. Clamped where the setting is read, so nothing can push it off the window.
        const spot = object(a)
        await service.savePreferences({ orbiAt: typeof spot.x === 'number' && typeof spot.y === 'number' ? { x: spot.x, y: spot.y } : null })
        return { ok: true }
      }
      case 'orion-turn': {
        // Counted so the session summary can say Orion was used, which is a fact rather than a judgement.
        const state = await store.state.read()
        if (state.session) await store.state.write({ ...state, session: { ...state.session, orionTurns: state.session.orionTurns + 1 } })
        return { ok: true }
      }

      // ---------------------------------------------------------------- the browser asking
      case 'may-open':
        return service.mayOpen(text(a, 2048))
      case 'save-for-later':
        return service.saveForLater(text(a, 2048), text(b, 300), text(c, 600))
      case 'capture':
        return service.capture(text(a, 1000))

      // ---------------------------------------------------------------- goals, milestones, tasks
      case 'goals':
        return store.goals.all()
      case 'save-goal': {
        const patch = object(a)
        const existing = id(patch.id) ? await store.goals.get(patch.id as string) : null
        const saved = await store.goals.put({
          id: existing?.id ?? randomUUID(),
          title: text(patch.title, 200) || existing?.title || 'Goal',
          why: text(patch.why, 500),
          horizon: text(patch.horizon, 20) || existing?.horizon || 'long-term',
          subject: id(patch.subject),
          deadline: typeof patch.deadline === 'number' ? patch.deadline : (existing?.deadline ?? null),
          milestones: Array.isArray(patch.milestones)
            ? patch.milestones.map((one, index) => {
                const m = object(one)
                const before = existing?.milestones.find((x) => x.id === id(m.id))
                return {
                  id: before?.id ?? randomUUID(),
                  title: text(m.title, 200) || before?.title || 'Milestone',
                  stage: text(m.stage, 60),
                  targetDate: typeof m.targetDate === 'number' ? m.targetDate : (before?.targetDate ?? null),
                  taskIds: strings(m.taskIds, 200, 80),
                  // Never set from outside: a milestone is finished by its tasks being finished, and nothing else.
                  completedAt: before?.completedAt ?? null,
                  order: num(m.order, index)
                }
              })
            : (existing?.milestones ?? []),
          state: text(patch.state, 20) || existing?.state || 'active',
          completedAt: existing?.completedAt ?? null,
          createdAt: existing?.createdAt ?? at,
          updatedAt: at,
          profileId: store.who()
        })
        return saved
      }
      case 'remove-goal':
        return { ok: id(a) ? await store.goals.remove(a as string) : false }
      case 'goal-progress': {
        const goal = id(a) ? await store.goals.get(a as string) : null
        return goal ? goalProgress(goal, await store.tasks.all(), at) : null
      }

      case 'tasks':
        return store.tasks.all()
      case 'queue':
        return studyQueue(await store.tasks.all(), at, object(a) as never).slice(0, 50)
      case 'due-counts':
        return dueCounts(await store.tasks.all(), at)
      case 'estimate-accuracy':
        return estimateAccuracy(await store.tasks.all())
      case 'save-task': {
        const patch = object(a)
        const existing = id(patch.id) ? await store.tasks.get(patch.id as string) : null
        return store.tasks.put({
          id: existing?.id ?? randomUUID(),
          profileId: store.who(),
          title: text(patch.title, 300) || existing?.title || 'Task',
          subject: id(patch.subject) ?? existing?.subject ?? null,
          goalId: id(patch.goalId) ?? existing?.goalId ?? null,
          milestoneId: id(patch.milestoneId) ?? existing?.milestoneId ?? null,
          priority: text(patch.priority, 10) || existing?.priority || 'normal',
          estimate: typeof patch.estimate === 'number' ? Math.max(0, Math.round(patch.estimate)) : (existing?.estimate ?? null),
          actual: existing?.actual ?? 0,
          due: typeof patch.due === 'number' ? patch.due : patch.due === null ? null : (existing?.due ?? null),
          hasTime: typeof patch.hasTime === 'boolean' ? patch.hasTime : (existing?.hasTime ?? false),
          // Completion goes through the service, so the XP and the goal progress cannot be skipped by saving.
          state: existing?.state === 'completed' ? 'completed' : ((text(patch.state, 20) || existing?.state || 'planned') as never),
          notes: typeof patch.notes === 'string' ? text(patch.notes, 4000) : (existing?.notes ?? ''),
          order: num(patch.order, existing?.order ?? 0),
          completedAt: existing?.completedAt ?? null,
          createdAt: existing?.createdAt ?? at,
          updatedAt: at
        })
      }
      case 'complete-task':
        return id(a) ? service.completeTask(a as string) : { ok: false, xp: 0 }
      case 'remove-task':
        return { ok: id(a) ? await store.tasks.remove(a as string) : false }
      case 'reorder-tasks': {
        const order = strings(a, 2000, 80)
        await store.tasks.update((tasks) => tasks.map((one) => ({ ...one, order: order.indexOf(one.id) >= 0 ? order.indexOf(one.id) : one.order })))
        return { ok: true }
      }
      case 'plan-time':
        return planTime(num(a, 60), studyQueue(await store.tasks.all(), at), object(b) as never)

      // ---------------------------------------------------------------- capsules and spaces
      case 'capsules':
        return store.capsules.all()
      case 'save-capsule': {
        const patch = object(a)
        const existing = id(patch.id) ? await store.capsules.get(patch.id as string) : null
        const prefs = await store.prefs.read()
        return store.capsules.put({
          id: existing?.id ?? randomUUID(),
          profileId: store.who(),
          name: text(patch.name, 120) || existing?.name || 'Capsule',
          subject: id(patch.subject) ?? existing?.subject ?? null,
          task: text(patch.task, 300),
          goalId: id(patch.goalId) ?? existing?.goalId ?? null,
          intention: text(patch.intention, 400),
          minutes: Math.max(1, Math.min(600, num(patch.minutes, existing?.minutes ?? prefs.defaultMinutes))),
          level: text(patch.level, 10) || existing?.level || prefs.defaultLevel,
          blocked: strings(patch.blocked, 20, 20),
          approved: strings(patch.approved, 400, 300),
          blockedSites: strings(patch.blockedSites, 400, 300),
          breaks: { ...(existing?.breaks ?? prefs.defaultBreaks), ...object(patch.breaks) },
          atmosphere: id(patch.atmosphere) ?? existing?.atmosphere ?? null,
          playlistId: id(patch.playlistId) ?? existing?.playlistId ?? null,
          orbi: { ...(existing?.orbi ?? prefs.orbi), ...object(patch.orbi) },
          // Nothing said: the lock follows the level, because Deep Focus means locked. A capsule called Deep Focus
          // that then ran unlocked would be a capsule that does not do what its own name says.
          locked: typeof patch.locked === 'boolean' ? patch.locked : (existing?.locked ?? (text(patch.level, 10) || existing?.level) === 'deep'),
          notes: text(patch.notes, 2000),
          favourite: typeof patch.favourite === 'boolean' ? patch.favourite : (existing?.favourite ?? false),
          used: existing?.used ?? 0,
          completed: existing?.completed ?? 0,
          createdAt: existing?.createdAt ?? at,
          updatedAt: at
        } as never)
      }
      case 'remove-capsule':
        return { ok: id(a) ? await store.capsules.remove(a as string) : false }
      case 'duplicate-capsule': {
        const held = id(a) ? await store.capsules.get(a as string) : null
        if (!held) return null
        return store.capsules.put({ ...held, id: randomUUID(), name: `${held.name} copy`.slice(0, 120), used: 0, completed: 0, createdAt: at, updatedAt: at })
      }

      case 'spaces':
        return store.spaces.all()
      case 'save-space': {
        const patch = object(a)
        const existing = id(patch.id) ? await store.spaces.get(patch.id as string) : null
        return store.spaces.put({
          id: existing?.id ?? randomUUID(),
          profileId: store.who(),
          name: text(patch.name, 120) || existing?.name || 'Space',
          subject: id(patch.subject) ?? existing?.subject ?? null,
          tabs: Array.isArray(patch.tabs)
            ? patch.tabs
                .map((one) => object(one))
                .filter((one) => typeof one.url === 'string')
                .map((one) => ({ url: text(one.url, 2048), title: text(one.title, 300) }))
                .slice(0, 60)
            : (existing?.tabs ?? []),
          items: strings(patch.items, 300, 120),
          notes: text(patch.notes, 8000),
          capsuleIds: strings(patch.capsuleIds, 60, 80),
          goalId: id(patch.goalId) ?? existing?.goalId ?? null,
          atmosphere: id(patch.atmosphere) ?? existing?.atmosphere ?? null,
          playlistId: id(patch.playlistId) ?? existing?.playlistId ?? null,
          approved: strings(patch.approved, 400, 300),
          favourite: typeof patch.favourite === 'boolean' ? patch.favourite : (existing?.favourite ?? false),
          lastUsedAt: existing?.lastUsedAt ?? at,
          createdAt: existing?.createdAt ?? at,
          updatedAt: at
        })
      }
      case 'remove-space':
        return { ok: id(a) ? await store.spaces.remove(a as string) : false }

      // ---------------------------------------------------------------- saved for later, and thoughts
      case 'later':
        return store.distractions.all()
      case 'later-state': {
        const held = id(a) ? await store.distractions.get(a as string) : null
        if (!held) return { ok: false }
        const state = text(b, 20) || 'waiting'
        if (state === 'became-task') {
          await store.tasks.put({
            id: randomUUID(),
            profileId: store.who(),
            title: held.title.slice(0, 300),
            subject: null,
            goalId: null,
            milestoneId: null,
            priority: 'low',
            estimate: null,
            actual: 0,
            due: null,
            hasTime: false,
            state: 'planned',
            notes: held.url,
            order: 0,
            completedAt: null,
            createdAt: at,
            updatedAt: at
          })
        }
        await store.distractions.put({ ...held, state: state as never })
        return { ok: true }
      }
      case 'remove-later':
        return { ok: id(a) ? await store.distractions.remove(a as string) : false }
      case 'clear-later':
        await store.distractions.update((items) => items.filter((one) => one.state === 'waiting'))
        return { ok: true }
      case 'thoughts':
        return store.thoughts.all()
      case 'thought-state': {
        const held = id(a) ? await store.thoughts.get(a as string) : null
        if (!held) return { ok: false }
        const into = text(b, 20) || 'discarded'
        if (into === 'became-task') {
          await store.tasks.put({
            id: randomUUID(),
            profileId: store.who(),
            title: held.text.slice(0, 300),
            subject: null,
            goalId: null,
            milestoneId: null,
            priority: 'low',
            estimate: null,
            actual: 0,
            due: null,
            hasTime: false,
            state: 'planned',
            notes: '',
            order: 0,
            completedAt: null,
            createdAt: at,
            updatedAt: at
          })
        }
        if (into === 'became-note') {
          await store.notes.put({
            id: randomUUID(),
            profileId: store.who(),
            title: held.text.slice(0, 80),
            body: held.text,
            kind: 'quick',
            subject: null,
            goalId: null,
            sessionId: held.sessionId,
            conceptId: null,
            items: [],
            createdAt: at,
            updatedAt: at
          })
        }
        await store.thoughts.put({ ...held, state: into as never })
        return { ok: true }
      }

      // ---------------------------------------------------------------- learning
      case 'answer':
        return service.answer(text(a, 120), (text(b, 10) || 'known') as never, object(c) as never)
      case 'reviews':
        return store.reviews.read()
      case 'struggling':
        return struggling(await store.reviews.read())
      case 'quiz-summary':
        return quizSummary(await store.attempts.all())
      case 'flashcards':
        return store.flashcards.all()
      case 'save-flashcard': {
        const patch = object(a)
        const existing = id(patch.id) ? await store.flashcards.get(patch.id as string) : null
        return store.flashcards.put({
          id: existing?.id ?? randomUUID(),
          profileId: store.who(),
          front: text(patch.front, 1000),
          back: text(patch.back, 2000),
          subject: id(patch.subject),
          // Where it came from is kept honestly: a card Orion wrote says so wherever it is shown.
          origin: (text(patch.origin, 10) || existing?.origin || 'student') as never,
          deck: text(patch.deck, 80) || existing?.deck || 'Default',
          conceptId: id(patch.conceptId) ?? existing?.conceptId ?? null,
          // Editing a card never resets what practising it has shown.
          practised: existing?.practised ?? 0,
          recalled: existing?.recalled ?? 0,
          lastPractisedAt: existing?.lastPractisedAt ?? null,
          createdAt: existing?.createdAt ?? at
        })
      }
      case 'practised-card': {
        /*
         * One card practised.
         *
         * The count goes on the card, and the evidence goes to the concept only when the card names one -- and then
         * through the same path as everything else, so the hint ladder decides what it is worth.
         */
        const patch = object(a)
        if (!id(patch.id)) return { ok: false, why: 'Which card?' }
        return service.practisedCard(patch.id as string, patch.right === true, Array.isArray(patch.rungs) ? (strings(patch.rungs, 4, 10) as never) : [], text(patch.sittingId, 60))
      }
      case 'remove-flashcard':
        return { ok: id(a) ? await store.flashcards.remove(a as string) : false }
      case 'mistakes':
        return store.mistakes.all()
      case 'mistakes-to-review':
        return mistakesToReview(await store.mistakes.all())
      case 'mistake-pattern':
        return mistakePattern(await store.mistakes.all())
      case 'save-mistake': {
        const patch = object(a)
        const state = await store.state.read()
        return store.mistakes.put({
          id: id(patch.id) ?? randomUUID(),
          profileId: store.who(),
          subject: id(patch.subject),
          concept: text(patch.concept, 200),
          kind: (text(patch.kind, 20) || 'concept') as never,
          detail: text(patch.detail, 1000),
          at,
          reviewedAt: typeof patch.reviewedAt === 'number' ? patch.reviewedAt : null,
          sessionId: state.session?.id ?? null
        })
      }
      case 'remove-mistake':
        return { ok: id(a) ? await store.mistakes.remove(a as string) : false }
      case 'confusions':
        return store.confusions.all()
      case 'save-confusion': {
        const patch = object(a)
        const state = await store.state.read()
        return store.confusions.put({
          id: id(patch.id) ?? randomUUID(),
          profileId: store.who(),
          concept: text(patch.concept, 200),
          subject: id(patch.subject),
          note: text(patch.note, 1000),
          at,
          sessionId: state.session?.id ?? null,
          resolvedAt: typeof patch.resolvedAt === 'number' ? patch.resolvedAt : null
        })
      }
      case 'remove-confusion':
        return { ok: id(a) ? await store.confusions.remove(a as string) : false }
      case 'concepts':
        return store.concepts.all()
      case 'save-concept': {
        const patch = object(a)
        const existing = id(patch.id) ? await store.concepts.get(patch.id as string) : null
        return store.concepts.put({
          id: existing?.id ?? randomUUID(),
          profileId: store.who(),
          name: text(patch.name, 200),
          subject: id(patch.subject),
          mastery: Math.max(0, Math.min(1, num(patch.mastery, existing?.mastery ?? 0))),
          // Editing a concept's name or notes must never wipe what was measured about it.
          measured: existing?.measured ?? null,
          prerequisites: strings(patch.prerequisites, 40, 80),
          related: strings(patch.related, 60, 80),
          chapterId: existing?.chapterId ?? null,
          chapterName: existing?.chapterName ?? '',
          difficulty: existing?.difficulty ?? 3,
          importance: existing?.importance ?? 0.5,
          order: existing?.order ?? 0,
          lastTouchedAt: at,
          notes: text(patch.notes, 4000)
        })
      }

      // ---------------------------------------------------------------- the library
      case 'resources':
        return store.resources.all()
      case 'save-resource': {
        const patch = object(a)
        const url = canonical(text(patch.url, 2048))
        if (!url) return { ok: false, why: 'That is not an address Orbis can save.' }
        const held = await store.resources.all()
        // The same page saved twice is the same resource. Said so rather than quietly making a second copy.
        const already = held.find((one) => one.url === url)
        if (already && !id(patch.id)) {
          return { ok: true, duplicate: true, resource: already, why: 'Already in your study library.' }
        }
        const existing = id(patch.id) ? await store.resources.get(patch.id as string) : null
        const saved = await store.resources.put({
          id: existing?.id ?? randomUUID(),
          profileId: store.who(),
          url,
          title: text(patch.title, 300) || existing?.title || url,
          kind: (text(patch.kind, 20) || existing?.kind || 'website') as never,
          subject: id(patch.subject) ?? existing?.subject ?? null,
          goalId: id(patch.goalId) ?? existing?.goalId ?? null,
          tags: strings(patch.tags, 30, 40),
          notes: text(patch.notes, 4000),
          origin: (text(patch.origin, 10) || existing?.origin || 'web') as never,
          favourite: typeof patch.favourite === 'boolean' ? patch.favourite : (existing?.favourite ?? false),
          read: typeof patch.read === 'boolean' ? patch.read : (existing?.read ?? false),
          relevance: typeof patch.relevance === 'string' ? (patch.relevance as never) : (existing?.relevance ?? null),
          savedAt: existing?.savedAt ?? at,
          lastOpenedAt: existing?.lastOpenedAt ?? null
        })
        return { ok: true, duplicate: false, resource: saved }
      }
      case 'remove-resource':
        return { ok: id(a) ? await store.resources.remove(a as string) : false }
      case 'opened-resource': {
        const held = id(a) ? await store.resources.get(a as string) : null
        if (held) await store.resources.put({ ...held, lastOpenedAt: at, read: true })
        return { ok: Boolean(held) }
      }
      case 'suggest-resources': {
        // What is already saved about what somebody is about to study. Never a search, never invented.
        const subject = id(a)
        const words = text(b, 120).toLowerCase()
        const held = await store.resources.all()
        const notes = await store.notes.all()
        const mistakes = await store.mistakes.all()
        const matches = (haystack: string): boolean => words.length > 2 && haystack.toLowerCase().includes(words)
        return {
          resources: held.filter((one) => (subject && one.subject === subject) || matches(one.title) || one.tags.some((tag) => matches(tag))).slice(0, 12),
          notes: notes.filter((one) => (subject && one.subject === subject) || matches(one.title)).slice(0, 12),
          mistakes: mistakes.filter((one) => (subject && one.subject === subject) || matches(one.concept)).slice(0, 12)
        }
      }

      case 'notes':
        return store.notes.all()
      case 'save-note': {
        const patch = object(a)
        const existing = id(patch.id) ? await store.notes.get(patch.id as string) : null
        const state = await store.state.read()
        return store.notes.put({
          id: existing?.id ?? randomUUID(),
          profileId: store.who(),
          title: text(patch.title, 300),
          body: typeof patch.body === 'string' ? patch.body.slice(0, 100_000) : (existing?.body ?? ''),
          kind: (text(patch.kind, 20) || existing?.kind || 'quick') as never,
          subject: id(patch.subject) ?? existing?.subject ?? null,
          goalId: id(patch.goalId) ?? existing?.goalId ?? null,
          sessionId: existing?.sessionId ?? state.session?.id ?? null,
          conceptId: id(patch.conceptId) ?? existing?.conceptId ?? null,
          items: strings(patch.items, 200, 120),
          createdAt: existing?.createdAt ?? at,
          updatedAt: at
        })
      }
      case 'remove-note':
        return { ok: id(a) ? await store.notes.remove(a as string) : false }

      case 'boards':
        return (await store.boards.all()).map((one) => ({ ...one, data: undefined }))
      case 'board':
        return id(a) ? store.boards.get(a as string) : null
      case 'save-board': {
        const patch = object(a)
        const existing = id(patch.id) ? await store.boards.get(patch.id as string) : null
        const drawing = JSON.stringify(patch.data ?? null)
        // A board is a drawing, and a drawing has a size. Said rather than written and silently truncated.
        if (drawing.length > 4_000_000) return { ok: false, why: 'That board is too large to save. Try clearing some of it.' }
        const state = await store.state.read()
        const saved = await store.boards.put({
          id: existing?.id ?? randomUUID(),
          profileId: store.who(),
          name: text(patch.name, 120) || existing?.name || 'Whiteboard',
          data: patch.data ?? existing?.data ?? null,
          sessionId: existing?.sessionId ?? state.session?.id ?? null,
          capsuleId: id(patch.capsuleId) ?? existing?.capsuleId ?? null,
          spaceId: id(patch.spaceId) ?? existing?.spaceId ?? null,
          goalId: id(patch.goalId) ?? existing?.goalId ?? null,
          createdAt: existing?.createdAt ?? at,
          updatedAt: at
        })
        return { ok: true, id: saved.id }
      }
      case 'remove-board':
        return { ok: id(a) ? await store.boards.remove(a as string) : false }

      // ---------------------------------------------------------------- history and reviews
      case 'sessions':
        return (await store.sessions.all()).sort((x, y) => y.startedAt - x.startedAt).slice(0, num(a, 200))
      case 'session':
        return id(a) ? store.sessions.get(a as string) : null
      case 'heatmap':
        return heatmap(await store.sessions.all(), at, Math.max(7, Math.min(400, num(a, 70))))
      case 'timeline':
        return timeline(await store.sessions.all(), text(a, 10) || dayKey(at))
      case 'day-recap': {
        const day = text(a, 10) || dayKey(at)
        const [sessions, xp, tasks, reviews, attempts] = await Promise.all([store.sessions.all(), store.xp.all(), store.tasks.all(), store.reviews.read(), store.attempts.all()])
        const { learningOnDay } = await import('../../shared/student/learn.ts')
        return recapFor(day, sessions, xp, tasks, learningOnDay(reviews, attempts, day), attempts.filter((one) => dayKey(one.at) === day).length)
      }
      case 'week-review':
        return weekReview(text(a, 10) || weekKey(at), await store.sessions.all(), await store.xp.all(), await store.tasks.all())
      case 'month-review': {
        const month = text(a, 7) || monthKey(at)
        const sessions = (await store.sessions.all()).filter((one) => monthKey(one.startedAt) === month)
        const xp = (await store.xp.all()).filter((one) => monthKey(one.at) === month)
        const tasks = (await store.tasks.all()).filter((one) => one.completedAt !== null && monthKey(one.completedAt) === month)
        const attempts = (await store.attempts.all()).filter((one) => monthKey(one.at) === month)
        const state = await store.state.read()
        const byDay = new Map<string, number>()
        for (const session of sessions) byDay.set(dayKey(session.startedAt), (byDay.get(dayKey(session.startedAt)) ?? 0) + session.focusedSeconds)
        const best = [...byDay.entries()].sort((x, y) => y[1] - x[1])[0] ?? null
        return {
          month,
          focusedSeconds: Math.round(sessions.reduce((sum, one) => sum + one.focusedSeconds, 0)),
          sessions: sessions.length,
          completed: sessions.filter((one) => one.state === 'completed').length,
          xp: xp.reduce((sum, one) => sum + one.amount, 0),
          tasksCompleted: tasks.length,
          quizzes: attempts.length,
          subjects: [...state.subjects].sort((x, y) => y.focusedSeconds - x.focusedSeconds).slice(0, 12),
          achievements: state.achievements.filter((one) => monthKey(one.at) === month).map((one) => ({ ...one, rule: achievementById(one.achievementId) })),
          bestDay: best ? { day: best[0], seconds: Math.round(best[1]) } : null,
          bestSession: sessions.length > 0 ? [...sessions].sort((x, y) => y.focusedSeconds - x.focusedSeconds)[0] : null
        }
      }
      case 'days':
        return lastDays(at, Math.max(7, Math.min(400, num(a, 30))))
      case 'xp-history':
        return (await store.xp.all()).sort((x, y) => y.at - x.at).slice(0, num(a, 200))

      /**
       * Everything, in a portable shape, for somebody who wants their own data.
       *
       * Plain JSON of exactly what is stored, with nothing added and nothing left out. There is no cloud involved and
       * never has been -- the export is how a student moves their work, not how Orbis gets it.
       */
      case 'export':
        return {
          exportedAt: at,
          version: 1,
          preferences: await store.prefs.read(),
          orbi: await store.orbi.read(),
          state: await store.state.read(),
          sessions: await store.sessions.all(),
          goals: await store.goals.all(),
          tasks: await store.tasks.all(),
          capsules: await store.capsules.all(),
          spaces: await store.spaces.all(),
          later: await store.distractions.all(),
          thoughts: await store.thoughts.all(),
          reviews: await store.reviews.read(),
          flashcards: await store.flashcards.all(),
          quizzes: await store.attempts.all(),
          mistakes: await store.mistakes.all(),
          confusions: await store.confusions.all(),
          concepts: await store.concepts.all(),
          resources: await store.resources.all(),
          notes: await store.notes.all(),
          boards: await store.boards.all(),
          xp: await store.xp.all()
        }

      case 'flush':
        // Writes now rather than in a moment. Student's files are written a short time after a change, which is
        // right for somebody typing and wrong for anything that needs to know the disk is up to date.
        await service.flush()
        return { ok: true }
      case 'tidy-tabs':
        // Closing is never the default: it only happens when the student asked for it in so many words.
        return service.tidyTabs(text(a, 120) || undefined, { closeAfter: object(b).closeAfter === true })
      case 'snapshot-for':
        return id(a) ? service.snapshotFor(a as string) : null
      case 'hint': {
        const question = object(b)
        return service.hint(text(a, 20) as never, {
          ask: text(question.ask, 500),
          answer: text(question.answer, 2000),
          source: question.source === 'mistake' ? 'mistake' : question.source === 'review' ? 'review' : 'flashcard',
          where: id(question.where)
        })
      }
      case 'attempted': {
        const patch = object(a)
        return service.attempted({
          conceptId: id(patch.conceptId),
          right: patch.right === true,
          rungs: Array.isArray(patch.rungs) ? (strings(patch.rungs, 4, 10) as never) : [],
          sittingId: text(patch.sittingId, 60)
        })
      }
      case 'teach-back': {
        const question = object(a)
        return service.teachBack({ ask: text(question.ask, 500), answer: text(question.answer, 4000), conceptId: id(question.conceptId) })
      }
      case 'taught-back': {
        const patch = object(a)
        return service.taughtBack({
          conceptId: id(patch.conceptId),
          covered: Math.max(0, Math.min(100, num(patch.covered, 0))),
          outOf: Math.max(0, Math.min(100, num(patch.outOf, 0))),
          lookedFirst: patch.lookedFirst === true
        })
      }
      // ---------------------------------------------------------------- what Orion writes
      case 'can-generate':
        // Asked by every screen that offers written help, so "not set up" is never shown as "it broke".
        return { ok: service.canGenerate() }
      case 'quiz-me':
        return id(a) ? service.quizMe(a as string, Math.max(1, Math.min(12, num(b, 6)))) : { ok: false, questions: [], why: 'Which topic?' }
      case 'answered-generated':
        return service.answeredGenerated(id(a), b === true, text(c, 60))
      case 'reject-question':
        return text(a, 200) ? service.rejectQuestion(text(a, 200), id(b)) : { ok: false }
      case 'draft-cards':
        return service.draftCards(text(a, 20_000), {
          subject: id(object(b).subject),
          conceptId: id(object(b).conceptId),
          howMany: Math.max(1, Math.min(20, num(object(b).howMany, 10)))
        })
      case 'keep-drafts':
        return service.keepDrafts(
          Array.isArray(a)
            ? (a as Record<string, unknown>[]).slice(0, 50).map((one) => ({
                front: text(one.front, 1000),
                back: text(one.back, 2000),
                conceptId: id(one.conceptId),
                subject: id(one.subject),
                deck: text(one.deck, 80)
              }))
            : []
        )
      case 'mark-explanation':
        return service.markExplanation({
          about: text(object(a).about, 300),
          points: Array.isArray(object(a).points) ? strings(object(a).points, 12, 300) : [],
          said: text(object(a).said, 4000)
        })
      case 'explain-topic':
        return id(a) ? service.explain(a as string) : { ok: false, why: 'Which topic?' }
      case 'explain-mistake':
        return id(a) ? service.explainMistake(a as string) : { ok: false, why: 'Which mistake?' }
      case 'describe-plan':
        return service.describePlan(Math.max(1, Math.min(30, num(a, 7))))
      case 'propose-structure':
        return service.proposeStructure(text(a, 20_000))

      case 'can-look':
        return { ok: service.canLook() }
      case 'socratic-start':
        return id(a) ? service.socraticStart(a as string) : { ok: false, why: 'Which topic?' }
      case 'socratic-reply': {
        const conversation = object(a)
        if (!conversation.conceptId || !Array.isArray(conversation.turns)) return { ok: false, why: 'That conversation is not one Orbis started.' }
        return service.socraticReply(conversation as never, text(b, 2000))
      }
      case 'socratic-finished': {
        const conversation = object(a)
        if (!conversation.conceptId) return { kind: null, says: '' }
        return service.socraticFinished(conversation as never)
      }
      case 'read-photo':
        // The picture itself, as a data url. Nothing about it is stored.
        return service.readPhoto(typeof a === 'string' ? a : '')

      case 'exam':
        return service.exam(id(a))
      case 'exam-mode':
        // Off is `{ goalId: null }`, and is always one press away.
        return service.setExamMode({ goalId: id(object(a).goalId), quieter: object(a).quieter === undefined ? undefined : object(a).quieter === true, longerSessions: object(a).longerSessions === undefined ? undefined : object(a).longerSessions === true })

      case 'stages':
        return service.stages(text(a, 80))
      case 'subjects-with-stages':
        return service.subjectsWithStages()
      case 'stage-challenge':
        return service.stageChallenge(text(a, 120), text(b, 80))
      case 'stage-done': {
        const challenge = object(a)
        if (!challenge.id || !Array.isArray(challenge.questions)) return { ok: false, why: 'That test is not one Orbis made.' }
        return service.stageDone(challenge as never, Array.isArray(b) ? strings(b, 60, 80) : [], text(c, 120))
      }

      case 'challenge':
        return id(a) ? service.challenge(a as string) : { ready: false, why: 'Which chapter?', need: 0, have: 0 }
      case 'challenge-done': {
        const challenge = object(a)
        if (!challenge.id || !Array.isArray(challenge.questions)) return { ok: false, why: 'That challenge is not one Orbis made.' }
        return service.challengeDone(challenge as never, Array.isArray(b) ? strings(b, 40, 80) : [])
      }
      case 'answered':
        return service.answeredOne(a === true, text(b, 60))
      case 'surprise':
        return service.surprise()
      case 'report':
        // The week or the month, from the records. Nothing modelled.
        return service.report(a === 'month' ? 'month' : 'week')
      case 'quiet-for':
        return service.quietFor(num(a, 60))
      case 'end-quiet':
        await service.endQuiet()
        return { ok: true }

      case 'briefing':
        return service.briefing(a === 'evening' ? 'evening' : 'morning')
      // ---------------------------------------------------------------- the learning brain
      case 'next-best':
        /*
         * The one thing worth doing right now, or nothing.
         *
         * `asked` says the student came looking, which is the difference between answering and intruding: a
         * dashboard may always show its best recommendation, and an unprompted interruption may not.
         */
        return service.nextBest({ asked: a === true, busy: object(b) as never, tabs: Array.isArray(c) ? (c as { url: string; title: string }[]).slice(0, 200) : [] })
      case 'intervention-answered':
        await service.interventionAnswered(text(a, 40), b === 'accepted' ? 'accepted' : 'dismissed')
        return { ok: true }
      case 'appearance':
        // Whether Orbi should turn up by itself. Asked, never assumed.
        return service.appearance(object(a) as never)

      case 'learning':
        return service.learning()
      case 'learned':
        return id(a) ? service.learned(a as string, text(b, 30) as never) : { ok: false, said: 'Which concept?' }
      case 'ready-to':
        return id(a) ? service.readyTo(a as string) : null
      case 'prove-mastery':
        return id(a) ? service.proveMastery(a as string) : null
      case 'topics-in':
        // Found, never added. Ticking is what adds.
        return service.topicsIn(text(a, 60_000))
      case 'add-topics':
        return service.addTopics(text(a, 80), text(b, 120), Array.isArray(c) ? strings(c, 200, 120) : [])
      case 'import-syllabus':
        return service.importSyllabus(text(a, 20_000))
      case 'concepts-with-mastery':
        return store.concepts.all()

      case 'plan':
        return service.plan(Math.max(1, Math.min(60, num(a, 7))))
      case 'set-availability':
        await service.setAvailability(object(a) as never, object(b) as never)
        return { ok: true }
      case 'replan':
        return service.replanFrom(text(a, 10))
      case 'recovery-plan':
        return service.recoveryPlan(text(a, 10))
      case 'short-plan':
        return service.short(num(a, 10))

      case 'mission':
        return id(a) ? service.mission(a as string, num(b, 25)) : null
      case 'micro-mission':
        return service.micro(id(a) ?? undefined)
      case 'mission-step': {
        const mission = object(a)
        if (!mission.id) return { ok: false }
        const out = await service.missionStep(mission as never, text(b, 60), c !== false)
        return { ok: true, ...out }
      }
      case 'smaller-mission': {
        const mission = object(a)
        return mission.id ? service.smallerMission(mission as never) : null
      }

      case 'category-of':
        return categorise(text(a, 2048))

      default:
        return { ok: false, why: `Orbis Student does not know how to "${String(op).slice(0, 40)}".` }
    }
  })
}
