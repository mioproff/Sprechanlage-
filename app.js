// Sprechanlage — einfache, editierbare Demo
// Hinweise: Viele Browser erfordern HTTPS oder localhost für device selection / setSinkId.

const state = {
  audioObjects: {}, // keys: 'schulgong','gong2','alarm'
  active: new Set(),
  inputDeviceId: null,
  outputDeviceId: null,
  micStream: null,
  micAudioCtx: null,
  micAnalyser: null,
  micMeterAnim: null,
  locked: true,
};

function $(id){return document.getElementById(id)}

function updateDateTime(){
  const el = $('datetime');
  const now = new Date();
  try{
    el.textContent = now.toLocaleString('de-DE', {dateStyle:'full', timeStyle:'medium'});
  }catch(e){ el.textContent = now.toLocaleString(); }
}
setInterval(updateDateTime,1000);
updateDateTime();

// Active list UI
function addActive(name){
  state.active.add(name);
  renderActive();
}
function removeActive(name){
  state.active.delete(name);
  renderActive();
}
function renderActive(){
  const ul = $('active-list'); ul.innerHTML='';
  state.active.forEach(a=>{
    const li=document.createElement('li');
    li.textContent=a;
    const btn=document.createElement('button');btn.textContent='Stop';
    btn.onclick=()=>stopByName(a);
    li.appendChild(btn);
    ul.appendChild(li);
  });
}

function stopByName(name){
  // stop audio object if exists
  const ao = state.audioObjects[name];
  if(ao && ao.audio){ ao.audio.pause(); ao.audio.currentTime=0; }
  removeActive(name);
}

// Play uploaded file for a key
async function playFile(key){
  let obj = state.audioObjects[key];
  if(!obj){
    alert('Keine Datei für '+key);
    return;
  }
  if(!obj.url && obj.dataUrl){
    const blob = dataURLToBlob(obj.dataUrl);
    obj.url = URL.createObjectURL(blob);
    state.audioObjects[key] = obj;
  }
  if(!obj.url){
    alert('Keine Datei für '+key);
    return;
  }
  // reuse audio element
  if(!obj.audio){
    obj.audio = new Audio();
    obj.audio.src = obj.url;
    obj.audio.onended = ()=>removeActive(key);
  } else if(obj.audio.src !== obj.url){
    obj.audio.src = obj.url;
  }
  // set sinkId if possible
  try{
    if(state.outputDeviceId && typeof obj.audio.setSinkId === 'function'){
      await obj.audio.setSinkId(state.outputDeviceId);
    }
  }catch(e){console.warn('setSinkId failed',e)}
  obj.audio.currentTime=0;
  obj.audio.play();
  addActive(key);
}

function dataURLToBlob(dataURL){
  const parts = dataURL.split(',');
  const header = parts[0];
  const base64 = parts[1];
  const mime = header.match(/:(.*?);/)[1];
  const binary = atob(base64);
  const len = binary.length;
  const buffer = new Uint8Array(len);
  for(let i=0;i<len;i++){ buffer[i] = binary.charCodeAt(i); }
  return new Blob([buffer], {type:mime});
}

function saveAudioData(key, file, dataURL, displayName){
  try{
    const payload = {name:file.name, dataURL, displayName};
    localStorage.setItem('spa_audio_' + key, JSON.stringify(payload));
  }catch(e){ console.warn('Audio persistieren fehlgeschlagen', e); }
}

function loadPersistedAudio(key, fileStatusId, mainStatusId, renameId){
  const item = localStorage.getItem('spa_audio_' + key);
  if(!item) return;
  try{
    const parsed = JSON.parse(item);
    if(!parsed || !parsed.dataURL) return;
    const blob = dataURLToBlob(parsed.dataURL);
    const url = URL.createObjectURL(blob);
    state.audioObjects[key] = {file:null, url, dataUrl: parsed.dataURL, name: parsed.name || ''};
    const statusFiles = $(fileStatusId);
    const statusMain = $(mainStatusId);
    const label = parsed.name || 'Gespeichert';
    if(statusFiles) statusFiles.textContent = label;
    if(statusMain) statusMain.textContent = label;
    if(key === 'alarm'){
      const emergencyBtn = $('emergency-btn');
      if(emergencyBtn){ emergencyBtn.disabled = false; emergencyBtn.title = 'Notfall'; }
    }
  }catch(e){ console.warn('Persisted audio wiederherstellen fehlgeschlagen', e); }
}

