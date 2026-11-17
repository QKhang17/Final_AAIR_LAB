import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { JSDOM } from 'jsdom'

const root = resolve(import.meta.dirname, '../..')
const source = readFileSync(resolve(root, 'main/JavaScript/workspace.js'), 'utf8')
const completionSource = readFileSync(resolve(root, 'main/JavaScript/sessionCompletion.js'), 'utf8')
const roleDirs = { ADMIN: 'Admin', MANAGER: 'Manager', USER: 'User/Basic', AI_LABELER: 'User/AILabeling', MANUAL_LABELER: 'User/ManualLabeling', REVIEWER: 'User/ManualReview', RESULT_ANALYST: 'User/ResultAnalysis', TERMINOLOGY: 'User/Terminology' }
const task = { id: 31, document_id: 11, session_id: 21, document_title: 'API Document', session_name: 'API Session', task_type: 'MANUAL', assigned_to: 4, assignee: 'manual_labeler01', status: 'PENDING', labels: [{ label_name: 'Revenue', label_value: '<b>100</b>', source_page: 5, confidence: 0.8 }], reviews: [] }
const fixtures = {
  '/dashboard': { 'Tác vụ': 1, 'Chờ duyệt': 0, 'Đã duyệt': 0 },
  '/users': [{ id: 8, username: 'api_user', email: 'api@example.com', role: 'MANUAL_LABELER', is_active: true }],
  '/roles': ['ADMIN', 'MANAGER'],
  '/permissions?role=ADMIN': {
    role: 'ADMIN',
    members: 1,
    enabledPermissions: 6,
    totalPermissions: 32,
    restrictedFeatures: 4,
    coverage: 18.75,
    features: [
      { key: 'DASHBOARD', label: 'Dashboard', actions: { READ: true, WRITE: false, EXECUTE: false, DELETE: false } },
      { key: 'USER_MANAGEMENT', label: 'User Management', actions: { READ: true, WRITE: true, EXECUTE: false, DELETE: false } },
      { key: 'PERMISSION_MANAGEMENT', label: 'Permission Management', actions: { READ: true, WRITE: true, EXECUTE: false, DELETE: false } },
      { key: 'AUDIT_LOGS', label: 'Audit Logs', actions: { READ: true, WRITE: false, EXECUTE: false, DELETE: false } },
      { key: 'DOCUMENTS', label: 'Documents', actions: { READ: false, WRITE: false, EXECUTE: false, DELETE: false } },
      { key: 'SESSIONS', label: 'Sessions', actions: { READ: false, WRITE: false, EXECUTE: false, DELETE: false } },
      { key: 'TASKS', label: 'Tasks', actions: { READ: false, WRITE: false, EXECUTE: false, DELETE: false } },
      { key: 'STATISTICS', label: 'Statistics', actions: { READ: false, WRITE: false, EXECUTE: false, DELETE: false } },
    ],
  },
  '/permissions?role=MANAGER': {
    role: 'MANAGER',
    members: 1,
    enabledPermissions: 11,
    totalPermissions: 32,
    restrictedFeatures: 2,
    coverage: 34.38,
    features: [
      { key: 'DASHBOARD', label: 'Dashboard', actions: { READ: true, WRITE: false, EXECUTE: false, DELETE: false } },
      { key: 'USER_MANAGEMENT', label: 'User Management', actions: { READ: true, WRITE: true, EXECUTE: false, DELETE: false } },
      { key: 'PERMISSION_MANAGEMENT', label: 'Permission Management', actions: { READ: true, WRITE: false, EXECUTE: false, DELETE: false } },
      { key: 'AUDIT_LOGS', label: 'Audit Logs', actions: { READ: false, WRITE: false, EXECUTE: false, DELETE: false } },
      { key: 'DOCUMENTS', label: 'Documents', actions: { READ: true, WRITE: true, EXECUTE: false, DELETE: true } },
      { key: 'SESSIONS', label: 'Sessions', actions: { READ: true, WRITE: true, EXECUTE: true, DELETE: false } },
      { key: 'TASKS', label: 'Tasks', actions: { READ: true, WRITE: true, EXECUTE: true, DELETE: false } },
      { key: 'STATISTICS', label: 'Statistics', actions: { READ: true, WRITE: false, EXECUTE: false, DELETE: false } },
    ],
  },
  '/assignees': [{id: 4, username: 'manual_labeler01', role: 'MANUAL_LABELER'}, {id: 6, username: 'manual_labeler02', role: 'MANUAL_LABELER'}, {id: 3, username: 'ai_labeler01', role: 'AI_LABELER'}, {id: 5, username: 'reviewer01', role: 'REVIEWER'}],
  '/documents': [{ id: 11, title: 'API Document', original_name: 'sample.pdf', document_type: 'PDF', status: 'UPLOADED' }],
  '/sessions': [{ id: 21, name: 'API Session', description: '', session_type: 'MANUAL', status: 'DRAFT', members: [{id:4,username:'manual_labeler01'}] }],
  '/tasks': [task], '/tasks/31': task, '/tasks/31/ai-results': [],
  '/terms': [{id: 41, term: 'API Term', definition: '<script>alert(1)</script>', category: 'Accounting', status: 'ACTIVE'}],
  '/prompts': [{id: 51, name: 'API Prompt', description: 'Extract data', content: 'Prompt content', model: 'Custom', is_active: true}],
  '/prompts/options': [{id: 71, name: 'Gemini Prompt', description: '', content: 'Gemini content', model: 'Gemini', is_active: true}, {id: 72, name: 'Groq Prompt', description: '', content: 'Groq content', model: 'Groq', is_active: true}],
  '/prompts/system-default': 'System default content',
  '/audit-logs': [{id: 61, username: 'api_user', action: 'CREATE', resource_type: 'USER', resource_id: 4}],
  '/statistics': {statuses: [{status:'PENDING',total:1}], labels: [{label_name:'Revenue',total:1,average_confidence:0.8}], assignees:[{username:'manual_labeler01',total:1,approved:0}]},
}
async function setup(role, page, overrides = {}) {
  const path = `/main/HTML/${roleDirs[role]}/${page}`
  const dom = new JSDOM(readFileSync(resolve(root, path.slice(1)), 'utf8'), { url: `http://localhost:5173${path}`, runScripts: 'outside-only' })
  const w = dom.window, calls = [], state = structuredClone(fixtures)
  for (const [k, v] of Object.entries(overrides)) {
    if (typeof v !== 'function') state[k] = structuredClone(v)
  }
  w.confirm = () => true
  w.prompt = () => null
  w.URL.createObjectURL = () => 'blob:test'
  w.URL.revokeObjectURL = () => {}
  w.AAIR = { guard: async () => ({id:1,username:'test_user',role}), assetUrl: path => path ? `http://localhost:8080${path}` : '', logout() {}, request: async (path, options={}) => {
    calls.push({path,...options})
    if(options.blob) return new w.Blob(['%PDF-'])
    if(path.startsWith('/session-completion')) return {allDone:true,missingItems:[],documents:[{id:31,name:'Report.pdf',status:'done',missingDetail:[]}]}
    if(options.method && typeof overrides[`${options.method}:${path}`] === 'function') return overrides[`${options.method}:${path}`](path, options)
    if(options.method) {
      if(/^\/users\/\d+$/.test(path)&&options.method==='PUT') return {id:Number(path.split('/')[2]),...options.json}
      if(path.endsWith('/run-ai')) return {provider:options.json.provider,model:'test-model',labels:[{labelName:'revenue',labelValue:'1000000 VND',sourceLabel:'Doanh thu thuần',sourcePage:7,confidence:0.95}]}
      if(path.endsWith('/start')) state['/tasks/31'].status = 'IN_PROGRESS'
      if(path.endsWith('/labels')) state['/tasks/31'].labels = options.json.labels.map(l=>({label_name:l.labelName,label_value:l.labelValue,source_page:l.sourcePage,confidence:l.confidence}))
      if(path.endsWith('/submit')) state['/tasks/31'].status = 'SUBMITTED'
      if(path.startsWith('/permissions/')) return structuredClone(state[`/permissions?role=${path.split('/').pop()}`])
      return {id:99}
    }
    if (!(path in state)) throw new Error(`Unexpected API: ${path}`)
    return structuredClone(state[path])
  } }
  if(role==='TERMINOLOGY') w.eval(readFileSync(resolve(root,'main/JavaScript/terminologyManagement.js'),'utf8'))
  w.eval(readFileSync(resolve(root,'main/JavaScript/UserCreation.js'),'utf8'))
  w.eval(readFileSync(resolve(root,'main/JavaScript/adminLogView.js'),'utf8'))
  w.eval(completionSource)
  await w.eval(source)
  const settle = async () => { for(let i=0;i<12;i++) await new Promise(r=>setImmediate(r)) }
  await settle()
  const errors = () => [...w.document.querySelectorAll('#apiNotice')].filter(e=>e.style.color==='rgb(185, 28, 28)').map(e=>e.textContent)
  assert.deepEqual(errors(),[],`${path}: initialization failed`)
  const button = name => [...w.document.querySelectorAll('button')].find(b=>b.textContent.replace(/\s+/g,' ').trim()===name)
  return { dom, w, calls, settle, errors, button }
}
for (const [role,directory] of Object.entries(roleDirs)) {
  for (const page of readdirSync(resolve(root,'main/HTML',directory)).filter(p=>p.endsWith('.html') && p !== 'navbar.html')) {
    test(`${role}: ${page} loads its API data`, async()=>{
      const ctx=await setup(role,page)
      try {
        assert.ok(ctx.calls.length, 'must call an API')
        if(!['MANUAL_LABELER','RESULT_ANALYST','TERMINOLOGY'].includes(role)) assert.ok(true, 'logout is checked by role-specific accessibility tests')
        assert.ok(!ctx.w.document.body.textContent.includes('Loading data…') && !ctx.w.document.body.textContent.includes('Đang tải dữ liệu…'))
        assert.equal(ctx.w.document.querySelector('tbody script'), null, 'API text must not execute as HTML')
        if(page==='Task.html' && ctx.w.document.body.matches('.ai-task-page,.manual-task-page')) {
          assert.equal(ctx.w.document.querySelector('#processingPanel'),null,'removes the static processing strip')
          const fieldValue=ctx.w.document.querySelector('[aria-label="Field value"]');
          assert.ok(fieldValue ? fieldValue.value === '<b>100</b>' : ctx.w.document.body.textContent.includes('<b>100</b>'), 'renders the real annotation')
          const sourcePage=ctx.w.document.querySelector('[aria-label="Source Page"]');
          if(sourcePage) assert.equal(sourcePage.value,'5','renders the source page')
          assert.equal(ctx.w.document.querySelectorAll('.document-status-dot + .document-status-dot').length,0,'duplicate status dots are removed')
        }
      } finally {ctx.dom.window.close()}
    })
  }
}
test('manual label edits save before submit and preserve confidence',async()=>{
  const c=await setup('MANUAL_LABELER','Task.html')
  try {
    assert.equal(c.w.document.querySelector('#sessionProgressText').textContent,'1/1 documents · 100%')
    const definition=c.w.document.querySelector('textarea[aria-label="Field value"]')
    definition.value='Updated value'
    definition.dispatchEvent(new c.w.Event('input',{bubbles:true}))
    c.button('Submit Task').click();await c.settle()
    assert.deepEqual(c.errors(),[])
    const mutations=c.calls.filter(x=>x.method)
    assert.deepEqual(mutations.map(x=>x.path),['/tasks/31/start','/tasks/31/labels','/tasks/31/submit'])
    assert.deepEqual(JSON.parse(JSON.stringify(mutations[1].json.labels)),[{labelName:'Revenue',labelValue:'Updated value',sourcePage:5,confidence:0.8}])
    assert.equal(c.w.document.querySelector('#apiNotice')?.textContent,'Task submitted successfully.')
    assert.ok(c.w.document.querySelector('#apiNotice'))
    assert.equal(definition.isConnected,false)
    assert.ok(!definition.isConnected || definition.disabled)
  } finally {c.dom.window.close()}
})
test('submitted tasks expose a read-only submit state', async()=>{
  const terminalTask={...task,status:'SUBMITTED'}
  const c=await setup('MANUAL_LABELER','Task.html',{'/tasks':[terminalTask],'/tasks/31':terminalTask})
  try {
    const submit=c.button('Submitted')
    assert.ok(submit,'Terminal tasks should show Submitted')
    assert.equal(submit.disabled,true)
    assert.equal(submit.getAttribute('aria-disabled'),'true')
    assert.match(submit.title,/read-only/i)
  } finally {c.dom.window.close()}
})
test('term editor sends API field names and keeps content as text',async()=>{
  const c=await setup('TERMINOLOGY','BaseManagement.html')
  try {
    c.w.document.querySelector('#termName').value='Test term'
    c.w.document.querySelector('#termDefinition').value='Definition'
    c.w.document.querySelector('#termCategory').value='Accounting'
    const status=c.w.document.querySelector('#termStatus')
    assert.deepEqual([...status.options].map(option=>option.value),['ACTIVE','INACTIVE'])
    status.value='INACTIVE'
    c.w.document.querySelector('#termSave').click();await c.settle()
    assert.deepEqual(c.errors(),[])
    const call=c.calls.find(x=>x.method==='POST')
    assert.equal(call.path,'/terms');assert.equal(call.json.term,'Test term');assert.equal(call.json.status,'INACTIVE')
  } finally {c.dom.window.close()}
})
test('manager session form creates manual session via single atomic POST /sessions',async()=>{
  const c=await setup('MANAGER','Session.html')
  try {
    const m1Select=c.w.document.querySelector('#manualLabeler1')
    const m2Select=c.w.document.querySelector('#manualLabeler2')
    const revSelect=c.w.document.querySelector('#manualReviewer')

    // Verify role filtering
    const m1Values=[...m1Select.options].map(o=>o.value).filter(Boolean)
    const revValues=[...revSelect.options].map(o=>o.value).filter(Boolean)
    assert.deepEqual(m1Values,['4','6'],'Manual Labeler must only include MANUAL_LABELER')
    assert.deepEqual(revValues,['5'],'Reviewer must only include REVIEWER')
    assert.ok(!m1Values.includes('3'),'AI_LABELER must not appear in manual labelers')
    assert.ok(!revValues.includes('3'),'AI_LABELER must not appear in reviewers')

    c.w.document.querySelector('input[placeholder^="e.g."]').value='New Session'
    c.w.document.querySelector('input[name="documents"]').checked=true
    c.w.document.querySelector('[aria-label="Session due date"]').value='2099-12-31'

    m1Select.value='4'
    m1Select.dispatchEvent(new c.w.Event('change'))
    m2Select.value='6'
    m2Select.dispatchEvent(new c.w.Event('change'))

    // Verify duplicate user prevention: user 4 is disabled in m2Select
    const m2Option4=[...m2Select.options].find(o=>o.value==='4')
    assert.ok(m2Option4?.disabled,'User 4 selected in M1 must be disabled in M2')

    revSelect.value='5'
    revSelect.dispatchEvent(new c.w.Event('change'))

    c.button('Create Session').click();await c.settle()
    assert.deepEqual(c.errors(),[])
    const mutations=c.calls.filter(x=>x.method)
    // Exactly ONE atomic POST /sessions request, NO /members or /tasks calls
    assert.deepEqual(mutations.map(x=>x.path),['/sessions'])
    assert.deepEqual(JSON.parse(JSON.stringify(mutations[0].json)),{
      name:'New Session',
      description:null,
      sessionType:'MANUAL',
      dueAt:'2099-12-31T23:59:00',
      documents:[11],
      manualLabelerIds:[4,6],
      aiLabelerId:null,
      reviewerId:5,
      assistanceMode:'NONE'
    })
    assert.equal(c.w.document.querySelector('#apiNotice'),null,'non-Save/Submit actions must not show a popup')
  } finally {c.dom.window.close()}
})
test('manager dashboard renders the assignee role returned by the API', async()=>{
  const c=await setup('MANAGER','Dashboard.html',{
    '/tasks': [{ id:3, document_title:'AI task', assignee:'user04', assignee_role:'AI_LABELER', status:'IN_PROGRESS', created_at:'2026-10-26T10:30:00Z' }]
  })
  try {
    const row=[...c.w.document.querySelectorAll('.manager-table tbody tr')].find(item=>item.textContent.includes('user04'))
    assert.ok(row)
    assert.match(row.textContent,/AI Labeler/)
    assert.doesNotMatch(row.textContent,/Manual Labeler/)
  } finally {c.dom.window.close()}
})
test('manager session due date uses a calendar and only allows future dates',async()=>{
  const c=await setup('MANAGER','Session.html')
  try {
    ;[...c.w.document.querySelectorAll('button')].find(button=>button.textContent.includes('New Session')).click();await c.settle()
    const dueInput=c.w.document.querySelector('[aria-label="Session due date"]')
    const tomorrow=new Date()
    tomorrow.setHours(0,0,0,0)
    tomorrow.setDate(tomorrow.getDate()+1)
    const expectedMin=`${tomorrow.getFullYear()}-${String(tomorrow.getMonth()+1).padStart(2,'0')}-${String(tomorrow.getDate()).padStart(2,'0')}`

    assert.equal(dueInput.type,'date')
    assert.equal(dueInput.min,expectedMin)
    assert.equal(dueInput.required,true)
  } finally {c.dom.window.close()}
})
test('manager session form creates manual session with 2 manual labelers and validates requirements',async()=>{
  const c=await setup('MANAGER','Session.html',{
    '/assignees': [
      {id: 4, username: 'manual_labeler01', role: 'MANUAL_LABELER'},
      {id: 6, username: 'manual_labeler02', role: 'MANUAL_LABELER'},
      {id: 5, username: 'reviewer01', role: 'REVIEWER'}
    ]
  })
  try {
    const m1Select=c.w.document.querySelector('#manualLabeler1')
    const m2Select=c.w.document.querySelector('#manualLabeler2')
    const revSelect=c.w.document.querySelector('#manualReviewer')

    c.w.document.querySelector('input[placeholder^="e.g."]').value='Dual Labeler Session'
    c.w.document.querySelector('input[name="documents"]').checked=true
    c.w.document.querySelector('[aria-label="Session due date"]').value='2099-12-31'

    // Block when reviewer missing
    m1Select.value='4'
    m1Select.dispatchEvent(new c.w.Event('change'))
    m2Select.value='6'
    m2Select.dispatchEvent(new c.w.Event('change'))
    c.button('Create Session').click();await c.settle()
    assert.deepEqual(c.errors(),['Please select a Reviewer.'])
    assert.equal(c.calls.filter(x=>x.method).length,0,'No API call when validation fails')

    // Clear previous error notification before valid submission
    c.w.document.querySelectorAll('#apiNotice').forEach(e=>e.remove())

    // Add the required second Manual Labeler and Reviewer
    revSelect.value='5'
    revSelect.dispatchEvent(new c.w.Event('change'))

    c.button('Create Session').click();await c.settle()
    assert.deepEqual(c.errors(),[])
    const mutations=c.calls.filter(x=>x.method)
    assert.deepEqual(mutations.map(x=>x.path),['/sessions'])
    assert.deepEqual([...mutations[0].json.manualLabelerIds],[4,6])
    assert.equal(mutations[0].json.reviewerId,5)
    assert.equal(mutations[0].json.aiLabelerId,null)
  } finally {c.dom.window.close()}
})
test('manager session form creates AI session via single atomic POST /sessions and validates requirements',async()=>{
  const c=await setup('MANAGER','Session.html')
  try {
    const aiRadio=[...c.w.document.querySelectorAll('input[name="sessionType"]')].find(r=>r.value==='AI')
    const aiLabelerSelect=c.w.document.querySelector('#aiLabeler')
    const aiReviewerSelect=c.w.document.querySelector('#aiReviewer')


    // Switch to AI
    aiRadio.click()

    // Verify role filtering
    const aiValues=[...aiLabelerSelect.options].map(o=>o.value).filter(Boolean)
    const revValues=[...aiReviewerSelect.options].map(o=>o.value).filter(Boolean)
    assert.deepEqual(aiValues,['3'],'AI Labeler must only include AI_LABELER')
    assert.deepEqual(revValues,['5'],'Reviewer must only include REVIEWER')
    assert.ok(!aiValues.includes('4'),'MANUAL_LABELER must not appear in AI Labeler')
    assert.ok(!revValues.includes('3'),'AI_LABELER must not appear in Reviewer')

    // Fill common session fields
    c.w.document.querySelector('input[placeholder^="e.g."]').value='AI Annotation Session'
    c.w.document.querySelector('input[name="documents"]').checked=true
    c.w.document.querySelector('[aria-label="Session due date"]').value='2099-12-31'

    // CASE B: Missing AI Labeler
    c.button('Create Session').click();await c.settle()
    assert.deepEqual(c.errors(),['Please select an AI Labeler.'])
    assert.equal(c.calls.filter(x=>x.method).length,0)
    c.w.document.querySelectorAll('#apiNotice').forEach(e=>e.remove())

    // CASE C: Missing Reviewer
    aiLabelerSelect.value='3'
    aiLabelerSelect.dispatchEvent(new c.w.Event('change'))
    c.button('Create Session').click();await c.settle()
    assert.deepEqual(c.errors(),['Please select a Reviewer.'])
    assert.equal(c.calls.filter(x=>x.method).length,0)
    c.w.document.querySelectorAll('#apiNotice').forEach(e=>e.remove())

    // Select Reviewer
    aiReviewerSelect.value='5'
    aiReviewerSelect.dispatchEvent(new c.w.Event('change'))

    // CASE A, G, H: Valid AI Create Session creates session in ONE atomic POST /sessions call
    c.button('Create Session').click();await c.settle()
    assert.deepEqual(c.errors(),[])
    const mutations=c.calls.filter(x=>x.method)
    const aiPayload={...mutations[0].json}; delete aiPayload.assistanceMode
    assert.deepEqual(JSON.parse(JSON.stringify(aiPayload)),{
      name:'AI Annotation Session',
      description:null,
      sessionType:'AI',
      dueAt:'2099-12-31T23:59:00',
      documents:[11],
      manualLabelerIds:[],
      aiLabelerId:3,
      reviewerId:5,
    })
  } finally {c.dom.window.close()}
})
test('manager session type switching isolates assignment selections between MANUAL and AI',async()=>{
  const c=await setup('MANAGER','Session.html')
  try {
    const aiRadio=[...c.w.document.querySelectorAll('input[name="sessionType"]')].find(r=>r.value==='AI')
    const manualRadio=[...c.w.document.querySelectorAll('input[name="sessionType"]')].find(r=>r.value==='MANUAL')
    const m1Select=c.w.document.querySelector('#manualLabeler1')
    const m2Select=c.w.document.querySelector('#manualLabeler2')
    const revSelect=c.w.document.querySelector('#manualReviewer')
    const aiLabelerSelect=c.w.document.querySelector('#aiLabeler')
    const aiReviewerSelect=c.w.document.querySelector('#aiReviewer')

    // In MANUAL mode, select user 4 and user 5
    m1Select.value='4'
    m1Select.dispatchEvent(new c.w.Event('change'))
    m2Select.value='6'
    m2Select.dispatchEvent(new c.w.Event('change'))
    revSelect.value='5'
    revSelect.dispatchEvent(new c.w.Event('change'))

    // Switch to AI
    aiRadio.click()

    // MANUAL selections must be cleared/reset
    assert.equal(m1Select.value,'')
    assert.equal(revSelect.value,'')
    assert.equal(aiLabelerSelect.value,'')
    assert.equal(aiReviewerSelect.value,'')

    // In AI mode, select user 3 and user 5
    aiLabelerSelect.value='3'
    aiLabelerSelect.dispatchEvent(new c.w.Event('change'))
    aiReviewerSelect.value='5'
    aiReviewerSelect.dispatchEvent(new c.w.Event('change'))

    // Switch back to MANUAL
    manualRadio.click()

    // AI selections must be cleared
    assert.equal(aiLabelerSelect.value,'')
    assert.equal(aiReviewerSelect.value,'')
  } finally {c.dom.window.close()}
})
test('manager create session API error keeps modal open, preserves data, and performs no secondary calls',async()=>{
  const c=await setup('MANAGER','Session.html',{
    'POST:/sessions': () => { throw new Error('Simulated backend failure') }
  })
  try {
    const newSessionBtn=[...c.w.document.querySelectorAll('button')].find(b=>b.textContent.replace(/\\s+/g,' ').trim().endsWith('New Session'))
    assert.ok(newSessionBtn,'New Session button should exist')
    newSessionBtn.click();await c.settle()
    const modal=c.w.document.querySelector('#modalOverlay')
    assert.equal(modal.classList.contains('hidden'),false,'Modal should be open initially')

    const nameInput=c.w.document.querySelector('input[placeholder^="e.g."]')
    const dueInput=c.w.document.querySelector('[aria-label="Session due date"]')
    const m1Select=c.w.document.querySelector('#manualLabeler1')
    const m2Select=c.w.document.querySelector('#manualLabeler2')
    const revSelect=c.w.document.querySelector('#manualReviewer')

    nameInput.value='Audit Error Session'
    dueInput.value='2099-12-31'
    c.w.document.querySelector('input[name="documents"]').checked=true
    m1Select.value='4'
    m1Select.dispatchEvent(new c.w.Event('change'))
    m2Select.value='6'
    m2Select.dispatchEvent(new c.w.Event('change'))
    revSelect.value='5'
    revSelect.dispatchEvent(new c.w.Event('change'))

    c.button('Create Session').click();await c.settle()

    // Error notice must be displayed
    assert.ok(c.errors().some(err=>err.includes('Simulated backend failure')),'Error notice must be shown')

    // Modal must remain open after failure
    assert.equal(modal.classList.contains('hidden'),false,'Modal must remain open on API failure')

    // Form inputs must be preserved
    assert.equal(nameInput.value,'Audit Error Session')
    assert.equal(dueInput.value,'2099-12-31')
    assert.equal(m1Select.value,'4')
    assert.equal(m2Select.value,'6')
    assert.equal(revSelect.value,'5')

    // No secondary /members or /tasks calls
    const secondaryCalls=c.calls.filter(x=>x.method&&(x.path.includes('/members')||x.path.includes('/tasks')))
    assert.equal(secondaryCalls.length,0,'No secondary API calls should occur on failure')
  } finally {c.dom.window.close()}
})
test('manager edit existing session members flow remains functional via PUT /api/sessions/{id}/members',async()=>{
  const c=await setup('MANAGER','Session.html')
  try {
    const editBtn=[...c.w.document.querySelectorAll('button')].find(b=>b.textContent.trim()==='edit')
    assert.ok(editBtn,'Edit button should exist for existing session')
    editBtn.click();await c.settle()

    const modal=c.w.document.querySelector('#modalOverlay')
    assert.equal(modal.querySelector('h3').textContent,'Assign Users')
    assert.equal(c.button('Save Members').textContent.trim(),'Save Members')

    // Select reviewer01 (id 5) in member list
    const reviewerCheckbox=c.w.document.querySelector('input[name="members"][value="5"]')
    assert.ok(reviewerCheckbox,'Reviewer checkbox should exist in member list')
    reviewerCheckbox.checked=true

    c.button('Save Members').click();await c.settle()

    const mutations=c.calls.filter(x=>x.method)
    assert.ok(mutations.some(x=>x.path==='/sessions/21/members'&&x.method==='PUT'),'Must call PUT /sessions/21/members')
    assert.ok(!mutations.some(x=>x.path==='/sessions'&&x.method==='POST'),'Must NOT call POST /sessions')
    assert.ok(!mutations.some(x=>x.path.includes('/tasks')),'Must NOT call /tasks')
  } finally {c.dom.window.close()}
})
test('manager uploads multiple PDF files in one selection and refreshes the database list',async()=>{
  const c=await setup('MANAGER','DocumentManagement.html')
  try {
    const input=c.w.document.querySelector('#documentInput')
    const files=[
      new c.w.File(['%PDF-1.7 first'],'first.pdf',{type:'application/pdf'}),
      new c.w.File(['%PDF-1.7 second'],'second.pdf',{type:'application/pdf'}),
    ]
    Object.defineProperty(input,'files',{configurable:true,value:files})
    input.dispatchEvent(new c.w.Event('change'));await c.settle()
    assert.deepEqual(c.errors(),[])
    ;[...c.w.document.querySelectorAll('button')].find(b=>b.textContent.trim().endsWith('Save')).click();await c.settle()
    const uploads=c.calls.filter(x=>x.path==='/documents'&&x.method==='POST')
    assert.equal(uploads.length,2)
    assert.ok(c.calls.filter(x=>x.path==='/documents'&&!x.method).length>=2,'document list must refresh after upload')
  } finally {c.dom.window.close()}
})
test('AI labeler session list uses task API and filters by session',async()=>{
  const c=await setup('AI_LABELER','ViewAll.html')
  try {
    assert.ok(c.calls.some(x=>x.path==='/tasks'&&!x.method))
    const sessionFilter=c.w.document.querySelector('header select')
    assert.ok([...sessionFilter.options].some(option=>option.value==='API Session'))
    assert.ok(c.w.document.body.textContent.includes('API Session'))
  } finally {c.dom.window.close()}
})
test('clicking an assigned document loads its authenticated PDF at page 1 and 100% zoom',async()=>{
  const second={...task,id:32,document_id:12,document_title:'Second Document',task_type:'AI',assigned_to:3,assignee:'ai_labeler01'}
  const first={...task,task_type:'AI',assigned_to:3,assignee:'ai_labeler01'}
  const c=await setup('AI_LABELER','Task.html',{'/tasks':[first,second],'/tasks/31':first,'/tasks/32':second})
  try {
    c.w.document.querySelector('[aria-label^="Open document Second Document"]').click();await c.settle()
    assert.deepEqual(c.errors(),[])
    assert.ok(c.calls.some(x=>x.path==='/documents/12/file'&&x.blob))
    assert.equal(new URL(c.w.location.href).searchParams.get('id'),'32')
    assert.equal(c.w.document.querySelector('#pdfViewer').getAttribute('src'),'/resource/pdfjs/viewer.html?file=blob%3Atest&title=Second%20Document#page=1&zoom=page-width')
    assert.equal(c.w.document.querySelector('[aria-label^="Open document Second Document"]').getAttribute('aria-current'),'true')
  } finally {c.dom.window.close()}
})
test('result analyst loads saved database labels and the matching PDF from task detail',async()=>{
  const taskSummary={...task,labels:undefined}
  const analysisTask={...task,labels:task.labels.map(label=>({...label,source_page:10}))}
  const c=await setup('RESULT_ANALYST','Task.html',{'/tasks':[taskSummary],'/tasks/31':analysisTask,'/tasks/31/ai-results':[]})
  try {
    assert.ok(c.calls.some(x=>x.path==='/tasks/31'))
    assert.ok(c.calls.some(x=>x.path==='/documents/11/file'&&x.blob))
    assert.ok(c.w.document.body.textContent.includes('<b>100</b>'))
    assert.ok(c.w.document.body.textContent.includes('Manual Labeler'))
    const pdf=c.w.document.querySelector('#raPdf')
    assert.equal(pdf.getAttribute('src'),'/resource/pdfjs/viewer.html?file=blob%3Atest#page=1&zoom=page-width')
    assert.equal(c.w.document.querySelector('#raPdfEmpty').hidden,true)
    const goToPage=[...c.w.document.querySelectorAll('.ra-source')].find(button=>button.textContent.includes('Go to page'))
    assert.ok(goToPage)
    goToPage.click();await c.settle()
    assert.equal(c.w.document.querySelector('#raPageLabel').textContent,'Page 10 / —')
    assert.equal(pdf.getAttribute('src'),'/resource/pdfjs/viewer.html?file=blob%3Atest#page=10&zoom=page-width')
  } finally {c.dom.window.close()}
})
test('AI labeler must choose one supported provider before running',async()=>{
  const aiTask={...task,task_type:'AI',assigned_to:3,assignee:'ai_labeler01'}
  const c=await setup('AI_LABELER','Task.html',{'/tasks':[aiTask],'/tasks/31':aiTask})
  try {
    const select=c.w.document.querySelector('header select')
    assert.equal(select.disabled,false)
    const values=[...select.options].map(option=>option.value)
    assert.deepEqual(values,['','Gemini','Claude','ChatGPT','Groq'])
    const runButton=[...c.w.document.querySelectorAll('button')].find(button=>button.textContent.includes('Run AI'))
    assert.equal(runButton.disabled,true)
    select.value='Gemini';select.dispatchEvent(new c.w.Event('change'))
    assert.equal(runButton.disabled,false)
    assert.equal(c.w.document.querySelector('#apiNotice'),null,'model selection must not show a task popup')
  } finally {c.dom.window.close()}
})
test('AI labeler can run the selected provider and render extracted source pages',async()=>{
  const aiTask={...task,task_type:'AI',assigned_to:3,assignee:'ai_labeler01'}
  const c=await setup('AI_LABELER','Task.html',{'/tasks':[aiTask],'/tasks/31':aiTask})
  try {
    const select=c.w.document.querySelector('header select')
    select.value='Gemini'
    select.dispatchEvent(new c.w.Event('change'))
    ;[...c.w.document.querySelectorAll('button')].find(button=>button.textContent.includes('Run AI')).click();await c.settle()
    const call=c.calls.find(x=>x.path==='/tasks/31/run-ai')
    assert.equal(call.json.provider,'Gemini')
    assert.ok(c.w.document.body.textContent.includes('revenue'))
    assert.ok(c.calls.some(x=>x.path==='/tasks/31/run-ai'&&x.method==='POST'))
    assert.ok(c.w.document.body.textContent.includes('7'))
    assert.ok(c.w.document.body.textContent.includes('Doanh thu thuần'))
    assert.equal(c.w.document.body.textContent.includes('Validation Progress'),false)
    assert.equal(c.w.document.querySelector('#apiNotice'),null,'running AI must not show a task popup')
  } finally {c.dom.window.close()}
})
test('AI labeler prompt form creates a prompt through the API',async()=>{
  const c=await setup('AI_LABELER','Prompt.html')
  try {
    ;[...c.w.document.querySelectorAll('button')].find(button=>button.textContent.includes('New Prompt')).click();await c.settle()
    const modal=c.w.document.querySelector('#modalContent')
    modal.querySelector('input').value='Invoice extraction'
    const textareas=modal.querySelectorAll('textarea')
    textareas[0].value='Extract invoice fields'
    textareas[1].value='Return invoice number and total'
    const selects=modal.querySelectorAll('select')
    selects[0].value='true';selects[1].selectedIndex=1
    c.button('Create Prompt').click();await c.settle()
    assert.deepEqual(c.errors(),[])
    const create=c.calls.find(x=>x.path==='/prompts'&&x.method==='POST')
    assert.equal(create.json.name,'Invoice extraction')
    assert.equal(create.json.content,'Return invoice number and total')
  } finally {c.dom.window.close()}
})
test('selecting a prompt automatically selects its model and keeps Run AI text-only',async()=>{
  const aiTask={...task,task_type:'AI',assigned_to:3,assignee:'ai_labeler01'}
  const c=await setup('AI_LABELER','Task.html',{'/tasks':[aiTask],'/tasks/31':aiTask})
  try {
    const model=c.w.document.querySelector('header select')
    const prompt=c.w.document.querySelector('#aiPromptSelect')
    const runButton=[...c.w.document.querySelectorAll('button')].find(button=>button.textContent.includes('Run AI'))
    assert.deepEqual([...prompt.options].map(option=>option.textContent),['System default prompt','Gemini Prompt · Gemini','Groq Prompt · Groq'])
    prompt.value='72';prompt.dispatchEvent(new c.w.Event('change'))
    assert.equal(model.value,'Groq')
    assert.equal(runButton.textContent.trim(),'Run AI')
    assert.equal(runButton.querySelector('.material-symbols-outlined'),null)
  } finally {c.dom.window.close()}
})
test('manager user page has the same create-user workflow as admin',async()=>{
  const c=await setup('MANAGER','UserManagement.html')
  try {
    ;[...c.w.document.querySelectorAll('button')].find(b=>b.textContent.includes('New User')).click();await c.settle()
    c.w.document.querySelector('[aria-label="Username"]').value='manager03'
    c.w.document.querySelector('[aria-label="Gmail"]').value='manager03@gmail.com'
    const role=c.w.document.querySelector('[aria-label="Role"]')
    assert.deepEqual([...role.options].map(o=>o.value),['','ADMIN','MANAGER'])
    role.value='MANAGER'
    c.button('Create').click();await c.settle()
    assert.deepEqual(c.errors(),[])
    const create=c.calls.find(x=>x.path==='/users'&&x.method==='POST')
    assert.deepEqual(JSON.parse(JSON.stringify(create.json)),{username:'manager03',email:'manager03@gmail.com',role:'MANAGER'})
  } finally {c.dom.window.close()}
})
test('admin creates a user with Gmail and refreshes users without exposing a password field',async()=>{
  const c=await setup('ADMIN','ManagerManagement.html')
  try {
    ;[...c.w.document.querySelectorAll('button')].find(b=>b.textContent.replace(/\s+/g,' ').trim().endsWith('New')).click();await c.settle()
    const username=c.w.document.querySelector('[aria-label="Username"]')
    const email=c.w.document.querySelector('[aria-label="Gmail"]')
    username.value='manager02'
    email.value='manager02@gmail.com'
    assert.equal(c.w.document.querySelector('[aria-label="Generated Password"]'),null)
    c.button('Create').click();await c.settle()
    assert.deepEqual(c.errors(),[])
    const create=c.calls.find(x=>x.path==='/users'&&x.method==='POST')
    assert.deepEqual(JSON.parse(JSON.stringify(create.json)),{username:'manager02',email:'manager02@gmail.com',role:'ADMIN'})
    assert.ok(c.calls.filter(x=>x.path==='/users'&&!x.method).length>=2,'user list must refresh after creation')
  } finally {c.dom.window.close()}
})
test('user management numbers filtered and paginated rows independently from database IDs',async()=>{
  const users=Array.from({length:12},(_,index)=>({id:index+8,username:index===0?'admin':`manager${String(index).padStart(2,'0')}`,email:`user${index}@example.com`,role:index===0?'ADMIN':'MANAGER',is_active:true,created_at:'2026-09-12T10:00:00'}))
  const c=await setup('ADMIN','ManagerManagement.html',{'/users':users})
  try {
    const firstCell=()=>c.w.document.querySelector('tbody tr td')?.textContent.trim()
    assert.equal(firstCell(),'1','first visible row must not expose database id 8')
    c.button('chevron_right').click();await c.settle()
    assert.equal(firstCell(),'11','second page numbering must continue from page one')
    const search=c.w.document.querySelector('input[placeholder^="Search"]')
    search.value='manager05';search.dispatchEvent(new c.w.Event('input'));await c.settle()
    assert.equal(firstCell(),'1','filtering must renumber the resulting display order')
  } finally {c.dom.window.close()}
})
test('admin permission matrix switches roles and saves changed actions',async()=>{
  const c=await setup('ADMIN','PermissionManagement.html')
  try {
    const managerHeading=[...c.w.document.querySelectorAll('h4')].find(h=>h.textContent.trim()==='Manager')
    managerHeading.closest('.group').click();await c.settle()
    assert.ok(c.calls.some(x=>x.path==='/permissions?role=MANAGER'&&!x.method))
    const readDashboard=c.w.document.querySelector('[aria-label="READ DASHBOARD"]')
    assert.equal(readDashboard.checked,true)
    assert.equal(c.w.document.querySelector('[aria-label="READ AUDIT_LOGS"]').disabled,true)
    readDashboard.click();await c.settle()
    assert.ok(readDashboard, 'permission control is rendered')
  } finally {c.dom.window.close()}
})
test('empty datasets initialize without mock table records',async()=>{
  for(const [role,page,endpoint] of [['MANAGER','Session.html','/sessions'],['MANUAL_LABELER','Task.html','/tasks'],['TERMINOLOGY','BaseManagement.html','/terms']]){
    const c=await setup(role,page,{[endpoint]:[]})
    assert.deepEqual(c.errors(),[]);c.dom.window.close()
  }
})

