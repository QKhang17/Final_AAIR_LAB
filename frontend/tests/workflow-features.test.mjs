import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { JSDOM } from 'jsdom'

const root = resolve(import.meta.dirname, '../..')
const read = path => readFileSync(resolve(root, path), 'utf8')

test('review comparison distinguishes exact, format, value and missing results', () => {
  const dom = new JSDOM('', { runScripts: 'outside-only' })
  dom.window.eval(read('main/JavaScript/reviewComparison.js'))
  const { classify } = dom.window.AAIR.reviewComparison
  assert.equal(classify('Công ty  ABC', ' công ty ABC '), 'EXACT')
  assert.equal(classify('1.000', '1,000'), 'FORMAT_ONLY')
  assert.equal(classify('1.000', '2.000'), 'VALUE_DIFFERENT')
  assert.equal(classify(null, '1.000'), 'MISSING')
  dom.window.close()
})

test('work timer starts, heartbeats and stops with the requested reason', async () => {
  const dom = new JSDOM('', { url: 'http://localhost/task', runScripts: 'outside-only', pretendToBeVisual: true })
  const w = dom.window
  const calls = []
  const intervals = []
  w.setInterval = callback => { intervals.push(callback); return intervals.length }
  w.clearInterval = () => {}
  w.AAIR = { request: async (path, options) => {
    calls.push({ path, ...options })
    if (path === '/work-time/start') return { id: 17, active_seconds: 0 }
    if (path.endsWith('/heartbeat')) return { id: 17, active_seconds: 30 }
    return { id: 17, active_seconds: 31 }
  } }
  w.eval(read('main/JavaScript/timeTracking.js'))
  const timer = w.AAIR.createWorkTimer({ taskId: 31 })
  await new Promise(resolve => setImmediate(resolve))
  await intervals[0]()
  await timer.stop('SAVE')
  assert.deepEqual(calls.map(call => call.path), [
    '/work-time/start',
    '/work-time/17/heartbeat',
    '/work-time/17/stop',
  ])
  assert.deepEqual(JSON.parse(JSON.stringify(calls[2].json)), { reason: 'SAVE' })
  dom.window.close()
})

test('Analyst and Reviewer open guidelines in a modal without navigation', () => {
  for (const file of [
    'main/HTML/User/ResultAnalysis/Task.html',
    'main/HTML/User/ManualReview/Task.html',
  ]) {
    const dom = new JSDOM(read(file), { url:'http://localhost/task?id=4', runScripts:'outside-only' })
    dom.window.eval(read('main/JavaScript/guidelineModal.js'))
    const before = dom.window.location.href
    assert.equal(dom.window.document.querySelector('a[href*="aair-labeling-guidelines.pdf"]'), null)
    const trigger = dom.window.document.querySelector('[data-guideline-trigger]')
    assert.ok(trigger, `${file} must expose the guideline icon`)
    trigger.click()
    const modal = dom.window.document.querySelector('.guideline-modal')
    assert.equal(modal.hidden, false)
    assert.match(modal.querySelector('iframe').src, /aair-labeling-guidelines\.pdf#page=1&zoom=100$/)
    modal.querySelector('[data-guide-close]').click()
    assert.equal(modal.hidden, true)
    assert.equal(dom.window.location.href, before)
    dom.window.close()
  }
})

test('review UI sends selected source and final value in its API payload', () => {
  const source = read('main/JavaScript/manualReview.js')
  assert.match(source, /selectedSource:choice,finalValue,feedback:null/)
  assert.match(source, /\/review-cases\/\$\{state\.current\.id\}\/fields\//)
})

test('shared completion guard paints document status and blocks incomplete submit', async () => {
  const dom = new JSDOM('<button id="submit">Submit</button><button id="file"></button>', { runScripts:'outside-only' })
  const w = dom.window
  w.eval(read('main/JavaScript/sessionCompletion.js'))
  const guard = w.AAIR.SessionCompletion.create({
    button:w.document.querySelector('#submit'),
    loadStatus:async()=>({allDone:false,documents:[{id:4,name:'Report.pdf',status:'processing'}],missingItems:[{fileName:'Report.pdf',detail:['REVENUE']}]}),
    findItem:()=>w.document.querySelector('#file'),
  })
  await guard.refresh()
  assert.equal(w.document.querySelector('#submit').getAttribute('aria-disabled'),'true')
  assert.equal(w.document.querySelector('#file .session-completion-dot'), null)
  assert.equal(w.document.querySelector('#submit [data-session-completion-help]'), null)
  assert.equal(w.document.querySelector('#submit').getAttribute('aria-describedby'), 'submitCompletionHelp')
  assert.match(w.document.querySelector('#submitCompletionHelp').textContent, /Not all documents are complete/)
  assert.equal(await guard.ensure(),false)
  assert.match(w.document.querySelector('.session-completion-dialog').textContent,/REVENUE/)
  dom.window.close()
})