function restorePersistedAudio(){
  const uploads = [
    ['schulgong','files-status-schulgong','status-schulgong'],
    ['gong2','files-status-gong2','status-gong2'],
    ['gong3','files-status-gong3','status-gong3'],
    ['gong4','files-status-gong4','status-gong4'],
    ['gong5','files-status-gong5','status-gong5'],
    ['durchsage','files-status-durchsage','status-durchsage'],
    ['alarm','files-status-alarm','status-alarm'],
  ];
  uploads.forEach(([key,fileStatusId,mainStatusId])=>loadPersistedAudio(key,fileStatusId,mainStatusId));
}

// Handle uploads (single implementation)
function attachUpload(id, key, fileStatusId, mainStatusId){
  const input = $(id);
  if(!input) return;
  input.addEventListener('change', e=>{
    const f = e.target.files && e.target.files[0];
    const statusFiles = $(fileStatusId);
    const statusMain = $(mainStatusId);
    if(!f) return;
    if(state.audioObjects[key] && state.audioObjects[key].url){ URL.revokeObjectURL(state.audioObjects[key].url); }
    const url = URL.createObjectURL(f);
    state.audioObjects[key] = {file:f, url};
    if(statusFiles) statusFiles.textContent = f.name;
    if(statusMain) statusMain.textContent = f.name;
    if(key === 'alarm'){
      const emergencyBtn = $('emergency-btn');
      if(emergencyBtn){
        emergencyBtn.disabled = false;
        emergencyBtn.title = 'Notfall';
      }
    }
    const reader = new FileReader();
    reader.onload = ()=>{ saveAudioData(key, f, reader.result); };
    reader.readAsDataURL(f);
  });
}

// TTS
function speakText(text){
  if(!text) return;
  const utter = new SpeechSynthesisUtterance(text);
  speechSynthesis.cancel();
  speechSynthesis.speak(utter);
  addActive('TTS');
  utter.onend = ()=>removeActive('TTS');
}

// Push to talk (hold button)
async function startMic(){
  if(state.micStream) return;
  try{
    const constraints = {audio:{}}
    if(state.inputDeviceId) constraints.audio.deviceId = {exact:state.inputDeviceId};
    const stream = await navigator.mediaDevices.getUserMedia(constraints);
    state.micStream = stream;
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    const audioCtx = new AudioCtx();
    const source = audioCtx.createMediaStreamSource(stream);
    const analyser = audioCtx.createAnalyser();
    analyser.fftSize = 256;
    source.connect(analyser);
    state.micAudioCtx = audioCtx;
    state.micAnalyser = analyser;
    state.micMeterAnim = requestAnimationFrame(updateMicMeter);
    const visualizer = $('mic-visualizer'); if(visualizer) visualizer.classList.add('active');
    addActive('Live-Mic');
  }catch(e){console.error(e); alert('Mikrofonzugriff verweigert oder Gerät fehlt');}
}
function stopMic(){
  if(state.micStream){
    state.micStream.getTracks().forEach(t=>t.stop());
    state.micStream=null;
  }
  if(state.micMeterAnim){ cancelAnimationFrame(state.micMeterAnim); state.micMeterAnim=null; }
  if(state.micAudioCtx){ state.micAudioCtx.close().catch(()=>{}); state.micAudioCtx=null; }
  state.micAnalyser = null;
  const visualizer = $('mic-visualizer'); if(visualizer) visualizer.classList.remove('active');
  document.querySelectorAll('.mic-bar').forEach(bar=>{ bar.style.height='14px'; });
  removeActive('Live-Mic');
}