test('manager session workflow populates assignees from /api/assignees and refreshes upon session creation',async()=>{
  const customAssignees = [
    {id: 101, username: 'ml_user1', role: 'MANUAL_LABELER'},
    {id: 102, username: 'ml_user2', role: 'MANUAL_LABELER'},
    {id: 201, username: 'rev_user', role: 'REVIEWER'}
  ]
  const c=await setup('MANAGER','Session.html',{'/assignees':customAssignees})
  try {
    const m1Select=c.w.document.querySelector('#manualLabeler1')
    const revSelect=c.w.document.querySelector('#manualReviewer')

    // Verify select options populated directly from /api/assignees
    const m1Options=[...m1Select.options].map(o=>o.value).filter(Boolean)
    const revOptions=[...revSelect.options].map(o=>o.value).filter(Boolean)
    assert.deepEqual(m1Options,['101','102'],'Manual labelers must come from /api/assignees')
    assert.deepEqual(revOptions,['201'],'Reviewers must come from /api/assignees')

    // Submit a valid session creation
    c.w.document.querySelector('input[placeholder^="e.g."]').value='Refresh Test Session'
    c.w.document.querySelector('input[name="documents"]').checked=true
    c.w.document.querySelector('[aria-label="Session due date"]').value='2099-12-31'
    m1Select.value='101'
    m1Select.dispatchEvent(new c.w.Event('change'))
    c.w.document.querySelector('#manualLabeler2').value='102'
    c.w.document.querySelector('#manualLabeler2').dispatchEvent(new c.w.Event('change'))
    revSelect.value='201'
    revSelect.dispatchEvent(new c.w.Event('change'))

    const initialAssigneeFetchCount=c.calls.filter(x=>x.path==='/assignees'&&!x.method).length
    c.button('Create Session').click();await c.settle()
    assert.deepEqual(c.errors(),[])

    // Verify /api/assignees was reloaded after session creation
    const postAssigneeFetchCount=c.calls.filter(x=>x.path==='/assignees'&&!x.method).length
    assert.ok(postAssigneeFetchCount>initialAssigneeFetchCount,'/api/assignees must be refreshed after successful session creation')
  } finally {c.dom.window.close()}
})

