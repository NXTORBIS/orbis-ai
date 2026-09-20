import assert from 'node:assert/strict'
import { spawn, type ChildProcess } from 'node:child_process'
import { existsSync, rmSync } from 'node:fs'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import test from 'node:test'
import type { StreamEvent } from '../../shared/types.ts'
import { runBrowserAgent } from '../browserAgent.ts'
import { startChromiumControl, type ChromiumControl } from './service.ts'

/**
 * Orion's browser agent, unchanged, driving real Chromium through the Chromium control service.
 *
 * The only thing scripted here is the model's side of the conversation (a real model is not deterministic, and a test must be). The
 * agent, its tools, the Browser Control Layer, the tab tracking and the browser are all real: the scripted model reads what the agent
 * really returned about the page (the numbered elements) and answers with real tool calls, exactly as a model would.
 */

const CHROME = process.env.ORBIS_CHROMIUM ?? 'C:/chromium/src/out/Default/chrome.exe'
const EXTENSION = resolve(import.meta.dirname, '../../../extension')
const EXTENSION_ID = 'gcaebckmlhiagfagcplpjmibhkhjljab'
const runReal = existsSync(CHROME) && existsSync(join(EXTENSION, 'adblock'))

type Msg = { role: string; content?: string | null; tool_calls?: unknown[] }
const call = (name: string, args: Record<string, unknown>, n: number) => ({ id: `call_${n}`, type: 'function', function: { name, arguments: JSON.stringify(args) } })

test('Orion’s browser agent, unchanged, completes a task on real Chromium', { skip: runReal ? false : 'no Chromium build with the Orbis extension built', timeout: 240_000 }, async (t) => {
  const server = createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://x')
    res.writeHead(200, { 'Content-Type': 'text/html' })
    if (url.pathname === '/results') res.end(`<!doctype html><title>Results</title><h1>Results for ${url.searchParams.get('q')}</h1><p>3 chairs found.</p>`)
    else res.end('<!doctype html><title>Shop</title><h1>Orbis shop</h1><form action="/results"><label>Search products<input name="q" type="text"></label><button type="submit">Go</button></form>')
  })
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`
  const port = 9850 + Math.floor(Math.random() * 40)
  const profile = join(tmpdir(), `orbis-agent-test-${process.pid}`)
  const chrome: ChildProcess = spawn(CHROME, [`--user-data-dir=${profile}`, `--orbis-extension-dir=${EXTENSION}`, `--remote-debugging-port=${port}`, '--no-first-run', '--no-default-browser-check', 'about:blank'], { stdio: 'ignore' })
  let service: ChromiumControl | undefined
  t.after(() => {
    service?.stop()
    chrome.kill()
    server.close()
    setTimeout(() => rmSync(profile, { recursive: true, force: true }), 2500).unref()
  })
  service = await startChromiumControl({ port, extensionId: EXTENSION_ID, waitMs: 60_000 })

  const requests: Msg[][] = []
  let turn = 0
  /** The model's side: what it does next depends on what the agent really told it about the page. */
  const fetchFn = (async (_url: string, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body)) as { messages: Msg[] }
    requests.push(body.messages)
    const lastTool = [...body.messages].reverse().find((m) => m.role === 'tool')?.content ?? ''
    let message: { content: string | null; tool_calls?: unknown[] }
    if (turn === 0) message = { content: null, tool_calls: [call('navigate', { url: `${base}/` }, ++turn)] }
    else if (turn === 1) {
      const ref = /\[(\d+)\] input[^\n]*"Search products"/.exec(String(lastTool))?.[1]
      assert.ok(ref, `the agent told the model about the search field: ${String(lastTool).slice(0, 400)}`)
      message = { content: null, tool_calls: [call('type_text', { ref: Number(ref), text: 'blue chair', submit: true }, ++turn)] }
    } else if (turn === 2) message = { content: null, tool_calls: [call('read_page', {}, ++turn)] }
    else message = { content: `The shop shows: ${/3 chairs found/.test(String(lastTool)) ? '3 chairs found' : 'no results'}.`, tool_calls: undefined }
    return new Response(JSON.stringify({ choices: [{ message }] }), { status: 200, headers: { 'Content-Type': 'application/json' } })
  }) as typeof fetch

  const events: StreamEvent[] = []
  await runBrowserAgent({
    task: 'Search the shop for a blue chair and tell me what it finds.',
    mode: 'once',
    model: 'openai/gpt-oss-120b',
    history: [],
    instructions: [],
    apiKeys: ['test-key'],
    fetchFn,
    signal: new AbortController().signal,
    emit: (e) => events.push(e),
    getTarget: () => service!.agent.getTarget(),
    findPage: (id) => service!.agent.findPage(id),
    windowControl: service.agent.windowControl,
    confirm: async () => true
  })

  await t.test('the agent really used the browser: the tab is where the task ended', async () => {
    const page = await service!.agent.getTarget()
    assert.match(page.getURL(), /\/results\?q=blue\+chair/, page.getURL())
    assert.match(page.getTitle(), /Results/)
  })

  await t.test('the model was told the truth about the page at each step', () => {
    const toolTexts = requests.flatMap((m) => m.filter((x) => x.role === 'tool').map((x) => String(x.content)))
    assert.ok(toolTexts.some((x) => /Orbis shop/.test(x)), 'it read the shop page')
    assert.ok(toolTexts.some((x) => /Results for blue chair/.test(x) || /3 chairs found/.test(x)), 'and then the results page the browser really loaded')
  })

  await t.test('the agent reported what it did, with the answer, and did not fail', () => {
    assert.ok(!events.some((e) => e.type === 'error'), JSON.stringify(events.filter((e) => e.type === 'error')))
    const text = events.filter((e) => e.type === 'delta').map((e) => (e as { content: string }).content).join('')
    assert.match(text, /3 chairs found/)
    assert.ok(events.some((e) => e.type === 'step'), 'the steps were shown')
  })
})
