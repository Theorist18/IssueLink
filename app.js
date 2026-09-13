/* ==========================================================
   IssueLink — Data Layer (shared by app.js and admin.js)
   ========================================================== */
const IL_KEYS = {
  reports:'issuelink_reports', issues:'issuelink_issues', updates:'issuelink_updates',
  confirmations:'issuelink_confirmations', categories:'issuelink_categories',
  departments:'issuelink_departments', settings:'issuelink_settings', session:'issuelink_session'
};

const DEFAULT_CATEGORIES = ["Road Damage","Garbage","Flooding","Drainage","Streetlight","Water Supply","Electricity","Public Facility","Traffic/Signage","Safety Hazard","Trees/Vegetation","Other"];
const CATEGORY_ICONS = {"Road Damage":"fa-road","Garbage":"fa-trash","Flooding":"fa-water","Drainage":"fa-toilet-portable","Streetlight":"fa-lightbulb","Water Supply":"fa-faucet-drip","Electricity":"fa-bolt","Public Facility":"fa-building","Traffic/Signage":"fa-traffic-light","Safety Hazard":"fa-triangle-exclamation","Trees/Vegetation":"fa-tree","Other":"fa-circle-question"};
const DEFAULT_DEPARTMENTS = ["Public Works","Sanitation","Utilities","Engineering","Public Safety","Parks & Environment"];
const DEFAULT_ADMINS = [{AdminID:'A1',Name:'System Administrator',Email:'admin@issuelink.local',Password:'admin123',Role:'Super Admin',Department:'',Status:'Active',CreatedAt:Date.now(),LastLogin:null}];

function ilStorageAvailable(){
  try{
    const test='__issuelink_storage_test__';
    localStorage.setItem(test,'1');
    localStorage.removeItem(test);
    return true;
  }catch(e){
    console.error('IssueLink: localStorage is unavailable.', e);
    return false;
  }
}
function ilLoad(key, fallback){
  try{
    const raw = localStorage.getItem(key);
    if(raw === null || raw === '') return fallback;
    const parsed = JSON.parse(raw);
    return parsed === null || parsed === undefined ? fallback : parsed;
  }catch(e){ console.warn('IssueLink: unable to read local data for', key, e); return fallback; }
}
function ilSave(key, value){
  try{
    localStorage.setItem(key, JSON.stringify(value));
    // Read-after-write verification prevents silent failures.
    return localStorage.getItem(key) !== null;
  }catch(e){
    console.error('IssueLink storage error', e);
    return false;
  }
}
const IL_STORAGE_READY = ilStorageAvailable();
function ilInit(){
  if(!IL_STORAGE_READY){
    console.warn('IssueLink is running without persistent localStorage. Use a normal web origin (GitHub Pages/localhost) instead of a restricted file origin.');
    return;
  }
  if(localStorage.getItem(IL_KEYS.reports)===null) ilSave(IL_KEYS.reports, []);
  if(localStorage.getItem(IL_KEYS.issues)===null) ilSave(IL_KEYS.issues, []);
  if(localStorage.getItem(IL_KEYS.updates)===null) ilSave(IL_KEYS.updates, []);
  if(localStorage.getItem(IL_KEYS.confirmations)===null) ilSave(IL_KEYS.confirmations, []);
  if(localStorage.getItem(IL_KEYS.categories)===null) ilSave(IL_KEYS.categories, DEFAULT_CATEGORIES.map((c,i)=>({CategoryID:'C'+(i+1),CategoryName:c,Description:'',Active:true})));
  if(localStorage.getItem(IL_KEYS.departments)===null) ilSave(IL_KEYS.departments, DEFAULT_DEPARTMENTS.map((d,i)=>({DepartmentID:'D'+(i+1),DepartmentName:d,Description:'',Active:true})));
  if(localStorage.getItem(IL_KEYS.settings)===null) ilSave(IL_KEYS.settings, {storageMode:'Local Only', scriptUrl:'', lastSync:null, admins:DEFAULT_ADMINS});
  else { // ensure admins array exists on older settings
    const s = ilLoad(IL_KEYS.settings,{});
    if(!s.admins){ s.admins = DEFAULT_ADMINS; ilSave(IL_KEYS.settings, s); }
  }
}
ilInit();

function ilId(prefix, len){
  const chars='ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let s='';
  for(let i=0;i<(len||5);i++) s+=chars[Math.floor(Math.random()*chars.length)];
  return prefix+s;
}
function ilNextIssueNum(){
  const issues = ilLoad(IL_KEYS.issues, []);
  let max = 1000;
  issues.forEach(i=>{ const n = parseInt((i.IssueID||'').replace('IL-','')); if(!isNaN(n) && n>max) max=n; });
  return 'IL-'+(max+1);
}