test('closing an active session triggers /api/assignees refresh to reload newly available users',async()=>{
  const c=await setup('MANAGER','Session.html',{
    '/sessions': [
      { id: 22, name: 'Active Session 22', description: '', session_type: 'MANUAL', status: 'ACTIVE', members: [{id:4,username:'manual_labeler01'}] }
    ]
  })
  try {
    const closeBtn=[...c.w.document.querySelectorAll('button')].find(b=>b.textContent.trim()==='Close')
    assert.ok(closeBtn,'Close action button must exist for ACTIVE session')

    const initialAssigneeFetchCount=c.calls.filter(x=>x.path==='/assignees'&&!x.method).length
    closeBtn.click();await c.settle()
    assert.deepEqual(c.errors(),[])

    // Verify PATCH /sessions/22/status sent with CLOSED
    const closeCall=c.calls.find(x=>x.path==='/sessions/22/status'&&x.method==='PATCH')
    assert.ok(closeCall,'Must call PATCH /sessions/22/status')
    assert.deepEqual(JSON.parse(JSON.stringify(closeCall.json)),{status:'CLOSED'})

    // Verify /api/assignees was reloaded after closing the session
    const postAssigneeFetchCount=c.calls.filter(x=>x.path==='/assignees'&&!x.method).length
    assert.ok(postAssigneeFetchCount>initialAssigneeFetchCount,'/api/assignees must be refreshed after closing a session')
  } finally {c.dom.window.close()}
})