function updateMicMeter(){
  if(!state.micAnalyser) return;
  const dataArray = new Uint8Array(state.micAnalyser.fftSize);
  state.micAnalyser.getByteTimeDomainData(dataArray);
  const barEls = document.querySelectorAll('.mic-bar');
  const barCount = barEls.length;
  const segment = Math.floor(dataArray.length / barCount);
  barEls.forEach((bar, index) => {
    let sum = 0;
    const start = index * segment;
    const end = Math.min(dataArray.length, start + segment);
    for(let i = start; i < end; i++){ sum += Math.abs(dataArray[i] - 128); }
    const avg = sum / (end - start || 1);
    const level = Math.min(1, avg / 64);
    const height = 14 + level * 68;
    bar.style.height = height + 'px';
  });
  state.micMeterAnim = requestAnimationFrame(updateMicMeter);
}

// Settings / devices
async function scanDevices(){
  const devices = await navigator.mediaDevices.enumerateDevices();
  const inputs = devices.filter(d=>d.kind==='audioinput');
  const outputs = devices.filter(d=>d.kind==='audiooutput');
  const si = $('select-input'); si.innerHTML='';
  inputs.forEach(i=>{ const opt=document.createElement('option'); opt.value=i.deviceId; opt.textContent=i.label||('Mic '+(si.length+1)); si.appendChild(opt);} );
  const so = $('select-output'); so.innerHTML='';
  outputs.forEach(o=>{ const opt=document.createElement('option'); opt.value=o.deviceId; opt.textContent=o.label||('Speaker '+(so.length+1)); so.appendChild(opt);} );
  // restore saved
  const savedIn = localStorage.getItem('spa_input');
  const savedOut = localStorage.getItem('spa_output');
  if(savedIn) si.value = savedIn;
  if(savedOut) so.value = savedOut;
}

function openSettings(){ $('settings-modal').classList.remove('hidden'); scanDevices(); }
function closeSettings(){ $('settings-modal').classList.add('hidden'); }
function saveSettings(){
  const inId = $('select-input').value;
  const outId = $('select-output').value;
  state.inputDeviceId = inId || null; state.outputDeviceId = outId || null;
  localStorage.setItem('spa_input', state.inputDeviceId || '');
  localStorage.setItem('spa_output', state.outputDeviceId || '');
  alert('Einstellungen gespeichert');
  closeSettings();
}

