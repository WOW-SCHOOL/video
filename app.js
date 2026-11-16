'use strict';
(() => {
  const $ = (id) => document.getElementById(id);
  const escapeHTML = (v) => String(v ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const boot = window.WOW_BOOT || {logged:false,csrf:'',role:''};
  let csrf = boot.csrf;
  let role = boot.role || '';
  let loginRole = 'teacher';
  const clientUid = (globalThis.crypto && crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2) + Date.now().toString(36)).replace(/[^\w-]/g,'');
  let questions = [];
  let room = null;
  let jitsiRoom = '';
  let slide = -1;
  let draft = {};
  let matchSelected = null;
  let lastSignal = 0;
  let pollTimer = 0;
  let running = false;
  let localStream = null;
  let pc = null;
  let peerUid = null;
  let iceBuffer = [];
  let videoMode = 'p2p';
  let jitsiAPI = null;
  let jitsiJoined = false;
  let mediaEnabled = false;
  let draftTimer = 0;
  let answerQueue = Promise.resolve();
  let toastTimer;
  const other = () => role === 'teacher' ? 'student' : 'teacher';
  const isTeacher = () => role === 'teacher';
  const present = (r) => !!room?.presence?.[r];
  const activeAnswer = () => draft[slide] !== undefined ? draft[slide] : (room?.answers?.[String(slide)]?.value ?? emptyAnswer());
  function emptyAnswer(){ return questions[slide]?.type === 'match' ? {} : questions[slide]?.type === 'order' ? [] : ''; }
  const stringify = v => typeof v === 'string' ? v : JSON.stringify(v);

  async function api(action, payload = {}) {
    const res = await fetch('api.php', {
      method: 'POST', credentials: 'same-origin', cache: 'no-store',
      headers: {'Content-Type':'application/json'},
      body: JSON.stringify({action,csrf,...payload})
    });
    let data;
    try { data = await res.json(); } catch { throw new Error('Сервер вернул не JSON. Проверь, что хостинг поддерживает PHP.'); }
    if (!res.ok || !data.ok) {
      if (res.status === 401 && action !== 'login') {
        showLogin();
        throw new Error('Сессия закончилась. Выполни вход повторно.');
      }
      throw new Error(data.error || `Ошибка HTTP ${res.status}`);
    }
    return data;
  }

  function toast(text) {
    $('toast').textContent = text;
    $('toast').hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => $('toast').hidden = true, 3700);
  }
  function showLogin() {
    running = false;
    clearTimeout(pollTimer);
    shutdownMedia();
    $('appView').hidden = true;
    $('loginView').hidden = false;
    $('userChip').hidden = true;
    $('logoutBtn').hidden = true;
  }
  function showApp() {
    $('loginView').hidden = true;
    $('appView').hidden = false;
    $('userChip').hidden = false;
    $('logoutBtn').hidden = false;
    $('userName').textContent = role === 'teacher' ? 'Александр' : 'Мария';
    $('userAvatar').textContent = role === 'teacher' ? 'А' : 'М';
    $('teacherTools').hidden = !isTeacher();
    $('modeButtons').hidden = !isTeacher();
    $('lessonHint').textContent = isTeacher()
      ? '🎓 Только преподаватель переключает задания. Ответы ученика видны ниже.'
      : '🔄 Преподаватель управляет уроком. Твои ответы сразу появляются у него.';
    running = true;
    tick();
  }

  document.querySelectorAll('.role-option').forEach(btn => btn.addEventListener('click', () => {
    loginRole = btn.dataset.role;
    document.querySelectorAll('.role-option').forEach(x => x.classList.toggle('active', x === btn));
    $('loginName').value = loginRole;
    $('loginPassword').value = loginRole === 'teacher' ? 'teacher123' : 'student123';
    $('loginError').hidden = true;
  }));
  $('loginForm').addEventListener('submit', async event => {
    event.preventDefault();
    $('loginBtn').disabled = true;
    $('loginError').hidden = true;
    try {
      const data = await api('login', {username:$('loginName').value.trim(),password:$('loginPassword').value});
      csrf=data.csrf;
      role=data.role;
      slide=-1; room=null; questions=[]; lastSignal=0;
      showApp();
    } catch(err) {
      $('loginError').textContent=err.message;
      $('loginError').hidden=false;
    } finally {$('loginBtn').disabled=false;}
  });
  $('logoutBtn').addEventListener('click', async () => {
    try {await api('logout');}catch{}
    location.href='./';
  });

  async function tick(){
    if (!running) return;
    try {
      const data=await api('poll',{uid:clientUid,media:mediaEnabled,last:lastSignal});
      const oldAnswers = room ? JSON.stringify(room.answers) : '';
      const previousAnswer = room?.answers?.[String(slide)];
      const oldManual = room ? JSON.stringify(room.manual) : '';
      const modeChanged = room && data.room.mode!==room.mode;
      room=data.room;
      questions=data.questions;
      jitsiRoom=data.jitsiRoom;
      const nextSlide=room.slide;
      if (modeChanged) {
        shutdownMedia();
        toast('Преподаватель переключил способ видеосвязи. Нажми «Включить видеосвязь» заново.');
      }
      videoMode=room.mode;
      renderVideoMode();
      renderPresence();
      if (slide!==nextSlide) {
        slide=nextSlide;
        matchSelected=null;
        clearTimeout(draftTimer);
        renderLesson();
      } else if (isTeacher() && (oldAnswers!==JSON.stringify(room.answers) || oldManual!==JSON.stringify(room.manual))) {
        renderLesson();
      } else if (!isTeacher() && oldAnswers!==JSON.stringify(room.answers)) {
        // Keep active text field focus during typing; repaint only when review state changes.
        const ans=room.answers[String(slide)];
        if ((ans?.submitted !== previousAnswer?.submitted) || (ans?.grade !== previousAnswer?.grade)) renderLesson();
      }
      renderCompletion();
      if (videoMode==='p2p') {
        for (const signal of room.signals) await receiveSignal(signal);
        const p = room.presence[other()];
        if (localStream && p?.media && p.uid) {
          if (isTeacher() && (!pc || peerUid!==p.uid)) await initiateOffer(p.uid);
        } else if (pc && (!p?.media || peerUid!==p?.uid)) {
          closePeer();
          setMediaStatus('Ожидаем подключения второго участника…');
        }
      }
      lastSignal=Math.max(lastSignal,room.seq);
    } catch(err) {
      if (running) { setMediaStatus('Проблема с сервером: '+err.message); console.warn(err); }
    }
    if (running) pollTimer=setTimeout(tick,1500);
  }

  function renderPresence(){
    ['teacher','student'].forEach(r => {
      const el=$(r+'Member');
      el.classList.toggle('is-online',present(r));
      el.querySelector('.member-status').textContent=present(r)?'●':'○';
    });
    $('participantTop').innerHTML=(Number(present('teacher'))+Number(present('student')))+' <small>/ 2</small>';
  }
  function renderCompletion(){
    if (!room) return;
    const done=Object.values(room.answers||{}).filter(a=>a.submitted).length;
    $('progressTop').innerHTML=done+' <small>/ 6</small>';
    $('progressTrack').style.width=((slide+1)/6*100)+'%';
    $('completionGrid').innerHTML=Array.from({length:6},(_,i)=>`<span class="${room.answers[i]?.submitted?'complete':''}" title="Задание ${i+1}"></span>`).join('');
    $('completionText').textContent=done?'Отправлено ответов: '+done+' из 6.':'Упражнения ещё не выполнены.';
  }
  function renderLesson(){
    if (!room || !questions[slide]) return;
    const q=questions[slide];
    $('slideCounter').textContent='Задание '+String(slide+1).padStart(2,'0')+' / 06';
    $('lessonTabs').innerHTML=questions.map((_,i)=>`<button type="button" class="step-btn ${i===slide?'current':''} ${room.answers[i]?.submitted?'done':''}" ${isTeacher()?'':'disabled'} data-step="${i}" aria-label="Задание ${i+1}">${i+1}${room.answers[i]?.submitted?' ✓':''}</button>`).join('');
    const val=activeAnswer();
    const header=`<div class="exercise-tag">✳ ${escapeHTML(q.tag)}</div><h2>${escapeHTML(q.title)}</h2><p class="desc">${escapeHTML(q.description)}</p>`;
    let content='';
    if (q.type==='choice' || q.type==='listening') {
      content+=`<div class="big-prompt">${escapeHTML(q.prompt)}</div>`;
      if (q.type==='listening') content+=`<button type="button" class="audio-btn" data-control="listen"><span>🔊</span> Прослушать на английском</button>`;
      content+=`<div class="option-grid">${q.options.map((opt,i)=>`<button type="button" class="answer-choice ${val===opt?'selected':''}" ${isTeacher()?'disabled':''} data-option="${escapeHTML(opt)}"><span class="option-letter">${String.fromCharCode(65+i)}</span>${escapeHTML(opt)}</button>`).join('')}</div>`;
    } else if (q.type==='fill') {
      content+=`<div class="big-prompt">${escapeHTML(q.prompt)}</div><input type="text" class="fill-input" id="fillAnswer" placeholder="${escapeHTML(q.placeholder)}" value="${escapeHTML(val)}" ${isTeacher()?'disabled':''} autocomplete="off" spellcheck="false">`;
    } else if (q.type==='match') {
      const pairs=val && typeof val==='object' && !Array.isArray(val) ? val : {};
      const used=new Set(Object.values(pairs));
      content+=`<div class="matching-grid"><div class="match-column">${q.left.map(left=>`<button class="match-btn ${matchSelected===left?'chosen':''} ${pairs[left]?'matched':''}" data-match-left="${escapeHTML(left)}" ${isTeacher()?'disabled':''}>${escapeHTML(left)} ${pairs[left]?'✓':''}</button>`).join('')}</div><div class="match-column">${q.right.map(right=>`<button class="match-btn ${used.has(right)?'matched':''}" data-match-right="${escapeHTML(right)}" ${isTeacher()?'disabled':''}>${escapeHTML(right)}</button>`).join('')}</div></div><p class="match-description">${Object.keys(pairs).length} из 4 пар. Нажми на уже соединённое слово слева, чтобы изменить пару.</p>`;
    } else if (q.type==='order') {
      const order=Array.isArray(val)?val:[];
      const byId=Object.fromEntries(q.tokens.map(t=>[t.id,t.text]));
      content+=`<div class="big-prompt">${escapeHTML(q.prompt)}</div><div class="word-answer">${order.length?order.map(id=>`<button class="chip arranged" data-order-remove="${escapeHTML(id)}" ${isTeacher()?'disabled':''}>${escapeHTML(byId[id])} ×</button>`).join(''):'<span class="empty">Здесь появится твоё предложение...</span>'}</div><div class="chips">${q.tokens.filter(t=>!order.includes(t.id)).map(t=>`<button class="chip" data-order-add="${escapeHTML(t.id)}" ${isTeacher()?'disabled':''}>${escapeHTML(t.text)}</button>`).join('')}</div>`;
    } else if (q.type==='writing') {
      content+=`<div class="big-prompt">${escapeHTML(q.prompt)}</div><textarea id="writingAnswer" class="write-input" placeholder="${escapeHTML(q.placeholder)}" ${isTeacher()?'disabled':''}>${escapeHTML(val)}</textarea>`;
    }
    const response=room.answers[String(slide)];
    if (response?.submitted) {
      const grade=slide===5 ? room.manual?.['5'] : response.grade;
      const positive = grade===true || grade==='approved';
      const negative = grade===false || grade==='redo';
      const message=positive?'✓ Отлично! Ответ верный.':negative?'✦ Попробуй ещё раз. Обсуди решение с преподавателем.':'⏳ Ответ отправлен. Преподаватель проверит его.';
      content+=`<div class="evaluation ${negative?'bad':!positive?'wait':''}">${message}</div>`;
    }
    if (isTeacher()) {
      const correct= q.type==='match'?Object.entries(q.correct).map(([x,y])=>x+' — '+y).join(' · '):q.type==='order'?q.correct.map(id=>q.tokens.find(t=>t.id===id)?.text).join(' '):(q.correct||'Проверяется преподавателем');
      content+=`<div class="teacher-answer"><div class="key">🔑 КЛЮЧ ПРЕПОДАВАТЕЛЯ</div><p class="value">${escapeHTML(correct)}</p><p class="value" style="color:#9db5e2">Подсказка: ${escapeHTML(q.hint)}</p></div>`;
      if(response){
        let answerText=stringify(response.value);
        if(q.type==='match') answerText=Object.entries(response.value).map(([x,y])=>x+' → '+y).join(' · ') || 'Пары пока не выбраны';
        if(q.type==='order') answerText=response.value.map(id=>q.tokens.find(t=>t.id===id)?.text).join(' ') || 'Пока пусто';
        content+=`<div class="student-draft"><strong>${response.submitted?'✓ Ученик отправил ответ':'⌨ Ученик выполняет задание'}</strong><p>${escapeHTML(answerText||'Пока нет ответа')}</p></div>`;
      }
      if(q.type==='writing' && response?.submitted) content+=`<div class="teacher-grade"><button type="button" data-grade="approved">✓ Принять ответ</button><button type="button" data-grade="redo">↻ На доработку</button></div>`;
    }
    $('exerciseContent').innerHTML=header+content;
    let actions='';
    if(isTeacher()){
      actions=`<button type="button" class="secondary-btn" data-step="${Math.max(0,slide-1)}" ${slide===0?'disabled':''}>← Назад</button><button type="button" class="primary-btn" data-step="${Math.min(5,slide+1)}" ${slide===5?'disabled':''}>Следующее →</button>`;
    } else {
      actions=`<button type="button" class="primary-btn" id="submitAnswer" ${!hasValue(q,val)?'disabled':''}>${response?.submitted?'Проверить ещё раз ✓':'Проверить ответ →'}</button>`;
    }
    $('lessonActions').innerHTML=actions;
  }
  function hasValue(q,val){
    if (q.type==='match') return val && typeof val==='object' && Object.keys(val).length===4;
    if (q.type==='order') return Array.isArray(val) && val.length===4;
    return !!String(val||'').trim();
  }
  function setDraft(value, rerender=true) {
    draft[slide]=value;
    if (room?.answers?.[String(slide)]?.submitted) {
      room.answers[String(slide)]={value,submitted:false,grade:null};
    }
    if (rerender) renderLesson();
    clearTimeout(draftTimer);
    const at=slide;
    draftTimer=setTimeout(()=>{
      answerQueue=answerQueue.catch(()=>{}).then(()=>api('save_answer',{index:at,value:draft[at]})).catch(err=>toast('Не удалось сохранить ответ: '+err.message));
    },280);
    const btn=$('submitAnswer');
    if(btn) btn.disabled=!hasValue(questions[slide],value);
  }
  $('lessonTabs').addEventListener('click',event=>{
    const btn=event.target.closest('[data-step]');
    if(btn && isTeacher()) navigate(Number(btn.dataset.step));
  });
  $('lessonActions').addEventListener('click',async event=>{
    const step=event.target.closest('[data-step]');
    if(step && isTeacher()){navigate(Number(step.dataset.step));return;}
    if(event.target.closest('#submitAnswer')){
      const q=questions[slide], val=activeAnswer(), at=slide;
      if (!hasValue(q,val)) {toast('Сначала выполни задание.');return;}
      clearTimeout(draftTimer);
      const button=$('submitAnswer'); button.disabled=true;
      try{
        await (answerQueue=answerQueue.catch(()=>{}).then(()=>api('submit_answer',{index:at,value:val})));
        if(room) room.answers[String(at)]={value:val,submitted:true,grade:null};
        // Ask the server for authoritative grading on the next poll.
        toast(q.type==='writing'?'Ответ отправлен преподавателю.':'Ответ отправлен на проверку.');
      } catch(err){toast(err.message);}finally{renderLesson();}
    }
  });
  async function navigate(to){ try{await api('navigate',{slide:to});}catch(err){toast(err.message);} }
  $('exerciseContent').addEventListener('click',async event=>{
    const el=event.target.closest('button');if(!el)return;
    if (el.hasAttribute('data-option') && !isTeacher()) {setDraft(el.dataset.option);return;}
    if (el.hasAttribute('data-match-left') && !isTeacher()) {
      const word=el.dataset.matchLeft;
      if(matchSelected===word){matchSelected=null;}else{matchSelected=word;}
      renderLesson(); return;
    }
    if(el.hasAttribute('data-match-right') && !isTeacher()){
      const right=el.dataset.matchRight;
      if(!matchSelected){toast('Сначала выбери слово слева.');return;}
      const pairs={...(activeAnswer()||{})};
      Object.keys(pairs).forEach(left=>{if(pairs[left]===right)delete pairs[left];});
      pairs[matchSelected]=right;
      matchSelected=null;
      setDraft(pairs);return;
    }
    if(el.hasAttribute('data-order-add') && !isTeacher()) {setDraft([...(activeAnswer()||[]),el.dataset.orderAdd]);return;}
    if(el.hasAttribute('data-order-remove') && !isTeacher()) {setDraft((activeAnswer()||[]).filter(id=>id!==el.dataset.orderRemove));return;}
    if(el.dataset.control==='listen'){
      const text=questions[slide].audioText;
      if(!('speechSynthesis' in window)){toast('В этом браузере нет синтеза речи. Попроси преподавателя прочитать фразу.');return;}
      speechSynthesis.cancel();
      const msg=new SpeechSynthesisUtterance(text);msg.lang='en-US';msg.rate=.85;
      const voices=speechSynthesis.getVoices();
      const englishVoice=voices.find(v=>v.lang.startsWith('en'));
      if(englishVoice)msg.voice=englishVoice;
      speechSynthesis.speak(msg);return;
    }
    if(el.dataset.grade && isTeacher()){
      try{await api('grade_writing',{index:5,grade:el.dataset.grade});toast('Оценка отправлена ученику.');}catch(err){toast(err.message);}
    }
  });
  $('exerciseContent').addEventListener('input',event=>{
    if(isTeacher())return;
    if(event.target.id==='fillAnswer'||event.target.id==='writingAnswer')setDraft(event.target.value,false);
  });
  $('resetLesson').addEventListener('click',async()=>{
    if(!confirm('Сбросить все ответы и начать урок заново на обоих устройствах?'))return;
    try{await api('reset');draft={};matchSelected=null;toast('Ответы удалены, урок начат заново.');}catch(err){toast(err.message);}
  });

  // -------- WebRTC: direct P2P call, PHP acts only as a temporary signaling relay --------
  function setMediaStatus(message){$('mediaStatus').textContent=message;}
  function setIndicator(active, message){$('callIndicator').textContent=message;$('callIndicator').classList.toggle('active',active);}
  function renderVideoMode(){
    $('modeLabel').textContent=videoMode==='p2p'?'WebRTC P2P':'Jitsi (резерв)';
    $('jitsiOpen').hidden=videoMode!=='jitsi';
    if (jitsiRoom) $('jitsiOpen').href='https://meet.jit.si/'+encodeURIComponent(jitsiRoom);
    $('p2pModeBtn').classList.toggle('selected',videoMode==='p2p');
    $('jitsiModeBtn').classList.toggle('selected',videoMode==='jitsi');
  }
  $('p2pModeBtn').addEventListener('click',()=>changeMode('p2p'));
  $('jitsiModeBtn').addEventListener('click',()=>changeMode('jitsi'));
  async function changeMode(newMode){
    if(newMode===videoMode)return;
    try{await api('set_mode',{mode:newMode});shutdownMedia();videoMode=newMode;renderVideoMode();toast('Режим изменён для обоих участников. Каждый должен включить связь заново.');}
    catch(err){toast(err.message);}
  }
  $('startMedia').addEventListener('click',async()=>{
    if(mediaEnabled)return;
    if(videoMode==='jitsi'){await startJitsi();return;}
    if(!window.isSecureContext || !navigator.mediaDevices?.getUserMedia){
      setMediaStatus('Нужен HTTPS: сайт должен открываться по https://, не по http://');
      toast('Видеосвязь доступна только на HTTPS (или localhost).');return;
    }
    $('startMedia').disabled=true;
    setMediaStatus('Запрашиваем доступ к камере и микрофону…');
    try{
      localStream=await navigator.mediaDevices.getUserMedia({video:{facingMode:'user'},audio:{echoCancellation:true,noiseSuppression:true,autoGainControl:true}});
      $('localVideo').srcObject=localStream;
      $('localPreview').hidden=false;
      mediaEnabled=true;
      $('startMedia').hidden=true;
      $('stopMedia').hidden=false;
      setIndicator(false,'ОЖИДАНИЕ');
      setMediaStatus('Камера включена. Ожидаем второй аккаунт с активной камерой…');
    }catch(err){setMediaStatus('Не удалось получить камеру: '+err.message);toast('Проверь разрешения на камеру и микрофон.');}
    finally{$('startMedia').disabled=false;}
  });
  $('stopMedia').addEventListener('click',()=>{shutdownMedia();setMediaStatus('Связь завершена.');});
  function closePeer(){
    if(pc){try{pc.ontrack=null;pc.onicecandidate=null;pc.onconnectionstatechange=null;pc.close();}catch{}pc=null;}
    peerUid=null;
    iceBuffer=[];
    $('remoteVideo').srcObject=null;
    $('remoteVideo').hidden=true;
    $('remotePlaceholder').hidden=false;
    setIndicator(false,'ОЖИДАНИЕ');
  }
  function shutdownMedia(){
    mediaEnabled=false;
    closePeer();
    if(localStream){localStream.getTracks().forEach(t=>t.stop());localStream=null;}
    $('localVideo').srcObject=null;
    $('localPreview').hidden=true;
    if(jitsiAPI){try{jitsiAPI.dispose();}catch{}jitsiAPI=null;}
    jitsiJoined=false;
    $('jitsiContainer').innerHTML='';
    $('jitsiContainer').hidden=true;
    $('startMedia').hidden=false;
    $('startMedia').disabled=false;
    $('stopMedia').hidden=true;
    setIndicator(false,'НЕ В СЕТИ');
  }
  async function sendSignal(kind,value,toUid){
    try{await api('signal',{uid:clientUid,toUid,kind,value});}catch(err){console.warn('Signal failed',err);}
  }
  function createPeer(uid){
    closePeer();peerUid=uid;
    pc=new RTCPeerConnection({iceServers:[{urls:'stun:stun.l.google.com:19302'},{urls:'stun:stun1.l.google.com:19302'}]});
    for(const track of localStream.getTracks())pc.addTrack(track,localStream);
    const currentPc=pc;
    pc.onicecandidate=event=>{if(event.candidate && currentPc===pc)sendSignal('candidate',event.candidate.toJSON(),uid);};
    pc.ontrack=event=>{
      $('remoteVideo').srcObject=event.streams[0]||new MediaStream([event.track]);
      $('remoteVideo').hidden=false;
      $('remotePlaceholder').hidden=true;
      $('remoteVideo').play().catch(()=>setMediaStatus('Нажми на экран для включения звука удалённого участника.'));
    };
    pc.onconnectionstatechange=()=>{
      if(currentPc!==pc)return;
      const s=pc.connectionState;
      if(s==='connected'){setIndicator(true,'НА СВЯЗИ');setMediaStatus('Видео и звук соединены напрямую. Видеозапись не ведётся.');}
      else if(s==='failed'){setIndicator(false,'СБОЙ СВЯЗИ');setMediaStatus('Не удалось установить прямое соединение. Преподаватель может переключить класс на Jitsi.');}
      else if(s==='disconnected'){setIndicator(false,'ПЕРЕПОДКЛЮЧЕНИЕ');setMediaStatus('Связь временно пропала. Ждём восстановления…');}
      else if(s==='connecting'){setIndicator(false,'СОЕДИНЯЕМ');setMediaStatus('Соединяем устройства…');}
    };
    return pc;
  }
  async function initiateOffer(uid){
    if(!localStream || !uid || videoMode!=='p2p')return;
    try{
      const connection=createPeer(uid);
      const offer=await connection.createOffer();
      await connection.setLocalDescription(offer);
      await sendSignal('offer',connection.localDescription.toJSON(),uid);
      setMediaStatus('Отправлено приглашение ученику. Соединяем устройства…');
    }catch(err){setMediaStatus('Ошибка установления звонка: '+err.message);}
  }
  async function receiveSignal(signal){
    if(!mediaEnabled || videoMode!=='p2p' || signal.from!==other())return;
    try{
      if(signal.kind==='offer' && !isTeacher()){
        const savedCandidates=iceBuffer.filter(c=>c);
        const connection=createPeer(signal.fromUid);
        iceBuffer=savedCandidates;
        await connection.setRemoteDescription(new RTCSessionDescription(signal.value));
        const answer=await connection.createAnswer();
        await connection.setLocalDescription(answer);
        await sendSignal('answer',connection.localDescription.toJSON(),signal.fromUid);
        await flushICE();
        setMediaStatus('Подключаемся к преподавателю…');
      }else if(signal.kind==='answer' && isTeacher() && pc && peerUid===signal.fromUid){
        if(pc.signalingState==='have-local-offer'){
          await pc.setRemoteDescription(new RTCSessionDescription(signal.value));
          await flushICE();
        }
      }else if(signal.kind==='candidate' && signal.fromUid===peerUid){
        if(pc?.remoteDescription)await pc.addIceCandidate(new RTCIceCandidate(signal.value));
        else iceBuffer.push(signal.value);
      }else if(signal.kind==='bye' && signal.fromUid===peerUid){closePeer();}
    }catch(err){console.warn('WebRTC negotiation error',err);setMediaStatus('Ошибка согласования соединения: '+err.message);}
  }
  async function flushICE(){
    if(!pc?.remoteDescription)return;
    const candidates=iceBuffer.splice(0);
    for(const candidate of candidates){try{await pc.addIceCandidate(new RTCIceCandidate(candidate));}catch(err){console.warn('ICE',err);}}
  }

  // -------- Jitsi fallback: free public meet.jit.si is DEMO-ONLY and needs moderator sign-in --------
  function loadJitsiScript(){
    if(window.JitsiMeetExternalAPI)return Promise.resolve();
    return new Promise((resolve,reject)=>{
      let script=document.querySelector('script[data-jitsi]');
      if(script){script.addEventListener('load',resolve,{once:true});script.addEventListener('error',()=>reject(new Error('Jitsi недоступен')),{once:true});return;}
      script=document.createElement('script');script.src='https://meet.jit.si/external_api.js';script.async=true;script.dataset.jitsi='1';
      script.onload=resolve;script.onerror=()=>reject(new Error('Не удалось загрузить Jitsi. Проверь интернет и блокировщики.'));
      document.head.appendChild(script);
    });
  }
  async function startJitsi(){
    $('startMedia').disabled=true;
    setMediaStatus('Открываем резервную видеокомнату Jitsi…');
    try{
      await loadJitsiScript();
      const container=$('jitsiContainer');
      container.hidden=false;
      $('remotePlaceholder').hidden=true;
      jitsiAPI=new window.JitsiMeetExternalAPI('meet.jit.si',{
        roomName:jitsiRoom,
        width:'100%',height:'100%',parentNode:container,
        userInfo:{displayName:role==='teacher'?'WOW SCHOOL · Преподаватель':'WOW SCHOOL · Ученик'},
        lang:'ru',
        configOverwrite:{prejoinConfig:{enabled:true},startWithAudioMuted:false,startWithVideoMuted:false},
      });
      jitsiAPI.addListener('videoConferenceJoined',()=>{jitsiJoined=true;setIndicator(true,'JITSI LIVE');setMediaStatus('Резервная видеосвязь работает.');});
      jitsiAPI.addListener('videoConferenceLeft',()=>{jitsiJoined=false;setIndicator(false,'ЗАВЕРШЕНО');});
      mediaEnabled=true;
      $('startMedia').hidden=true;
      $('stopMedia').hidden=false;
      setMediaStatus('Ожидаем присоединения. Для открытия комнаты на meet.jit.si ведущему может понадобиться вход в Google, GitHub или Facebook.');
    }catch(err){setMediaStatus(err.message);toast(err.message);$('jitsiContainer').hidden=true;$('remotePlaceholder').hidden=false;}
    finally{$('startMedia').disabled=false;}
  }
  // Fallback for browsers that won't play a remote media stream until a gesture.
  $('videoStage').addEventListener('click',()=>{
    if(!$('remoteVideo').hidden)$('remoteVideo').play().catch(()=>{});
  });
  window.addEventListener('pagehide',()=>{shutdownMedia();running=false;clearTimeout(pollTimer);});
  if(boot.logged && role){showApp();}
})();