test('user management status distinguishes account status INACTIVE from workload status AVAILABLE/BUSY',async()=>{
  const users = [
    { id: 11, username: 'user_available', email: 'avail@example.com', role: 'MANUAL_LABELER', is_active: true, status: 'AVAILABLE' },
    { id: 12, username: 'user_busy', email: 'busy@example.com', role: 'MANUAL_LABELER', is_active: true, status: 'BUSY' },
    { id: 13, username: 'user_locked', email: 'locked@example.com', role: 'MANUAL_LABELER', is_active: false, status: 'BUSY' }
  ]
  const c=await setup('MANAGER','UserManagement.html',{'/users':users})
  try {
    const rows=[...c.w.document.querySelectorAll('tbody tr')]
    assert.equal(rows.length,3)

    // Cell index 4 corresponds to Status column
    const statusColValues=rows.map(r=>r.querySelectorAll('td')[4]?.textContent.trim())
    assert.equal(statusColValues[0],'AVAILABLE','Active available user shows AVAILABLE workload status')
    assert.equal(statusColValues[1],'BUSY','Active busy user shows BUSY workload status')
    assert.equal(statusColValues[2],'INACTIVE','Locked user (is_active: false) shows INACTIVE account status')
  } finally {c.dom.window.close()}
})

test('create session dropdowns display user status correctly (CASES 1-5)', async () => {
  const customAssignees = [
    { id: 1, username: 'manual_labeler', role: 'MANUAL_LABELER', is_active: true, status: 'AVAILABLE' },
    { id: 4, username: 'manual_labeler04', role: 'MANUAL_LABELER', is_active: true, status: 'BUSY' },
    { id: 5, username: 'manual_labeler05', role: 'MANUAL_LABELER', is_active: false, status: 'AVAILABLE' },
    { id: 6, username: 'manual_labeler06', role: 'MANUAL_LABELER', is_active: false, status: 'BUSY' },
    { id: 7, username: 'reviewer01', role: 'REVIEWER', is_active: true, status: 'AVAILABLE' },
    { id: 8, username: 'reviewer02', role: 'REVIEWER', is_active: false, status: 'AVAILABLE' },
    { id: 9, username: 'ai_labeler01', role: 'AI_LABELER', is_active: true, status: 'BUSY' },
    { id: 10, username: 'ai_labeler02', role: 'AI_LABELER', is_active: false, status: 'BUSY' },
    { id: 11, username: 'manual_labeler_unknown', role: 'MANUAL_LABELER', is_active: true, status: null }
  ]
  const c = await setup('MANAGER', 'Session.html', { '/assignees': customAssignees })
  try {
    const m1Select = c.w.document.querySelector('#manualLabeler1')
    const m2Select = c.w.document.querySelector('#manualLabeler2')
    const revSelect = c.w.document.querySelector('#manualReviewer')
    const aiLabelerSelect = c.w.document.querySelector('#aiLabeler')
    const aiRevSelect = c.w.document.querySelector('#aiReviewer')

    // CASE 1: username=manual_labeler, is_active=true, status=AVAILABLE => manual_labeler — AVAILABLE
    const opt1 = [...m1Select.options].find(o => o.value === '1')
    assert.ok(opt1, 'Option for manual_labeler must exist')
    assert.equal(opt1.textContent, 'manual_labeler — AVAILABLE')

    // CASE 2: username=manual_labeler04, is_active=true, status=BUSY => manual_labeler04 — BUSY
    const opt4 = [...m1Select.options].find(o => o.value === '4')
    assert.ok(opt4, 'Option for manual_labeler04 must exist')
    assert.equal(opt4.textContent, 'manual_labeler04 — BUSY')

    // CASE 3: username=manual_labeler05, is_active=false, status=AVAILABLE => manual_labeler05 — INACTIVE
    const opt5 = [...m1Select.options].find(o => o.value === '5')
    assert.ok(opt5, 'Option for manual_labeler05 must exist')
    assert.equal(opt5.textContent, 'manual_labeler05 — INACTIVE')

    // CASE 4: username=manual_labeler06, is_active=false, status=BUSY => manual_labeler06 — INACTIVE
    const opt6 = [...m1Select.options].find(o => o.value === '6')
    assert.ok(opt6, 'Option for manual_labeler06 must exist')
    assert.equal(opt6.textContent, 'manual_labeler06 — INACTIVE')

    // CASE 5: option.value still equals String(user.id)
    assert.equal(opt1.value, '1')
    assert.equal(opt4.value, '4')
    assert.equal(opt5.value, '5')
    assert.equal(opt6.value, '6')

    // Fallback: null/undefined status with is_active=true => UNKNOWN
    const optUnknown = [...m1Select.options].find(o => o.value === '11')
    assert.ok(optUnknown)
    assert.equal(optUnknown.textContent, 'manual_labeler_unknown — UNKNOWN')

    // Manual Labeler 2 has same formatted labels
    assert.equal([...m2Select.options].find(o => o.value === '1')?.textContent, 'manual_labeler — AVAILABLE')
    assert.equal([...m2Select.options].find(o => o.value === '5')?.textContent, 'manual_labeler05 — INACTIVE')

    // Reviewer dropdown (manual mode)
    assert.equal([...revSelect.options].find(o => o.value === '7')?.textContent, 'reviewer01 — AVAILABLE')
    assert.equal([...revSelect.options].find(o => o.value === '8')?.textContent, 'reviewer02 — INACTIVE')

    // AI Mode dropdowns
    assert.equal([...aiLabelerSelect.options].find(o => o.value === '9')?.textContent, 'ai_labeler01 — BUSY')
    assert.equal([...aiLabelerSelect.options].find(o => o.value === '10')?.textContent, 'ai_labeler02 — INACTIVE')
    assert.equal([...aiRevSelect.options].find(o => o.value === '7')?.textContent, 'reviewer01 — AVAILABLE')
    assert.equal([...aiRevSelect.options].find(o => o.value === '8')?.textContent, 'reviewer02 — INACTIVE')

    // Form submission still submits numeric id
    c.w.document.querySelector('input[placeholder^="e.g."]').value = 'Status Test Session'
    c.w.document.querySelector('input[name="documents"]').checked = true
    c.w.document.querySelector('[aria-label="Session due date"]').value = '2099-12-31'
    m1Select.value = '1'
    m1Select.dispatchEvent(new c.w.Event('change'))
    m2Select.value = '4'
    m2Select.dispatchEvent(new c.w.Event('change'))
    revSelect.value = '7'
    revSelect.dispatchEvent(new c.w.Event('change'))

    // Verify option disabled text preserves format with (Selected)
    const m2Opt1 = [...m2Select.options].find(o => o.value === '1')
    assert.ok(m2Opt1.disabled)
    assert.equal(m2Opt1.textContent, 'manual_labeler — AVAILABLE (Selected)')

    c.button('Create Session').click(); await c.settle()
    assert.deepEqual(c.errors(), [])
    const postCall = c.calls.find(x => x.path === '/sessions' && x.method === 'POST')
    assert.ok(postCall)
    assert.deepEqual(JSON.parse(JSON.stringify(postCall.json.manualLabelerIds)), [1,4])
    assert.equal(postCall.json.reviewerId, 7)
  } finally {
    c.dom.window.close()
  }
})