function ilGetReports(){ return ilLoad(IL_KEYS.reports, []); }
function ilGetIssues(){ return ilLoad(IL_KEYS.issues, []); }
function ilGetUpdates(){ return ilLoad(IL_KEYS.updates, []); }
function ilGetConfirmations(){ return ilLoad(IL_KEYS.confirmations, []); }
function ilGetCategories(){ return ilLoad(IL_KEYS.categories, []).filter(c=>c.Active!==false); }
function ilGetDepartments(){ return ilLoad(IL_KEYS.departments, []).filter(d=>d.Active!==false); }
function ilGetSettings(){ return ilLoad(IL_KEYS.settings, {}); }

/* ---------------- Google Sheets Cloud Sync ---------------- */
const IL_PENDING_KEY = 'issuelink_pending_reports';
function ilNormalizeScriptUrl(url){
  return String(url||'').trim().replace(/[?#].*$/,'');
}
function ilGetCloudScriptUrl(){
  const fromQuery = new URLSearchParams(window.location.search).get('script');
  const settings = ilGetSettings();
  const url = ilNormalizeScriptUrl(fromQuery || settings.scriptUrl || '');
  if(fromQuery && url && settings.scriptUrl !== url){
    settings.scriptUrl = url;
    ilSave(IL_KEYS.settings, settings);
  }
  return url;
}
function ilCloudEnabled(){ return !!ilGetCloudScriptUrl(); }
async function ilCloudGet(action){
  const base = ilGetCloudScriptUrl();
  if(!base) throw new Error('Google Sheets Web App URL is not configured.');
  const response = await fetch(base+'?action='+encodeURIComponent(action), {method:'GET', redirect:'follow', cache:'no-store'});
  if(!response.ok) throw new Error('HTTP '+response.status);
  const result = await response.json();
  if(!result || result.ok===false) throw new Error(result?.error || 'Cloud request failed.');
  return result;
}
async function ilCloudPost(action, payload={}){
  const base = ilGetCloudScriptUrl();
  if(!base) throw new Error('Google Sheets Web App URL is not configured.');
  const response = await fetch(base, {
    method:'POST',
    headers:{'Content-Type':'text/plain;charset=utf-8'},
    body:JSON.stringify(Object.assign({action}, payload)),
    redirect:'follow',
    cache:'no-store'
  });
  if(!response.ok) throw new Error('HTTP '+response.status);
  const result = await response.json();
  if(!result || result.ok===false) throw new Error(result?.error || 'Cloud request failed.');
  return result;
}
function ilMergeRecords(localRows, serverRows, idField){
  const map = new Map();
  (serverRows||[]).forEach(row=>{ if(row && row[idField]) map.set(String(row[idField]), row); });
  (localRows||[]).forEach(row=>{
    if(!row || !row[idField]) return;
    const key=String(row[idField]);
    if(!map.has(key)) map.set(key,row);
  });
  return Array.from(map.values());
}
function ilApplyCloudData(data, preserveLocal=true){
  if(!data) return;
  if(Array.isArray(data.reports)) ilSave(IL_KEYS.reports, preserveLocal ? ilMergeRecords(ilGetReports(),data.reports,'ReportID') : data.reports);
  if(Array.isArray(data.issues)) ilSave(IL_KEYS.issues, preserveLocal ? ilMergeRecords(ilGetIssues(),data.issues,'IssueID') : data.issues);
  if(Array.isArray(data.updates)) ilSave(IL_KEYS.updates, preserveLocal ? ilMergeRecords(ilGetUpdates(),data.updates,'UpdateID') : data.updates);
  if(Array.isArray(data.confirmations)) ilSave(IL_KEYS.confirmations, preserveLocal ? ilMergeRecords(ilGetConfirmations(),data.confirmations,'ConfirmationID') : data.confirmations);
  if(Array.isArray(data.categories) && data.categories.length) ilSave(IL_KEYS.categories,data.categories);
  if(Array.isArray(data.departments) && data.departments.length) ilSave(IL_KEYS.departments,data.departments);
}
async function ilPullFromCloud(){
  if(!ilCloudEnabled()) return {ok:false, skipped:true};
  const data = await ilCloudGet('getAll');
  ilApplyCloudData(data,true);
  return data;
}
async function ilUploadPhotoIfNeeded(report){
  if(!Array.isArray(report.PhotoURLs)) return report;
  const photos=[];
  for(let i=0;i<report.PhotoURLs.length;i++){
    const photo=report.PhotoURLs[i];
    if(typeof photo==='string' && photo.indexOf('data:image/')===0){
      const up=await ilCloudPost('uploadPhoto',{base64:photo,filename:(report.ReportCode||report.ReportID)+'_'+(i+1)+'.jpg',mimeType:'image/jpeg'});
      if(!up.url) throw new Error('Photo upload returned no URL.');
      photos.push(up.url);
    }else if(photo) photos.push(photo);
  }
  return Object.assign({},report,{PhotoURLs:photos});
}
async function ilPushReportToCloud(report){
  const cloudReport = await ilUploadPhotoIfNeeded(report);
  const result = await ilCloudPost('saveReport',{report:cloudReport});
  const reports = ilGetReports();
  const idx = reports.findIndex(r=>r.ReportID===report.ReportID);
  if(idx>=0) reports[idx]=Object.assign({},reports[idx],cloudReport);
  else reports.push(cloudReport);
  ilSave(IL_KEYS.reports,reports);
  const pending=ilLoad(IL_PENDING_KEY,[]).filter(r=>r.ReportID!==report.ReportID);
  ilSave(IL_PENDING_KEY,pending);
  return result;
}
async function ilSyncResidents(){
  if(!ilCloudEnabled()) return {ok:false, skipped:true};
  // First pull the latest centralized data.
  await ilPullFromCloud();
  // Retry reports that were saved locally when the network was unavailable.
  const pending=ilLoad(IL_PENDING_KEY,[]);
  for(const report of pending){
    try{ await ilPushReportToCloud(report); }catch(e){ console.warn('IssueLink pending report sync failed:',e); break; }
  }
  await ilPullFromCloud();
  return {ok:true};
}
function ilRememberPendingReport(report){
  const pending=ilLoad(IL_PENDING_KEY,[]);
  if(!pending.some(r=>r.ReportID===report.ReportID)) pending.push(report);
  ilSave(IL_PENDING_KEY,pending);
}

function ilAddTimeline(issueId, status, message, internal, updatedBy){
  const updates = ilGetUpdates();
  updates.push({UpdateID:ilId('U',6), IssueID:issueId, Status:status, Message:message||'', UpdatedBy:updatedBy||'System', UpdatedAt:Date.now(), Internal:!!internal});
  ilSave(IL_KEYS.updates, updates);
}

function haversineKm(lat1,lon1,lat2,lon2){
  if([lat1,lon1,lat2,lon2].some(v=>v===null||v===undefined||isNaN(v))) return null;
  const R=6371, toRad=d=>d*Math.PI/180;
  const dLat=toRad(lat2-lat1), dLon=toRad(lon2-lon1);
  const a=Math.sin(dLat/2)**2+Math.cos(toRad(lat1))*Math.cos(toRad(lat2))*Math.sin(dLon/2)**2;
  return R*2*Math.atan2(Math.sqrt(a),Math.sqrt(1-a));
}
function wordOverlapScore(a,b){
  const wa = new Set((a||'').toLowerCase().match(/[a-z0-9]{3,}/g)||[]);
  const wb = new Set((b||'').toLowerCase().match(/[a-z0-9]{3,}/g)||[]);
  if(wa.size===0||wb.size===0) return 0;
  let common=0; wa.forEach(w=>{ if(wb.has(w)) common++; });
  return common/Math.max(wa.size,wb.size);
}
// Matching score between an unlinked report and an issue (or another report acting as seed)
function ilMatchScore(report, target){
  let locScore=0;
  if(report.Latitude && report.Longitude && target.Latitude && target.Longitude){
    const km = haversineKm(report.Latitude,report.Longitude,target.Latitude,target.Longitude);
    if(km!==null) locScore = Math.max(0, 1-(km/1.0)); // within ~1km scales down
  } else if(report.LocationText && target.LocationText && report.LocationText.toLowerCase()===target.LocationText.toLowerCase()){
    locScore = 0.7;
  }
  const catScore = (report.Category && target.Category && report.Category===target.Category) ? 1 : 0;
  const descScore = wordOverlapScore((report.Title||'')+' '+(report.Description||''), (target.Title||'')+' '+(target.Description||''));
  const t1 = report.SubmittedAt || Date.now();
  const t2 = target.SubmittedAt || target.CreatedAt || Date.now();
  const daysApart = Math.abs(t1-t2)/86400000;
  const timeScore = Math.max(0, 1-(daysApart/14));
  const total = locScore*0.4 + catScore*0.3 + descScore*0.2 + timeScore*0.1;
  return {total: Math.round(total*100), locScore:Math.round(locScore*100), catScore:Math.round(catScore*100), descScore:Math.round(descScore*100), timeScore:Math.round(timeScore*100)};
}

function ilComputePriority(issue){
  const sevMap = {Low:15, Medium:35, High:65, Critical:90};
  let score = sevMap[issue.HighestSeverity] || 30;
  score += Math.min(20, (issue.AffectedCount||0)*2);
  score += Math.min(15, (issue.LinkedReportCount||1-1)*3);
  if(issue.HighestSeverity==='Critical') score += 10;
  const ageDays = (Date.now()-(issue.CreatedAt||Date.now()))/86400000;
  if(!['Resolved'].includes(issue.Status)) score += Math.min(15, ageDays*0.5);
  score = Math.max(0, Math.min(100, Math.round(score)));
  let level='Low';
  if(score>=80) level='Critical'; else if(score>=60) level='High'; else if(score>=35) level='Medium';
  return {score, level};
}

function ilRecalcIssue(issueId){
  const issues = ilGetIssues();
  const idx = issues.findIndex(i=>i.IssueID===issueId);
  if(idx===-1) return;
  const issue = issues[idx];
  const reports = ilGetReports().filter(r=>r.IssueID===issueId);
  issue.LinkedReportCount = reports.length;
  const sevOrder = {Low:1,Medium:2,High:3,Critical:4};
  let highestSev = 'Low';
  reports.forEach(r=>{ if((sevOrder[r.Severity]||0) > (sevOrder[highestSev]||0)) highestSev = r.Severity; });
  issue.HighestSeverity = highestSev;
  const confirmations = ilGetConfirmations().filter(c=>c.IssueID===issueId);
  issue.AffectedCount = reports.length + confirmations.length;
  const pr = ilComputePriority(issue);
  issue.PriorityScore = pr.score; issue.PriorityLevel = pr.level;
  // recurring detection: 3+ reports in same category+location history, or reopened before
  issue.IsRecurring = (reports.length>=3) || (issue.ReopenedAt ? true : false);
  issue.UpdatedAt = Date.now();
  issues[idx]=issue;
  ilSave(IL_KEYS.issues, issues);
}

function ilToast(msg, type){
  let wrap = document.querySelector('.toast-wrap');
  if(!wrap){ wrap=document.createElement('div'); wrap.className='toast-wrap'; document.body.appendChild(wrap); }
  const t = document.createElement('div');
  t.className='toast '+(type||'info');
  t.textContent = msg;
  wrap.appendChild(t);
  setTimeout(()=>{ t.remove(); }, 3500);
}
function ilEsc(s){ return (s===null||s===undefined)?'':String(s).replace(/[&<>"']/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
function ilFmtDate(ts){ if(!ts) return '—'; const d=new Date(ts); return d.toLocaleDateString()+' '+d.toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'}); }
function ilBadgeClass(status){
  const map = {Critical:'b-critical',High:'b-high',Medium:'b-medium',Low:'b-low','In Progress':'b-inprogress',Resolved:'b-resolved','Under Review':'b-underreview',Reported:'b-reported',Assigned:'b-assigned',Reopened:'b-reopened',Verified:'b-verified',Rejected:'b-rejected'};
  return map[status] || 'b-reported';
}

/* ==========================================================
   Resident Portal (residents.html)
   ========================================================== */
if(document.body && document.body.classList.contains('resident')){

const R = { step:1, data:{}, photoDataUrl:null };

function rNav(tab){
  document.querySelectorAll('.r-nav button').forEach(b=>b.classList.toggle('active', b.dataset.tab===tab));
  document.querySelectorAll('.r-view').forEach(v=>v.style.display = (v.id==='view-'+tab)?'block':'none');
  if(tab==='issues') renderPublicIssues();
  if(tab==='track') { document.getElementById('trackResult').innerHTML=''; }
}

function initReportForm(){
  R.step=1; R.data={}; R.photoDataUrl=null;
  const catGrid = document.getElementById('catGrid');
  catGrid.innerHTML = ilGetCategories().map(c=>`<div class="cat-opt" data-cat="${ilEsc(c.CategoryName)}"><i class="fa-solid ${CATEGORY_ICONS[c.CategoryName]||'fa-circle-question'}"></i>${ilEsc(c.CategoryName)}</div>`).join('');
  catGrid.querySelectorAll('.cat-opt').forEach(el=>el.addEventListener('click', ()=>{
    catGrid.querySelectorAll('.cat-opt').forEach(x=>x.classList.remove('selected'));
    el.classList.add('selected'); R.data.Category = el.dataset.cat;
  }));
  document.getElementById('sevGrid').querySelectorAll('.sev-opt').forEach(el=>el.addEventListener('click', ()=>{
    document.getElementById('sevGrid').querySelectorAll('.sev-opt').forEach(x=>x.classList.remove('selected'));
    el.classList.add('selected'); R.data.Severity = el.dataset.sev;
  }));
  document.getElementById('rpTitle').value=''; document.getElementById('rpDesc').value='';
  document.getElementById('rpLocationText').value=''; document.getElementById('rpLat').value=''; document.getElementById('rpLon').value='';
  document.getElementById('photoPreviewWrap').innerHTML='';
  document.getElementById('photoInput').value='';
  showStep(1);
}
function showStep(n){
  R.step=n;
  for(let i=1;i<=6;i++){ const el=document.getElementById('rp-step-'+i); if(el) el.style.display=(i===n)?'block':'none'; }
  document.querySelectorAll('.step-indicator .dot').forEach((d,idx)=>{
    d.classList.toggle('active', idx+1===n);
    d.classList.toggle('done', idx+1<n);
  });
  if(n===5) fillReview();
}
function validateStep(n){
  if(n===1 && !R.data.Category){ ilToast('Please select a category.','error'); return false; }
  if(n===2){
    const title=document.getElementById('rpTitle').value.trim();
    const desc=document.getElementById('rpDesc').value.trim();
    if(!title){ ilToast('Please provide a short title.','error'); return false; }
    if(!desc){ ilToast('Please describe the issue.','error'); return false; }
    if(!R.data.Severity){ ilToast('Please select a severity.','error'); return false; }
    R.data.Title=title; R.data.Description=desc;
  }
  if(n===3){
    const locText = document.getElementById('rpLocationText').value.trim();
    const lat = document.getElementById('rpLat').value;
    const lon = document.getElementById('rpLon').value;
    if(!locText && !(lat && lon)){ ilToast('Please provide a location (use GPS or type an address).','error'); return false; }
    R.data.LocationText = locText || 'Unspecified (GPS pin only)';
    R.data.Latitude = lat? parseFloat(lat): null;
    R.data.Longitude = lon? parseFloat(lon): null;
  }
  if(n===4){
    if(!R.photoDataUrl){ ilToast('Photo evidence is required to submit a report.','error'); return false; }
  }
  return true;
}
function rpNext(){ if(validateStep(R.step)) showStep(Math.min(6,R.step+1)); }
function rpBack(){ showStep(Math.max(1,R.step-1)); }

function useGPS(){
  if(!navigator.geolocation){ ilToast('Geolocation is not available on this device.','error'); return; }
  ilToast('Locating you…','info');
  navigator.geolocation.getCurrentPosition(pos=>{
    document.getElementById('rpLat').value = pos.coords.latitude.toFixed(6);
    document.getElementById('rpLon').value = pos.coords.longitude.toFixed(6);
    ilToast('Location captured.','success');
  }, err=>{
    ilToast('Could not get GPS location. Please enter it manually.','error');
  }, {timeout:8000});
}

function handlePhotoFile(file){
  if(!file) return;
  if(!file.type.startsWith('image/')){ ilToast('Please choose an image file.','error'); return; }
  const reader = new FileReader();
  reader.onload = e=>{
    const img = new Image();
    img.onload = ()=>{
      const maxDim = 1000;
      let w=img.width, h=img.height;
      if(w>maxDim || h>maxDim){ const scale=Math.min(maxDim/w,maxDim/h); w=Math.round(w*scale); h=Math.round(h*scale); }
      const canvas = document.createElement('canvas'); canvas.width=w; canvas.height=h;
      canvas.getContext('2d').drawImage(img,0,0,w,h);
      let quality=0.75;
      let dataUrl = canvas.toDataURL('image/jpeg', quality);
      while(dataUrl.length > 700000 && quality>0.3){ quality-=0.1; dataUrl = canvas.toDataURL('image/jpeg', quality); }
      if(dataUrl.length > 900000){ ilToast('Image is too large even after compression. Please choose a smaller photo.','error'); return; }
      R.photoDataUrl = dataUrl;
      document.getElementById('photoPreviewWrap').innerHTML = `<img src="${dataUrl}" class="photo-preview" alt="Evidence preview"><div style="margin-top:8px;"><button class="btn btn-outline btn-sm" onclick="removePhoto()"><i class="fa-solid fa-trash"></i> Remove Photo</button></div>`;
      ilToast('Photo attached.','success');
    };
    img.onerror = ()=> ilToast('Unable to read that image.','error');
    img.src = e.target.result;
  };
  reader.onerror = ()=> ilToast('Unable to read that file.','error');
  reader.readAsDataURL(file);
}
function removePhoto(){ R.photoDataUrl=null; document.getElementById('photoPreviewWrap').innerHTML=''; document.getElementById('photoInput').value=''; }

function fillReview(){
  const d = R.data;
  document.getElementById('reviewBody').innerHTML = `
    <div class="review-row"><span>Category</span><span>${ilEsc(d.Category)}</span></div>
    <div class="review-row"><span>Title</span><span>${ilEsc(d.Title)}</span></div>
    <div class="review-row"><span>Description</span><span>${ilEsc(d.Description)}</span></div>
    <div class="review-row"><span>Severity</span><span>${ilEsc(d.Severity)}</span></div>
    <div class="review-row"><span>Location</span><span>${ilEsc(d.LocationText)}</span></div>
    <div class="review-row"><span>Coordinates</span><span>${d.Latitude? d.Latitude+', '+d.Longitude : '—'}</span></div>
    <div class="review-row"><span>Photo</span><span>${R.photoDataUrl? 'Attached ✓' : 'Missing'}</span></div>
  `;
}

let submitting=false;
async function submitReport(){
  if(submitting) return;
  if(!R.photoDataUrl){ ilToast('Photo evidence is required.','error'); showStep(4); return; }
  submitting=true;
  const btn = document.getElementById('submitBtn');
  btn.disabled=true; btn.innerHTML='<i class="fa-solid fa-spinner fa-spin"></i> Submitting…';
  const report = {
    ReportID: ilId('R',7), ReportCode: ilId('IL-RP-',5), IssueID: null,
    Category: R.data.Category, Title: R.data.Title, Description: R.data.Description,
    Latitude: R.data.Latitude, Longitude: R.data.Longitude, LocationText: R.data.LocationText,
    Severity: R.data.Severity, PhotoURLs: [R.photoDataUrl], SubmittedAt: Date.now(),
    Status:'Reported', AnonymousReporterID: ilId('ANON-',5)
  };
  try{
    const reports=ilGetReports();
    reports.push(report);
    if(!ilSave(IL_KEYS.reports,reports)) throw new Error('Local storage is unavailable or full.');

    if(ilCloudEnabled()){
      try{
        await ilPushReportToCloud(report);
        ilToast('Report submitted and synced to Google Sheets.','success');
      }catch(cloudErr){
        console.error('IssueLink report cloud sync failed:',cloudErr);
        ilRememberPendingReport(report);
        ilToast('Report saved on this device. It will retry syncing when connection is available.','info');
      }
    }else{
      ilRememberPendingReport(report);
      ilToast('Report saved locally. Use the public link generated by the admin to enable centralized syncing.','info');
    }
    document.getElementById('doneCode').textContent = report.ReportCode;
    showStep(6);
  }catch(e){
    console.error(e); ilToast('Unable to save report. '+e.message,'error');
  }finally{
    submitting=false; btn.disabled=false; btn.innerHTML='<i class="fa-solid fa-paper-plane"></i> Submit Report';
  }
}

function renderPublicIssues(){
  const kw = (document.getElementById('fltKeyword').value||'').toLowerCase();
  const cat = document.getElementById('fltCategory').value;
  const status = document.getElementById('fltStatus').value;
  const priority = document.getElementById('fltPriority').value;
  let issues = ilGetIssues();
  issues = issues.filter(i=>{
    if(cat && i.Category!==cat) return false;
    if(status && i.Status!==status) return false;
    if(priority && i.PriorityLevel!==priority) return false;
    if(kw && !((i.Title||'').toLowerCase().includes(kw) || (i.PublicDescription||i.Description||'').toLowerCase().includes(kw))) return false;
    return true;
  }).sort((a,b)=>b.UpdatedAt-a.UpdatedAt);
  const list = document.getElementById('issueList');
  if(issues.length===0){
    list.innerHTML = `<div class="empty-state"><i class="fa-solid fa-clipboard-list"></i><h3>No Issues Yet</h3><p>Issues will appear here after reports are reviewed and consolidated.</p></div>`;
    return;
  }
  list.innerHTML = issues.map(i=>`
    <div class="issue-item" onclick="openIssueDetail('${i.IssueID}')">
      <span class="badge ${ilBadgeClass(i.PriorityLevel)}">${ilEsc(i.PriorityLevel)}</span>
      <span class="badge ${ilBadgeClass(i.Status)}">${ilEsc(i.Status)}</span>
      <h3>${ilEsc(i.Title)} <small style="color:#94A3B8;font-weight:normal;">${ilEsc(i.IssueID)}</small></h3>
      <div class="meta"><i class="fa-solid fa-tag"></i> ${ilEsc(i.Category)} &nbsp; <i class="fa-solid fa-location-dot"></i> ${ilEsc(i.LocationText||'—')} &nbsp; <i class="fa-solid fa-link"></i> ${i.LinkedReportCount||1} linked report(s) &nbsp; <i class="fa-solid fa-users"></i> ${i.AffectedCount||0} affected</div>
    </div>
  `).join('');
}

function ilPopulateCategoryFilters(){
  const opts = ilGetCategories().map(c=>`<option value="${ilEsc(c.CategoryName)}">${ilEsc(c.CategoryName)}</option>`).join('');
  const el = document.getElementById('fltCategory'); if(el) el.innerHTML = '<option value="">All Categories</option>'+opts;
}

function openIssueDetail(issueId){
  const issue = ilGetIssues().find(i=>i.IssueID===issueId);
  if(!issue) return;
  const updates = ilGetUpdates().filter(u=>u.IssueID===issueId && !u.Internal).sort((a,b)=>a.UpdatedAt-b.UpdatedAt);
  const confirmCount = ilGetConfirmations().filter(c=>c.IssueID===issueId).length;
  document.getElementById('modalRoot').innerHTML = `
    <div class="modal-overlay" onclick="if(event.target===this)closeModal()">
      <div class="modal">
        <button class="modal-close" onclick="closeModal()"><i class="fa-solid fa-xmark"></i></button>
        <h2>${ilEsc(issue.Title)}</h2>
        <p style="color:#64748B;">${ilEsc(issue.IssueID)} &nbsp; <span class="badge ${ilBadgeClass(issue.Status)}">${ilEsc(issue.Status)}</span> <span class="badge ${ilBadgeClass(issue.PriorityLevel)}">${ilEsc(issue.PriorityLevel)}</span></p>
        <p>${ilEsc(issue.PublicDescription || issue.Description || '')}</p>
        <div class="review-row"><span>Category</span><span>${ilEsc(issue.Category)}</span></div>
        <div class="review-row"><span>General Location</span><span>${ilEsc(issue.LocationText||'—')}</span></div>
        <div class="review-row"><span>Linked Reports</span><span>${issue.LinkedReportCount||1}</span></div>
        <div class="review-row"><span>Residents Affected</span><span>${issue.AffectedCount||0}</span></div>
        <hr class="sep">
        <h3>Public Timeline</h3>
        ${updates.length? `<ul class="timeline">${updates.map(u=>`<li><b>${ilEsc(u.Status)}</b><br><span class="t-time">${ilFmtDate(u.UpdatedAt)}</span>${u.Message?`<div>${ilEsc(u.Message)}</div>`:''}</li>`).join('')}</ul>` : '<p style="color:#64748B;">No timeline updates yet.</p>'}
        <hr class="sep">
        <div style="display:flex;gap:10px;flex-wrap:wrap;">
          <button class="btn btn-outline" onclick="affectMeToo('${issue.IssueID}')"><i class="fa-solid fa-hand"></i> This affects me too</button>
          ${issue.Status==='Resolved' ? `<button class="btn btn-primary" onclick="openVerify('${issue.IssueID}')"><i class="fa-solid fa-check-circle"></i> Verify Resolution</button>` : ''}
        </div>
        <p style="font-size:13px;color:#94A3B8;margin-top:10px;">${confirmCount} resident confirmation(s) on record.</p>
      </div>
    </div>`;
}
function closeModal(){ document.getElementById('modalRoot').innerHTML=''; }

function affectMeToo(issueId){
  const confirmations = ilGetConfirmations();
  const already = localStorage.getItem('issuelink_affected_'+issueId);
  if(already){ ilToast('You have already confirmed this issue.','info'); return; }
  confirmations.push({ConfirmationID:ilId('CF',6), IssueID:issueId, ReportID:null, Response:'Affected', SubmittedAt:Date.now(), AnonymousResidentID:ilId('ANON-',5)});
  ilSave(IL_KEYS.confirmations, confirmations);
  localStorage.setItem('issuelink_affected_'+issueId,'1');
  ilRecalcIssue(issueId);
  ilToast('Thank you — your confirmation was recorded.','success');
  openIssueDetail(issueId);
  renderPublicIssues();
}

function openVerify(issueId){
  document.getElementById('modalRoot').innerHTML = `
    <div class="modal-overlay" onclick="if(event.target===this)closeModal()">
      <div class="modal">
        <button class="modal-close" onclick="closeModal()"><i class="fa-solid fa-xmark"></i></button>
        <h2>Verify Resolution</h2>
        <p>Has this issue actually been resolved?</p>
        <div style="display:flex;flex-direction:column;gap:10px;">
          <button class="btn btn-primary" onclick="submitVerify('${issueId}','Yes, fixed')"><i class="fa-solid fa-check"></i> Yes, fixed</button>
          <button class="btn btn-outline" onclick="submitVerify('${issueId}','Partially fixed')"><i class="fa-solid fa-adjust"></i> Partially fixed</button>
          <button class="btn btn-outline" onclick="submitVerify('${issueId}','Still a problem')"><i class="fa-solid fa-triangle-exclamation"></i> Still a problem</button>
        </div>
      </div>
    </div>`;
}
function submitVerify(issueId, response){
  const confirmations = ilGetConfirmations();
  confirmations.push({ConfirmationID:ilId('CF',6), IssueID:issueId, ReportID:null, Response:response, SubmittedAt:Date.now(), AnonymousResidentID:ilId('ANON-',5)});
  ilSave(IL_KEYS.confirmations, confirmations);
  if(response==='Still a problem'){
    const issues = ilGetIssues();
    const recentStill = confirmations.filter(c=>c.IssueID===issueId && c.Response==='Still a problem').length;
    if(recentStill>=2){
      const idx = issues.findIndex(i=>i.IssueID===issueId);
      if(idx!==-1 && issues[idx].Status==='Resolved'){
        issues[idx].Status='Reopened'; issues[idx].ReopenedAt=Date.now();
        ilSave(IL_KEYS.issues, issues);
        ilAddTimeline(issueId,'Reopened','Reopened after repeated resident reports that the issue persists.',false,'System');
      }
    }
  }
  ilRecalcIssue(issueId);
  ilToast('Verification submitted.','success');
  closeModal();
  renderPublicIssues();
}

function trackReport(){
  const code = document.getElementById('trackCode').value.trim().toUpperCase();
  const result = document.getElementById('trackResult');
  if(!code){ ilToast('Please enter a report code.','error'); return; }
  const report = ilGetReports().find(r=>r.ReportCode.toUpperCase()===code);
  if(!report){ result.innerHTML = `<div class="r-card"><p><i class="fa-solid fa-circle-exclamation"></i> Invalid report code. Please check and try again.</p></div>`; return; }
  const issue = report.IssueID ? ilGetIssues().find(i=>i.IssueID===report.IssueID) : null;
  result.innerHTML = `
    <div class="r-card">
      <h3>${ilEsc(report.ReportCode)}</h3>
      <div class="review-row"><span>Category</span><span>${ilEsc(report.Category)}</span></div>
      <div class="review-row"><span>Submitted</span><span>${ilFmtDate(report.SubmittedAt)}</span></div>
      <div class="review-row"><span>Status</span><span><span class="badge ${ilBadgeClass(issue?issue.Status:report.Status)}">${ilEsc(issue?issue.Status:report.Status)}</span></span></div>
      ${issue? `<div class="review-row"><span>Linked Issue</span><span>${ilEsc(issue.IssueID)} (${issue.LinkedReportCount} linked reports)</span></div>` : `<div class="review-row"><span>Linked Issue</span><span>Not yet linked — under review</span></div>`}
      ${issue? `<button class="btn btn-outline btn-sm" style="margin-top:10px;" onclick="closeModal();openIssueDetail('${issue.IssueID}')"><i class="fa-solid fa-eye"></i> View Issue</button>`:''}
    </div>`;
}

document.addEventListener('DOMContentLoaded', ()=>{
  document.querySelectorAll('.r-nav button').forEach(b=>b.addEventListener('click', ()=>rNav(b.dataset.tab)));
  document.getElementById('startReportBtn').addEventListener('click', ()=>{ rNav('report'); initReportForm(); });
  document.getElementById('photoInput').addEventListener('change', e=> handlePhotoFile(e.target.files[0]));
  document.getElementById('useGpsBtn').addEventListener('click', useGPS);
  document.getElementById('fltKeyword').addEventListener('input', renderPublicIssues);
  document.getElementById('fltCategory').addEventListener('change', renderPublicIssues);
  document.getElementById('fltStatus').addEventListener('change', renderPublicIssues);
  document.getElementById('fltPriority').addEventListener('change', renderPublicIssues);
  document.getElementById('trackBtn').addEventListener('click', trackReport);
  ilPopulateCategoryFilters();
  renderPublicIssues();
  rNav('home');

  // Residents use the script URL embedded in the Public Link, so phones and laptops
  // do not need to share localStorage. Pull centralized data on load and periodically.
  const bootCloudSync = async ()=>{
    if(!ilCloudEnabled()) return;
    try{
      await ilSyncResidents();
      ilPopulateCategoryFilters();
      renderPublicIssues();
    }catch(e){ console.warn('IssueLink cloud pull failed:',e); }
  };
  bootCloudSync();
  setInterval(bootCloudSync, 30000);
});

window.rpNext=rpNext; window.rpBack=rpBack; window.submitReport=submitReport; window.removePhoto=removePhoto;
window.openIssueDetail=openIssueDetail; window.closeModal=closeModal; window.affectMeToo=affectMeToo;
window.openVerify=openVerify; window.submitVerify=submitVerify; window.trackReport=trackReport;
}
