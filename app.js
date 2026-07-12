/* Onyx Web — a bring-your-own-key AI assistant. Pure static app; talks directly to your provider
   and optionally to an Onyx Sync server. No build step. */
(function () {
  'use strict';
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
  const uuid = () => (crypto.randomUUID ? crypto.randomUUID() : 'id-' + Date.now() + Math.random().toString(16).slice(2));
  const now = () => Date.now();

  // ---------- Catalog ----------
  const PROVIDERS = {
    OPENAI: { name: 'OpenAI-compatible', endpoint: 'https://api.openai.com/v1', models: ['gpt-4o', 'gpt-4o-mini', 'gpt-4.1', 'gpt-4.1-mini', 'o3-mini', 'gpt-3.5-turbo'] },
    ANTHROPIC: { name: 'Anthropic-compatible', endpoint: 'https://api.anthropic.com/v1', models: ['claude-opus-4-8', 'claude-sonnet-4-6', 'claude-haiku-4-5-20251001', 'claude-3-5-sonnet-latest', 'claude-3-5-haiku-latest'] },
    CUSTOM: { name: 'Custom endpoint', endpoint: '', models: ['gpt-4o-mini', 'llama-3.1-70b-instruct', 'mixtral-8x7b'] }
  };
  const STYLES = {
    BALANCED: ['Balanced', ''],
    SHORT: ['Short', 'Answer concisely in as few words as possible. Prefer bullet points.'],
    DETAILED: ['Detailed', 'Give thorough, well-structured answers with helpful context and examples.'],
    CREATIVE: ['Creative', 'Be imaginative, expressive and original. Use vivid, engaging language.'],
    PROFESSIONAL: ['Professional', 'Respond in a formal, precise, business-appropriate tone.'],
    CODING: ['Coding', 'You are an expert programmer. Prefer correct, idiomatic code with brief explanations and fenced code blocks.']
  };
  const PERSONAS = {
    ONYX: ['Onyx', '◆', 'You are Onyx, a sharp, calm and helpful AI assistant. You are precise and friendly.'],
    SAGE: ['Sage', '▲', 'You are Sage, a wise, patient mentor who explains ideas clearly and encourages the user.'],
    SPARK: ['Spark', '✦', 'You are Spark, an energetic, witty companion who keeps things light and fun while still being helpful.'],
    ARCHITECT: ['Architect', '▣', 'You are Architect, a meticulous engineering assistant focused on clean design, correctness and best practices.'],
    MUSE: ['Muse', '✿', 'You are Muse, a poetic, creative collaborator brimming with imaginative ideas.']
  };
  const ACCENTS = { Mono: '#F5F5F5', Ice: '#BFD7FF', Ember: '#F3C9A0', Mint: '#B6F0D2', Violet: '#D6C6FF' };
  function price(model) {
    const m = model.toLowerCase();
    if (m.includes('opus')) return [15, 75]; if (m.includes('sonnet')) return [3, 15]; if (m.includes('haiku')) return [0.8, 4];
    if (m.includes('gpt-4o-mini')) return [0.15, 0.6]; if (m.includes('gpt-4o') || m.includes('gpt-4.1')) return [2.5, 10];
    if (m.includes('gpt-4')) return [10, 30]; if (m.includes('o3')) return [1.1, 4.4]; return [0.5, 1.5];
  }

  // ---------- State ----------
  const LS = { s: 'onyx_settings', c: 'onyx_chats', k: 'onyx_keys', a: 'onyx_account' };
  const load = (key, def) => { try { const v = JSON.parse(localStorage.getItem(key)); return v == null ? def : v; } catch { return def; } };
  const save = (key, v) => localStorage.setItem(key, JSON.stringify(v));

  let settings = Object.assign({
    provider: 'OPENAI', endpoint: PROVIDERS.OPENAI.endpoint, model: 'gpt-4o-mini',
    temperature: 0.7, maxTokens: 1024, systemPrompt: '', responseStyle: 'BALANCED', personality: 'ONYX',
    streamResponses: true, memoryEnabled: true, memoryNotes: '', ttsEnabled: false,
    fontScale: 1, accent: 'Mono', userName: ''
  }, load(LS.s, {}));
  let chats = load(LS.c, []);
  let keys = load(LS.k, {});
  let account = Object.assign({ serverUrl: '', token: '', email: '', settingsUpdatedAt: 0, keysUpdatedAt: 0, lastSyncAt: 0, deletedIds: [] }, load(LS.a, {}));
  let currentId = chats[0] ? chats[0].id : null;
  let streaming = false, abortCtrl = null, syncing = false;

  const saveSettings = (bump) => { if (bump) account.settingsUpdatedAt = now(); save(LS.s, settings); save(LS.a, account); applyTheme(); };
  const saveChats = () => save(LS.c, chats);
  const saveKeys = () => { account.keysUpdatedAt = now(); save(LS.k, keys); save(LS.a, account); };
  const saveAccount = () => save(LS.a, account);
  const curChat = () => chats.find(c => c.id === currentId);

  function applyTheme() {
    document.documentElement.style.setProperty('--accent', ACCENTS[settings.accent] || '#F5F5F5');
    document.documentElement.style.setProperty('--font-scale', settings.fontScale);
  }

  // ---------- Markdown ----------
  marked.setOptions({ breaks: true, gfm: true });
  function renderMarkdown(md) {
    const html = DOMPurify.sanitize(marked.parse(md || ''));
    const wrap = document.createElement('div');
    wrap.className = 'body';
    wrap.innerHTML = html;
    wrap.querySelectorAll('pre').forEach(pre => {
      const code = pre.querySelector('code');
      const lang = code && code.className.match(/language-(\w+)/);
      const box = document.createElement('div'); box.className = 'code-wrap';
      const head = document.createElement('div'); head.className = 'code-head';
      head.innerHTML = `<span>${lang ? lang[1] : 'code'}</span>`;
      const btn = document.createElement('button'); btn.className = 'copy-btn'; btn.textContent = 'Copy';
      btn.onclick = () => { navigator.clipboard.writeText(code ? code.textContent : pre.textContent); btn.textContent = 'Copied'; setTimeout(() => btn.textContent = 'Copy', 1500); };
      head.appendChild(btn);
      pre.parentNode.insertBefore(box, pre);
      box.appendChild(head); box.appendChild(pre);
      if (code && window.hljs) { try { hljs.highlightElement(code); } catch (e) {} }
    });
    return wrap;
  }

  // ---------- Provider requests ----------
  function resolvedSystemPrompt(chat) {
    const parts = [];
    const persona = PERSONAS[(chat && chat.personality) || settings.personality] || PERSONAS.ONYX;
    parts.push(persona[2]);
    const style = STYLES[settings.responseStyle] || STYLES.BALANCED;
    if (settings.responseStyle !== 'BALANCED' && style[1]) parts.push(style[1]);
    if (settings.systemPrompt.trim()) parts.push(settings.systemPrompt.trim());
    if (settings.memoryEnabled && settings.memoryNotes.trim()) parts.push('Remember these facts about the user and act on them:\n' + settings.memoryNotes.trim());
    return parts.join('\n\n');
  }
  function outMessages(chat) {
    return chat.messages.filter(m => m.role !== 'system' && !m.isError).map(m => ({ role: m.role, content: m.content, image: (m.imageUri && m.imageUri.startsWith('data:')) ? m.imageUri : null }));
  }
  function base() { return (settings.endpoint || '').trim().replace(/\/+$/, ''); }

  function buildBody(msgs, sys, includeTemp) {
    const isA = settings.provider === 'ANTHROPIC';
    const body = { model: settings.model, max_tokens: settings.maxTokens, stream: settings.streamResponses };
    if (includeTemp) body.temperature = settings.temperature;
    if (isA) {
      if (sys) body.system = sys;
      body.messages = msgs.map(m => {
        const content = [];
        if (m.image) { const [meta, b64] = splitData(m.image); content.push({ type: 'image', source: { type: 'base64', media_type: meta, data: b64 } }); }
        content.push({ type: 'text', text: m.content });
        return { role: m.role, content };
      });
    } else {
      if (settings.streamResponses) body.stream_options = { include_usage: true };
      const arr = [];
      if (sys) arr.push({ role: 'system', content: sys });
      msgs.forEach(m => {
        if (m.image) arr.push({ role: m.role, content: [{ type: 'text', text: m.content }, { type: 'image_url', image_url: { url: m.image } }] });
        else arr.push({ role: m.role, content: m.content });
      });
      body.messages = arr;
    }
    return body;
  }
  function splitData(url) { try { const meta = url.substring(5).split(',')[0].split(';')[0] || 'image/jpeg'; return [meta, url.split(',')[1]]; } catch { return ['image/jpeg', '']; } }
  function headers(key) {
    const h = { 'Content-Type': 'application/json' };
    if (settings.provider === 'ANTHROPIC') { h['x-api-key'] = key; h['anthropic-version'] = '2023-06-01'; h['anthropic-dangerous-direct-browser-access'] = 'true'; }
    else h['Authorization'] = 'Bearer ' + key;
    return h;
  }

  async function streamChat(chat, onDelta, onUsage) {
    const key = keys[settings.provider];
    if (!key) throw new Error('NO_KEY');
    const path = settings.provider === 'ANTHROPIC' ? '/messages' : '/chat/completions';
    const sys = resolvedSystemPrompt(chat);
    const msgs = outMessages(chat);
    async function attempt(includeTemp) {
      abortCtrl = new AbortController();
      return fetch(base() + path, { method: 'POST', headers: headers(key), body: JSON.stringify(buildBody(msgs, sys, includeTemp)), signal: abortCtrl.signal });
    }
    let resp = await attempt(true);
    if (!resp.ok) {
      const errTxt = await resp.text();
      if (resp.status === 400 && /temperature/i.test(errTxt)) { resp = await attempt(false); }
      else throw new Error(errorMsg(resp.status, errTxt));
      if (!resp.ok) throw new Error(errorMsg(resp.status, await resp.text()));
    }
    if (!settings.streamResponses) { const t = await resp.text(); parseFull(t, onDelta, onUsage); return; }
    const reader = resp.body.getReader(); const dec = new TextDecoder(); let buf = '';
    while (true) {
      const { done, value } = await reader.read(); if (done) break;
      buf += dec.decode(value, { stream: true });
      let idx;
      while ((idx = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, idx).trim(); buf = buf.slice(idx + 1);
        if (!line.startsWith('data:')) continue;
        const data = line.slice(5).trim();
        if (data === '[DONE]') return;
        let j; try { j = JSON.parse(data); } catch { continue; }
        if (settings.provider === 'ANTHROPIC') {
          if (j.type === 'content_block_delta' && j.delta && j.delta.text) onDelta(j.delta.text);
          else if (j.type === 'message_start' && j.message && j.message.usage) onUsage(j.message.usage.input_tokens || 0, 0);
          else if (j.type === 'message_delta' && j.usage) onUsage(0, j.usage.output_tokens || 0);
        } else {
          if (j.usage) onUsage(j.usage.prompt_tokens || 0, j.usage.completion_tokens || 0);
          const d = j.choices && j.choices[0] && j.choices[0].delta && j.choices[0].delta.content;
          if (d) onDelta(d);
        }
      }
    }
  }
  function parseFull(text, onDelta, onUsage) {
    try {
      const j = JSON.parse(text);
      if (settings.provider === 'ANTHROPIC') { const t = j.content && j.content[0] && j.content[0].text; if (t) onDelta(t); if (j.usage) onUsage(j.usage.input_tokens || 0, j.usage.output_tokens || 0); }
      else { const t = j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.content; if (t) onDelta(t); if (j.usage) onUsage(j.usage.prompt_tokens || 0, j.usage.completion_tokens || 0); }
    } catch (e) {}
  }
  function errorMsg(code, body) { try { const j = JSON.parse(body); const m = (j.error && j.error.message) || j.message; return 'HTTP ' + code + (m ? ' · ' + m : ''); } catch { return 'HTTP ' + code; } }

  // ---------- Chat actions ----------
  function newChat() { const c = { id: uuid(), syncId: uuid(), title: 'New chat', createdAt: now(), updatedAt: now(), pinned: false, favorite: false, personality: null, systemPromptOverride: null, messages: [] }; chats.unshift(c); currentId = c.id; saveChats(); renderAll(); $('#input').focus(); }
  function deleteChat(id) { const c = chats.find(x => x.id === id); if (c) { account.deletedIds = (account.deletedIds || []).concat(c.syncId); saveAccount(); } chats = chats.filter(x => x.id !== id); if (currentId === id) currentId = chats[0] ? chats[0].id : null; saveChats(); renderAll(); autoSync(); }
  function renameChat(id) { const c = chats.find(x => x.id === id); if (!c) return; const t = prompt('Rename conversation', c.title); if (t != null) { c.title = t.trim() || 'Untitled'; c.updatedAt = now(); saveChats(); renderAll(); autoSync(); } }
  function togglePin(id) { const c = chats.find(x => x.id === id); if (c) { c.pinned = !c.pinned; saveChats(); renderAll(); } }

  async function send() {
    const inp = $('#input'); const text = inp.value.trim();
    if ((!text && !pendingImage) || streaming) return;
    if (!keys[settings.provider]) { openModal('#settingsModal'); toast('Add your API key first, then try again.'); return; }
    let c = curChat(); if (!c) { newChat(); c = curChat(); }
    c.messages.push({ role: 'user', content: text, timestamp: now(), imageUri: pendingImage || null });
    if (c.title === 'New chat' || !c.title) c.title = (text || 'Image chat').slice(0, 42);
    c.updatedAt = now();
    inp.value = ''; inp.style.height = 'auto'; clearAttach();
    saveChats(); renderMessages(); renderSidebar();
    await runCompletion(c);
  }
  async function runCompletion(c) {
    streaming = true; updateSendBtn();
    const stream = { role: 'assistant', content: '', timestamp: now(), model: settings.model, promptTokens: 0, completionTokens: 0, streaming: true };
    c.messages.push(stream); renderMessages();
    let pt = 0, ct = 0;
    try {
      await streamChat(c, (d) => { stream.content += d; updateStreamingDom(stream.content); scrollDown(); },
        (p, k) => { if (p) pt = p; if (k) ct = k; });
      stream.streaming = false; stream.promptTokens = pt || Math.ceil((stream.content.length) / 4); stream.completionTokens = ct || Math.ceil(stream.content.length / 4);
      if (!stream.content.trim()) c.messages.pop();
      else if (settings.ttsEnabled) speak(stream.content);
    } catch (e) {
      stream.streaming = false;
      if (e.message === 'NO_KEY') { c.messages.pop(); toast('Add your API key in Settings.'); }
      else { stream.isError = true; stream.content = '⚠️ ' + (e.name === 'AbortError' ? 'Stopped.' : e.message); }
    } finally {
      streaming = false; abortCtrl = null; c.updatedAt = now();
      saveChats(); updateSendBtn(); renderMessages(); renderSidebar(); autoSync();
    }
  }
  function regenerate() { const c = curChat(); if (!c || streaming) return; for (let i = c.messages.length - 1; i >= 0; i--) { if (c.messages[i].role === 'assistant') { c.messages.splice(i, 1); break; } } saveChats(); renderMessages(); runCompletion(c); }
  function editResend(idx) { const c = curChat(); if (!c || streaming) return; const m = c.messages[idx]; if (!m || m.role !== 'user') return; const t = prompt('Edit & resend', m.content); if (t == null) return; m.content = t.trim(); c.messages = c.messages.slice(0, idx + 1); saveChats(); renderMessages(); runCompletion(c); }
  function delMsg(idx) { const c = curChat(); if (!c) return; c.messages.splice(idx, 1); saveChats(); renderMessages(); }
  function stopStream() { if (abortCtrl) abortCtrl.abort(); }

  // ---------- Rendering ----------
  function renderAll() { renderSidebar(); renderMessages(); renderBadges(); }
  function fmtTime(ts) { const d = new Date(ts), diff = now() - ts; if (diff < 6e4) return 'just now'; if (diff < 36e5) return Math.floor(diff / 6e4) + 'm ago'; if (diff < 864e5) return Math.floor(diff / 36e5) + 'h ago'; if (diff < 6048e5) return Math.floor(diff / 864e5) + 'd ago'; return d.toLocaleDateString(); }
  function clock(ts) { return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }); }

  function renderSidebar() {
    const q = $('#search').value.trim().toLowerCase();
    let list = chats.slice().sort((a, b) => (b.pinned - a.pinned) || (b.updatedAt - a.updatedAt));
    if (q) list = list.filter(c => c.title.toLowerCase().includes(q) || c.messages.some(m => (m.content || '').toLowerCase().includes(q)));
    const box = $('#convList'); box.innerHTML = '';
    list.forEach(c => {
      const row = document.createElement('div'); row.className = 'conv' + (c.id === currentId ? ' active' : '');
      row.innerHTML = `${c.pinned ? '<span class="pin">📌</span>' : ''}<div class="c-main"><div class="c-title"></div><div class="c-time">${fmtTime(c.updatedAt)}</div></div>`;
      row.querySelector('.c-title').textContent = c.title;
      row.onclick = (e) => { if (e.target.closest('.c-act')) return; currentId = c.id; closeSidebar(); renderAll(); };
      const acts = document.createElement('div'); acts.style.display = 'flex';
      acts.innerHTML = `<button class="c-act" title="Pin">📌</button><button class="c-act" title="Rename">✎</button><button class="c-act" title="Delete">🗑</button>`;
      const [pinB, renB, delB] = acts.querySelectorAll('button');
      pinB.onclick = () => togglePin(c.id); renB.onclick = () => renameChat(c.id); delB.onclick = () => { if (confirm('Delete this conversation?')) deleteChat(c.id); };
      row.appendChild(acts); box.appendChild(row);
    });
  }
  function renderBadges() {
    $('#chatTitle').textContent = curChat() ? curChat().title : 'Onyx';
    $('#modelBadge').textContent = PROVIDERS[settings.provider].name + ' · ' + settings.model;
  }
  function messageNode(m, idx) {
    const persona = PERSONAS[settings.personality] || PERSONAS.ONYX;
    const wrap = document.createElement('div'); wrap.className = 'msg ' + (m.role === 'user' ? 'user' : 'assistant') + (m.isError ? ' err' : '');
    const who = document.createElement('div'); who.className = 'who';
    who.innerHTML = m.role === 'user' ? `<span>You</span><span>${clock(m.timestamp)}</span>` : `<span class="glyph">${persona[1]}</span><span>${persona[0]}</span><span>${clock(m.timestamp)}</span>`;
    wrap.appendChild(who);
    if (m.imageUri && m.imageUri.startsWith('data:')) { const img = document.createElement('img'); img.src = m.imageUri; img.className = 'attach-img'; wrap.appendChild(img); }
    if (m.role === 'user') { const b = document.createElement('div'); b.className = 'bubble'; b.textContent = m.content; wrap.appendChild(b); }
    else if (m.streaming && !m.content) { const t = document.createElement('div'); t.className = 'typing'; t.innerHTML = '<span></span><span></span><span></span>'; wrap.appendChild(t); }
    else if (m.isError) { const b = document.createElement('div'); b.className = 'body'; b.textContent = m.content; wrap.appendChild(b); }
    else { wrap.appendChild(renderMarkdown(m.content)); }
    // actions
    const acts = document.createElement('div'); acts.className = 'msg-acts';
    const copy = mkBtn('Copy', () => navigator.clipboard.writeText(m.content));
    acts.appendChild(copy);
    if (m.role === 'assistant' && !m.streaming) {
      acts.appendChild(mkBtn('↻ Regenerate', regenerate));
      acts.appendChild(mkBtn('🔊', () => speak(m.content)));
      if (m.completionTokens) { const t = document.createElement('span'); t.className = 'tok'; t.textContent = m.completionTokens + ' tok'; acts.appendChild(t); }
    }
    if (m.role === 'user') acts.appendChild(mkBtn('✎ Edit', () => editResend(idx)));
    if (!m.streaming) acts.appendChild(mkBtn('🗑', () => delMsg(idx)));
    wrap.appendChild(acts);
    return wrap;
  }
  function mkBtn(label, fn) { const b = document.createElement('button'); b.textContent = label; b.onclick = fn; return b; }
  function renderMessages() {
    const box = $('#messages'); box.innerHTML = '';
    const c = curChat();
    if (!c || c.messages.length === 0) {
      const persona = PERSONAS[settings.personality] || PERSONAS.ONYX;
      const e = document.createElement('div'); e.className = 'empty';
      e.innerHTML = `<div class="g">${persona[1]}</div><h1>How can I help?</h1><p class="muted">Ask anything, or try one of these:</p><div class="chips"></div>`;
      ['Explain a complex topic simply', 'Write a short poem about the night sky', 'Help me debug some code', 'Draft a professional email'].forEach(s => {
        const chip = document.createElement('button'); chip.className = 'chip'; chip.textContent = s;
        chip.onclick = () => { $('#input').value = s; send(); }; e.querySelector('.chips').appendChild(chip);
      });
      box.appendChild(e); renderBadges(); return;
    }
    c.messages.forEach((m, i) => box.appendChild(messageNode(m, i)));
    renderBadges(); scrollDown();
  }
  function updateStreamingDom(text) {
    const box = $('#messages'); const last = box.lastElementChild; if (!last) return;
    const old = last.querySelector('.body, .typing'); if (old) old.remove();
    last.insertBefore(renderMarkdown(text), last.querySelector('.msg-acts'));
  }
  function scrollDown() { const b = $('#messages'); b.scrollTop = b.scrollHeight; }
  function updateSendBtn() { const btn = $('#sendBtn'); btn.textContent = streaming ? '■' : '➤'; }

  // ---------- Voice ----------
  let recog = null;
  function micToggle() {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) { toast('Voice input not supported in this browser.'); return; }
    if (recog) { recog.stop(); recog = null; return; }
    recog = new SR(); recog.lang = navigator.language || 'en-US'; recog.interimResults = false;
    recog.onresult = (e) => { const t = e.results[0][0].transcript; const inp = $('#input'); inp.value = (inp.value ? inp.value + ' ' : '') + t; };
    recog.onend = () => { recog = null; };
    recog.start();
  }
  function speak(text) { try { const u = new SpeechSynthesisUtterance(text.replace(/```[\s\S]*?```/g, ' code block ').replace(/[*_#`>]/g, '').slice(0, 4000)); speechSynthesis.cancel(); speechSynthesis.speak(u); } catch (e) {} }

  // ---------- Image ----------
  let pendingImage = null;
  function onFile(file) {
    if (!file) return; const r = new FileReader();
    r.onload = () => { pendingImage = r.result; showAttach(); };
    r.readAsDataURL(file);
  }
  function showAttach() { const p = $('#attachPreview'); p.classList.remove('hidden'); p.innerHTML = `<img src="${pendingImage}"><button class="x">✕</button>`; p.querySelector('.x').onclick = clearAttach; }
  function clearAttach() { pendingImage = null; $('#attachPreview').classList.add('hidden'); $('#attachPreview').innerHTML = ''; }

  // ---------- Sync ----------
  const apiBase = () => account.serverUrl.trim().replace(/\/+$/, '');
  async function auth(kind, url, email, password) {
    const r = await fetch(url.replace(/\/+$/, '') + '/api/' + kind, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password }) });
    const j = await r.json().catch(() => ({}));
    if (r.ok && j.token) { account.serverUrl = url.trim().replace(/\/+$/, ''); account.token = j.token; account.email = j.email || email; saveAccount(); return { ok: true }; }
    return { ok: false, msg: j.error || ('HTTP ' + r.status) };
  }
  async function doSync(silent) {
    if (syncing || !account.token) return; syncing = true; renderAccountBody();
    try {
      const push = {
        conversations: chats.map(c => ({ syncId: c.syncId, updatedAt: c.updatedAt, data: JSON.stringify(syncShape(c)) })),
        deletedIds: account.deletedIds || [],
        settings: { updatedAt: account.settingsUpdatedAt, data: JSON.stringify(syncSettings()) },
        keys: { updatedAt: account.keysUpdatedAt, data: JSON.stringify(keys) }
      };
      const r = await fetch(apiBase() + '/api/sync', { method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + account.token }, body: JSON.stringify(push) });
      if (!r.ok) { if (!silent) toast('Sync failed: HTTP ' + r.status); return; }
      const pull = await r.json();
      applyPull(pull);
      if (!silent) toast('Synced · ' + pull.conversations.length + ' chats');
    } catch (e) { if (!silent) toast('Sync error: ' + e.message); }
    finally { syncing = false; renderAll(); renderAccountBody(); }
  }
  function syncShape(c) { return { syncId: c.syncId, title: c.title, createdAt: c.createdAt, updatedAt: c.updatedAt, pinned: c.pinned, favorite: c.favorite, personality: c.personality, systemPromptOverride: c.systemPromptOverride, messages: c.messages.filter(m => !m.streaming).map(m => ({ role: m.role, content: m.content, timestamp: m.timestamp, model: m.model || null, promptTokens: m.promptTokens || 0, completionTokens: m.completionTokens || 0, isError: !!m.isError, imageUri: m.imageUri || null })) }; }
  function syncSettings() { return { provider: settings.provider, endpoint: settings.endpoint, model: settings.model, temperature: settings.temperature, maxTokens: settings.maxTokens, systemPrompt: settings.systemPrompt, responseStyle: settings.responseStyle, personality: settings.personality, streamResponses: settings.streamResponses, memoryEnabled: settings.memoryEnabled, memoryNotes: settings.memoryNotes, fontScale: settings.fontScale, accent: settings.accent, userName: settings.userName }; }
  function applyPull(pull) {
    const server = (pull.conversations || []).map(w => { try { return JSON.parse(w.data); } catch { return null; } }).filter(Boolean);
    const byId = {}; chats.forEach(c => byId[c.syncId] = c);
    chats = server.map(s => { const local = byId[s.syncId]; return { id: local ? local.id : uuid(), syncId: s.syncId, title: s.title, createdAt: s.createdAt, updatedAt: s.updatedAt, pinned: !!s.pinned, favorite: !!s.favorite, personality: s.personality || null, systemPromptOverride: s.systemPromptOverride || null, messages: s.messages || [] }; });
    if (!chats.find(c => c.id === currentId)) currentId = chats[0] ? chats[0].id : null;
    if (pull.settings && pull.settings.data) { try { Object.assign(settings, JSON.parse(pull.settings.data)); account.settingsUpdatedAt = pull.settings.updatedAt; } catch {} }
    if (pull.keys && pull.keys.data) { try { keys = JSON.parse(pull.keys.data); account.keysUpdatedAt = pull.keys.updatedAt; } catch {} }
    account.deletedIds = []; account.lastSyncAt = now();
    saveChats(); save(LS.s, settings); save(LS.k, keys); saveAccount(); applyTheme();
  }
  let syncTimer = null;
  function autoSync() { if (!account.token) return; clearTimeout(syncTimer); syncTimer = setTimeout(() => doSync(true), 800); }

  // ---------- Modals ----------
  function openModal(sel) { $(sel).classList.remove('hidden'); }
  function closeModals() { $$('.modal').forEach(m => m.classList.add('hidden')); }
  function toast(msg) { const t = $('#toast'); t.textContent = msg; t.classList.remove('hidden'); clearTimeout(t._t); t._t = setTimeout(() => t.classList.add('hidden'), 3200); }

  function renderSettingsBody() {
    const b = $('#settingsBody'); const p = PROVIDERS[settings.provider];
    b.innerHTML = `
      <div class="field"><label>Provider</label><div class="seg" id="segProvider">
        ${Object.keys(PROVIDERS).map(k => `<button data-k="${k}" class="${settings.provider === k ? 'on' : ''}">${PROVIDERS[k].name.split('-')[0].split(' ')[0]}</button>`).join('')}
      </div></div>
      <div class="field"><label>Endpoint (base URL)</label><input id="fEndpoint" value="${escapeAttr(settings.endpoint)}"></div>
      <div class="field"><label>API key ${keys[settings.provider] ? '· saved ' + mask(keys[settings.provider]) : ''}</label>
        <input id="fKey" type="password" placeholder="${keys[settings.provider] ? 'Paste to replace' : 'Paste your API key'}">
        <div class="row" style="margin-top:8px"><button class="btn" id="saveKey">Save key</button><button class="btn ghost" id="testKey">Test connection</button>${keys[settings.provider] ? '<button class="btn ghost" id="rmKey">Remove</button>' : ''}</div>
        <div id="testStatus"></div>
      </div>
      <div class="field"><label>Model</label><select id="fModel">${p.models.map(m => `<option ${settings.model === m ? 'selected' : ''}>${m}</option>`).join('')}<option value="__custom" ${p.models.includes(settings.model) ? '' : 'selected'}>Custom: ${escapeHtml(settings.model)}</option></select>
        <input id="fModelCustom" placeholder="Or type any model name" value="${p.models.includes(settings.model) ? '' : escapeAttr(settings.model)}" style="margin-top:8px"></div>
      <div class="field"><div class="range-row"><label>Temperature</label><span class="mono">${settings.temperature.toFixed(1)}</span></div><input type="range" id="fTemp" min="0" max="2" step="0.1" value="${settings.temperature}"></div>
      <div class="field"><div class="range-row"><label>Max tokens</label><span class="mono">${settings.maxTokens}</span></div><input type="range" id="fMax" min="128" max="8192" step="128" value="${settings.maxTokens}"></div>
      <div class="field"><label>Personality</label><select id="fPersona">${Object.keys(PERSONAS).map(k => `<option value="${k}" ${settings.personality === k ? 'selected' : ''}>${PERSONAS[k][1]} ${PERSONAS[k][0]}</option>`).join('')}</select></div>
      <div class="field"><label>Response style</label><select id="fStyle">${Object.keys(STYLES).map(k => `<option value="${k}" ${settings.responseStyle === k ? 'selected' : ''}>${STYLES[k][0]}</option>`).join('')}</select></div>
      <div class="field"><label>Custom system prompt</label><textarea id="fSys">${escapeHtml(settings.systemPrompt)}</textarea></div>
      <div class="field"><label>Memory notes</label><textarea id="fMem" placeholder="What should Onyx remember?">${escapeHtml(settings.memoryNotes)}</textarea></div>
      <div class="field"><label>Accent</label><div class="swatches" id="swatches">${Object.keys(ACCENTS).map(k => `<div class="swatch ${settings.accent === k ? 'on' : ''}" data-k="${k}" style="background:${ACCENTS[k]}"></div>`).join('')}</div></div>
      <div class="field"><div class="range-row"><label>Font size</label><span class="mono">${Math.round(settings.fontScale * 100)}%</span></div><input type="range" id="fFont" min="0.8" max="1.4" step="0.05" value="${settings.fontScale}"></div>
      <div class="field"><label><input type="checkbox" id="fStream" ${settings.streamResponses ? 'checked' : ''}> Stream responses</label>
        <label style="margin-top:8px"><input type="checkbox" id="fTts" ${settings.ttsEnabled ? 'checked' : ''}> Read answers aloud (TTS)</label></div>
      <p class="hint">Your API key is stored only in this browser's local storage. Sign in under Account &amp; Sync to share it (encrypted) with your phone/desktop.</p>
    `;
    $$('#segProvider button').forEach(btn => btn.onclick = () => { settings.provider = btn.dataset.k; settings.endpoint = PROVIDERS[settings.provider].endpoint; settings.model = PROVIDERS[settings.provider].models[0]; saveSettings(true); renderSettingsBody(); renderBadges(); });
    $('#fEndpoint').onchange = e => { settings.endpoint = e.target.value; saveSettings(true); };
    $('#saveKey').onclick = () => { const v = $('#fKey').value.trim(); if (v) { keys[settings.provider] = v; saveKeys(); renderSettingsBody(); autoSync(); toast('Key saved'); } };
    if ($('#rmKey')) $('#rmKey').onclick = () => { delete keys[settings.provider]; saveKeys(); renderSettingsBody(); autoSync(); };
    $('#testKey').onclick = testConnection;
    $('#fModel').onchange = e => { if (e.target.value !== '__custom') { settings.model = e.target.value; saveSettings(true); renderBadges(); } };
    $('#fModelCustom').onchange = e => { if (e.target.value.trim()) { settings.model = e.target.value.trim(); saveSettings(true); renderSettingsBody(); renderBadges(); } };
    $('#fTemp').oninput = e => { settings.temperature = parseFloat(e.target.value); e.target.previousElementSibling.querySelector('.mono').textContent = settings.temperature.toFixed(1); saveSettings(true); };
    $('#fMax').oninput = e => { settings.maxTokens = parseInt(e.target.value); e.target.previousElementSibling.querySelector('.mono').textContent = settings.maxTokens; saveSettings(true); };
    $('#fPersona').onchange = e => { settings.personality = e.target.value; saveSettings(true); };
    $('#fStyle').onchange = e => { settings.responseStyle = e.target.value; saveSettings(true); };
    $('#fSys').onchange = e => { settings.systemPrompt = e.target.value; saveSettings(true); };
    $('#fMem').onchange = e => { settings.memoryNotes = e.target.value; saveSettings(true); };
    $('#fFont').oninput = e => { settings.fontScale = parseFloat(e.target.value); e.target.previousElementSibling.querySelector('.mono').textContent = Math.round(settings.fontScale * 100) + '%'; saveSettings(true); };
    $('#fStream').onchange = e => { settings.streamResponses = e.target.checked; saveSettings(true); };
    $('#fTts').onchange = e => { settings.ttsEnabled = e.target.checked; saveSettings(true); };
    $$('#swatches .swatch').forEach(sw => sw.onclick = () => { settings.accent = sw.dataset.k; saveSettings(true); renderSettingsBody(); });
  }
  async function testConnection() {
    const key = $('#fKey').value.trim() || keys[settings.provider];
    const st = $('#testStatus'); if (!key) { st.innerHTML = '<div class="status bad">No API key entered</div>'; return; }
    st.innerHTML = '<div class="status">Testing…</div>';
    try {
      if (settings.provider === 'ANTHROPIC') {
        const r = await fetch(base() + '/models', { headers: headers(key) });
        st.innerHTML = r.ok ? '<div class="status ok">Connected successfully</div>' : '<div class="status bad">' + errorMsg(r.status, await r.text()) + '</div>';
      } else {
        const r = await fetch(base() + '/models', { headers: headers(key) });
        if (r.ok) { const j = await r.json().catch(() => ({})); const n = j.data ? j.data.length : null; st.innerHTML = '<div class="status ok">Connected' + (n != null ? ' · ' + n + ' models' : '') + '</div>'; }
        else if (r.status === 401 || r.status === 403) st.innerHTML = '<div class="status bad">Invalid API key (HTTP ' + r.status + ')</div>';
        else st.innerHTML = '<div class="status bad">' + errorMsg(r.status, await r.text()) + '</div>';
      }
    } catch (e) { st.innerHTML = '<div class="status bad">' + e.message + ' (check the endpoint / CORS)</div>'; }
  }

  function renderAccountBody() {
    const b = $('#accountBody'); if (!b) return;
    if (account.token) {
      b.innerHTML = `<div class="field"><label>Signed in</label><div>${escapeHtml(account.email)}</div><div class="muted" style="font-size:12px">${escapeHtml(account.serverUrl)} · last sync ${account.lastSyncAt ? fmtTime(account.lastSyncAt) : 'never'}</div></div>
        <div class="row"><button class="btn" id="syncNow" ${syncing ? 'disabled' : ''}>${syncing ? 'Syncing…' : 'Sync now'}</button><button class="btn ghost" id="signOut">Sign out</button></div>
        <p class="hint">Chats, settings and API keys sync to your server so you can continue on the phone and desktop apps. Keys are encrypted at rest on the server.</p>`;
      $('#syncNow').onclick = () => doSync(false);
      $('#signOut').onclick = () => { account = { serverUrl: account.serverUrl, token: '', email: '', settingsUpdatedAt: 0, keysUpdatedAt: 0, lastSyncAt: 0, deletedIds: [] }; saveAccount(); renderAccountBody(); };
    } else {
      b.innerHTML = `<div class="field"><label>Server URL</label><input id="aUrl" value="${escapeAttr(account.serverUrl)}" placeholder="https://your-onyx-sync.example.com"></div>
        <div class="field"><label>Email</label><input id="aEmail" type="email"></div>
        <div class="field"><label>Password</label><input id="aPass" type="password"></div>
        <div id="aStatus"></div>
        <div class="row"><button class="btn" id="aLogin">Sign in</button><button class="btn ghost" id="aReg">Create account</button></div>
        <p class="hint">Point this at your self-hosted Onyx Sync server. Use the same login on the phone/desktop apps to continue your chats. (HTTPS required from this hosted site.)</p>`;
      const go = async (kind) => {
        const url = $('#aUrl').value.trim(), email = $('#aEmail').value.trim(), pass = $('#aPass').value;
        if (!url || !email || !pass) return;
        $('#aStatus').innerHTML = '<div class="status">Please wait…</div>';
        const res = await auth(kind, url, email, pass);
        if (res.ok) { renderAccountBody(); doSync(false); } else $('#aStatus').innerHTML = '<div class="status bad">' + res.msg + '</div>';
      };
      $('#aLogin').onclick = () => go('login'); $('#aReg').onclick = () => go('register');
    }
  }

  function escapeHtml(s) { return (s || '').replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c])); }
  function escapeAttr(s) { return escapeHtml(s).replace(/"/g, '&quot;'); }
  function mask(k) { return k.length <= 8 ? '••••' : k.slice(0, 4) + '••••••••' + k.slice(-4); }

  // ---------- Sidebar mobile ----------
  function openSidebar() { $('#sidebar').classList.add('open'); $('#scrim').classList.add('show'); }
  function closeSidebar() { $('#sidebar').classList.remove('open'); $('#scrim').classList.remove('show'); }

  // ---------- Init ----------
  function wire() {
    $('#newChat').onclick = newChat;
    $('#search').oninput = renderSidebar;
    $('#sendBtn').onclick = () => streaming ? stopStream() : send();
    $('#input').addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } });
    $('#input').addEventListener('input', e => { e.target.style.height = 'auto'; e.target.style.height = Math.min(e.target.scrollHeight, 180) + 'px'; });
    $('#attachBtn').onclick = () => $('#fileInput').click();
    $('#fileInput').onchange = e => onFile(e.target.files[0]);
    $('#micBtn').onclick = micToggle;
    $('#openSettings').onclick = () => { renderSettingsBody(); openModal('#settingsModal'); };
    $('#openAccount').onclick = () => { renderAccountBody(); openModal('#accountModal'); };
    $('#openAbout').onclick = () => openModal('#aboutModal');
    $('#styleBtn').onclick = () => { renderSettingsBody(); openModal('#settingsModal'); };
    $('#menuBtn').onclick = openSidebar; $('#closeSidebar').onclick = closeSidebar; $('#scrim').onclick = closeSidebar;
    $$('.close-modal').forEach(b => b.onclick = closeModals);
    $$('.modal').forEach(m => m.addEventListener('click', e => { if (e.target === m) closeModals(); }));
  }
  applyTheme(); wire(); renderAll();
  setTimeout(() => { $('#splash').classList.add('fade'); setTimeout(() => { $('#splash').classList.add('hidden'); $('#app').classList.remove('hidden'); }, 500); }, 1400);
  if (account.token) doSync(true);
})();