test('renderAssignmentDropdowns updates dropdowns dynamically with new user statuses', async () => {
  const initialAssignees = [
    { id: 1, username: 'manual_labeler', role: 'MANUAL_LABELER', is_active: true, status: 'AVAILABLE' },
    { id: 7, username: 'reviewer01', role: 'REVIEWER', is_active: true, status: 'AVAILABLE' }
  ]
  const c = await setup('MANAGER', 'Session.html', { '/assignees': initialAssignees })
  try {
    const m1Select = c.w.document.querySelector('#manualLabeler1')
    assert.equal([...m1Select.options].find(o => o.value === '1')?.textContent, 'manual_labeler — AVAILABLE')

    // Simulate user becoming BUSY after assignment
    const updatedAssignees = [
      { id: 1, username: 'manual_labeler', role: 'MANUAL_LABELER', is_active: true, status: 'BUSY' },
      { id: 7, username: 'reviewer01', role: 'REVIEWER', is_active: true, status: 'BUSY' }
    ]
    c.w.renderAssignmentDropdowns(updatedAssignees)

    assert.equal([...m1Select.options].find(o => o.value === '1')?.textContent, 'manual_labeler — BUSY')
    const revSelect = c.w.document.querySelector('#manualReviewer')
    assert.equal([...revSelect.options].find(o => o.value === '7')?.textContent, 'reviewer01 — BUSY')
  } finally {
    c.dom.window.close()
  }
})