// Wire UI
document.addEventListener('DOMContentLoaded', ()=>{
  restorePersistedAudio();
  attachUpload('upload-schulgong','schulgong','files-status-schulgong','status-schulgong');
  attachUpload('upload-gong2','gong2','files-status-gong2','status-gong2');
  attachUpload('upload-alarm','alarm','files-status-alarm','status-alarm');
  attachUpload('upload-gong3','gong3','files-status-gong3','status-gong3');
  attachUpload('upload-gong4','gong4','files-status-gong4','status-gong4');
  attachUpload('upload-gong5','gong5','files-status-gong5','status-gong5');
  attachUpload('upload-durchsage','durchsage','files-status-durchsage','status-durchsage');

  $('play-schulgong').addEventListener('click', ()=>playFile('schulgong'));
  $('play-gong2').addEventListener('click', ()=>playFile('gong2'));
  $('play-alarm').addEventListener('click', ()=>playFile('alarm'));
  // more gongs
  const g3 = $('play-gong3'); if(g3) g3.addEventListener('click', ()=>playFile('gong3'));
  const g4 = $('play-gong4'); if(g4) g4.addEventListener('click', ()=>playFile('gong4'));
  const g5 = $('play-gong5'); if(g5) g5.addEventListener('click', ()=>playFile('gong5'));
  const g6 = $('play-durchsage'); if(g6) g6.addEventListener('click', ()=>playFile('durchsage'));

  $('speak-tts').addEventListener('click', ()=>{
    speakText($('tts-text').value);
  });

  const ptt = $('push-to-talk');
  ptt.addEventListener('mousedown', ()=>startMic());
  ptt.addEventListener('touchstart', ()=>startMic());
  ptt.addEventListener('mouseup', ()=>stopMic());
  ptt.addEventListener('mouseleave', ()=>stopMic());
  ptt.addEventListener('touchend', ()=>stopMic());

  // 'open-settings' removed; gear icon registered below
  $('close-settings').addEventListener('click', closeSettings);
  $('save-settings').addEventListener('click', saveSettings);
  const gear = $('gear-settings'); if(gear) gear.addEventListener('click', ()=>{
    openSettings();
    // ensure devices tab is shown when opening via gear
    const t = document.querySelector('.tabs .tab[data-tab="devices"]');
    if(t) t.click();
  });

  const emergencyBtn = $('emergency-btn');
  const emergencyStatus = $('emergency-status');
  if(emergencyBtn){ emergencyBtn.disabled = true; emergencyBtn.title = 'Notfalldatei auswählen'; }
  let emergencyConfirm = false;
  let emergencyTimeout = null;
  let emergencyMessageTimeout = null;
  function setEmergencyStatus(text, active = false, autoClear = 3000){
    if(!emergencyStatus) return;
    emergencyStatus.textContent = text;
    emergencyStatus.classList.toggle('active', active);
    if(emergencyMessageTimeout){ clearTimeout(emergencyMessageTimeout); emergencyMessageTimeout = null; }
    if(autoClear){ emergencyMessageTimeout = setTimeout(()=>{
      if(emergencyStatus) emergencyStatus.textContent = 'Datei wählen, dann drücken.';
      if(emergencyStatus) emergencyStatus.classList.remove('active');
    }, autoClear); }
  }
  function resetEmergencyButton(){
    emergencyConfirm = false;
    if(!emergencyBtn) return;
    emergencyBtn.classList.remove('confirm');
    emergencyBtn.textContent = 'NOTFALL';
    emergencyBtn.title = 'Notfall';
    setEmergencyStatus('Datei wählen, dann drücken.', false, 0);
  }
  if(emergencyBtn){
    emergencyBtn.addEventListener('click', ()=>{
      if(emergencyConfirm){
        resetEmergencyButton();
        if(state.audioObjects.alarm && state.audioObjects.alarm.url){
          playFile('alarm');
        }
        setEmergencyStatus('Notfall ausgelöst', true, 2500);
        return;
      }
      emergencyConfirm = true;
      emergencyBtn.classList.add('confirm');
      emergencyBtn.textContent = 'NOCHMALS DRÜCKEN';
      emergencyBtn.title = 'Nochmals drücken zum Bestätigen';
      setEmergencyStatus('Erneut drücken zum Bestätigen', true, 4000);
      clearTimeout(emergencyTimeout);
      emergencyTimeout = setTimeout(resetEmergencyButton, 4000);
    });
  }
  
  // permission & device test helpers
  async function requestMicrophonePermission(){
    try{
      const s = await navigator.mediaDevices.getUserMedia({audio:true});
      s.getTracks().forEach(t=>t.stop());
      await scanDevices();
      alert('Mikrofonberechtigung erteilt. Geräte aktualisiert.');
    }catch(e){
      console.warn(e);
      alert('Zugriff verweigert oder kein Mikrofon verfügbar.');
    }
  }

  let micTest = {stream:null, el:null};
  async function testMic(){
    const sel = $('select-input'); if(!sel){ alert('Kein Eingabegerät Auswahlfeld gefunden'); return; }
    const deviceId = sel.value;
    try{
      const constraints = {audio:{}};
      if(deviceId) constraints.audio.deviceId = {exact:deviceId};
      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      // stop previous
      stopMicTest();
      const audioEl = document.createElement('audio'); audioEl.autoplay=true; audioEl.controls=true; audioEl.srcObject = stream;
      const container = $('mic-audio-container'); if(container){ container.innerHTML=''; container.appendChild(audioEl); $('mic-preview').style.display='block'; }
      micTest.stream = stream; micTest.el = audioEl;
    }catch(e){ console.error(e); alert('Mikrofon Test fehlgeschlagen: '+(e.message||e)); }
  }
  function stopMicTest(){ if(micTest.stream){ micTest.stream.getTracks().forEach(t=>t.stop()); micTest.stream=null; } if(micTest.el){ micTest.el.remove(); micTest.el=null; } const container = $('mic-audio-container'); if(container) container.innerHTML=''; const preview = $('mic-preview'); if(preview) preview.style.display='none'; }

  async function testSpeaker(){
    const sel = $('select-output'); const outId = sel ? sel.value : null;
    try{
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      const ctx = new AudioCtx();
      const osc = ctx.createOscillator();
      const dest = ctx.createMediaStreamDestination();
      osc.type = 'sine'; osc.frequency.value = 880;
      osc.connect(dest);
      osc.start();
      const audioEl = document.createElement('audio'); audioEl.autoplay = true; audioEl.srcObject = dest.stream;
      if(outId && typeof audioEl.setSinkId === 'function'){
        try{ await audioEl.setSinkId(outId); }catch(e){ console.warn('setSinkId on test audio failed', e); }
      }
      document.body.appendChild(audioEl);
      setTimeout(()=>{ try{ osc.stop(); audioEl.remove(); ctx.close(); }catch(e){} }, 800);
    }catch(e){ console.error(e); alert('Lautsprecher Test fehlgeschlagen: '+(e.message||e)); }
  }

  // wire test buttons
  const btnPerm = $('btn-request-perm'); if(btnPerm) btnPerm.addEventListener('click', requestMicrophonePermission);
  const btnTestMic = $('btn-test-mic'); if(btnTestMic) btnTestMic.addEventListener('click', testMic);
  const btnTestSpeaker = $('btn-test-speaker'); if(btnTestSpeaker) btnTestSpeaker.addEventListener('click', testSpeaker);

  // tab switching in settings modal
  document.querySelectorAll('.tabs .tab').forEach(t=>{
    t.addEventListener('click', ()=>{
      document.querySelectorAll('.tabs .tab').forEach(x=>x.classList.remove('active'));
      t.classList.add('active');
      const tab = t.getAttribute('data-tab');
      document.querySelectorAll('.tab-content').forEach(tc=>tc.classList.add('hidden'));
      const show = document.getElementById('tab-'+tab);
      if(show) show.classList.remove('hidden');
    });
  });

  // initial device list (may be empty until permissions)
  if(navigator.mediaDevices && navigator.mediaDevices.enumerateDevices){
    navigator.mediaDevices.addEventListener('devicechange', scanDevices);
    scanDevices().catch(()=>{});
  }

  // initialize locked UI
  const panel = document.querySelector('.panel');
   const lockOverlay = $('lock-overlay');
   if(state.locked){ panel.classList.add('locked'); if(lockOverlay) lockOverlay.classList.remove('hidden'); }
   else if(lockOverlay){ lockOverlay.classList.add('hidden'); }
 
   // numpad logic
   const codeTarget = '2013';
   let codeBuffer = '';
   const mask = $('numpad-mask');
   function updateMask(){ if(!mask) return; mask.textContent = '*'.repeat(codeBuffer.length) || '----'; }
   function unlockPanel(){ state.locked=false; panel.classList.remove('locked'); if(lockOverlay) lockOverlay.classList.add('hidden'); codeBuffer=''; updateMask(); alert('Entsperrt'); }
   document.querySelectorAll('.numpad button.num').forEach(b=>{
     b.addEventListener('click', ()=>{
       if(!state.locked) return; codeBuffer += b.textContent.trim(); if(codeBuffer.length>8) codeBuffer = codeBuffer.slice(-8); updateMask();
     });
   });
   const clearBtn = $('numpad-clear'); if(clearBtn) clearBtn.addEventListener('click', ()=>{ codeBuffer=''; updateMask(); });
   const enterBtn = $('numpad-enter'); if(enterBtn) enterBtn.addEventListener('click', ()=>{
     if(!state.locked) return;
     if(codeBuffer===codeTarget){ unlockPanel(); }else{ alert('Falscher Code'); codeBuffer=''; updateMask(); }
   });
   updateMask();
 });