/* ==========================================================
   IssueLink — Admin Portal Logic
   ========================================================== */
const A = { section:'dashboard', currentReportId:null, currentIssueId:null };

function aSession(){ return ilLoad(IL_KEYS.session, null); }
function aRequireAuth(){
  const s = aSession();
  if(!s){ showLogin(); return false; }
  document.getElementById('appShell').style.display='flex';
  document.getElementById('loginScreen').style.display='none';
  document.getElementById('curAdminName').textContent = s.Name;
  document.getElementById('curAdminRole').textContent = s.Role;
  document.querySelectorAll('.super-only').forEach(el=> el.style.display = (s.Role==='Super Admin')?'':'none');
  return true;
}
function showLogin(){
  document.getElementById('appShell').style.display='none';
  document.getElementById('loginScreen').style.display='flex';
}
async function doLogin(){
  const email = document.getElementById('loginEmail').value.trim().toLowerCase();
  const pass = document.getElementById('loginPass').value;
  const settings = ilGetSettings();
  const errEl = document.getElementById('loginError');
  errEl.style.display='none';

  // When cloud sync is enabled, authenticate against the centralized Admins sheet first.
  // This allows an admin created on one device to log in from another device.
  if(settings.storageMode==='Google Sheets Sync' && settings.scriptUrl){
    try{
      const cloud = await ilCloudPost('authenticate',{email,password:pass});
      if(cloud && cloud.ok && cloud.admin){
        const admin=Object.assign({},cloud.admin,{Password:pass,LastLogin:Date.now()});
        const admins=settings.admins||[];
        const idx=admins.findIndex(a=>a.AdminID===admin.AdminID);
        if(idx>=0) admins[idx]=Object.assign({},admins[idx],admin); else admins.push(admin);
        settings.admins=admins;
        ilSave(IL_KEYS.settings,settings);
        ilSave(IL_KEYS.session,{AdminID:admin.AdminID,Name:admin.Name,Role:admin.Role,Email:admin.Email});
        aRequireAuth(); goSection('dashboard'); return;
      }
    }catch(err){
      console.warn('IssueLink cloud login unavailable; falling back to local credentials.',err);
    }
  }

  const admins = settings.admins || DEFAULT_ADMINS;
  const admin = admins.find(a=>a.Email && a.Email.toLowerCase()===email && a.Password===pass && a.Status!=='Inactive');
  if(!admin){ errEl.textContent = 'Invalid email or password.'; errEl.style.display='block'; return; }
  admin.LastLogin = Date.now();
  ilSave(IL_KEYS.settings, settings);
  ilSave(IL_KEYS.session, {AdminID:admin.AdminID, Name:admin.Name, Role:admin.Role, Email:admin.Email});
  errEl.style.display='none';
  aRequireAuth();
  goSection('dashboard');
}
function doLogout(){ localStorage.removeItem(IL_KEYS.session); showLogin(); }

function goSection(sec){
  A.section = sec;
  document.querySelectorAll('.a-nav-link').forEach(l=>l.classList.toggle('active', l.dataset.sec===sec));
  document.querySelectorAll('.a-section').forEach(s=>s.style.display = (s.id==='sec-'+sec)?'block':'none');
  document.getElementById('a-sidebar').classList.remove('open');
  const renderers = {dashboard:renderDashboard, reports:renderReports, linking:renderLinking, issues:renderIssuesAdmin, analytics:renderAnalytics, settings:renderSettings};
  if(renderers[sec]) renderers[sec]();
}

/* ---------------- Dashboard ---------------- */
function renderDashboard(){
  const reports = ilGetReports(), issues = ilGetIssues();
  const m = {
    total: issues.length,
    newReports: reports.filter(r=>!r.IssueID).length,
    underReview: issues.filter(i=>i.Status==='Under Review').length,
    critical: issues.filter(i=>i.PriorityLevel==='Critical').length,
    high: issues.filter(i=>i.PriorityLevel==='High').length,
    inProgress: issues.filter(i=>i.Status==='In Progress').length,
    resolved: issues.filter(i=>i.Status==='Resolved').length,
    possibleMatches: computePossibleMatches().length,
    overdue: issues.filter(i=>i.TargetDate && i.TargetDate<Date.now() && i.Status!=='Resolved').length,
    recurring: issues.filter(i=>i.IsRecurring).length
  };
  document.getElementById('dashGrid').innerHTML = [
    ['fa-clipboard-list','Total Issues',m.total],['fa-inbox','New Reports',m.newReports],
    ['fa-magnifying-glass','Under Review',m.underReview],['fa-circle-exclamation','Critical',m.critical],
    ['fa-triangle-exclamation','High Priority',m.high],['fa-spinner','In Progress',m.inProgress],
    ['fa-circle-check','Resolved',m.resolved],['fa-link','Possible Matches',m.possibleMatches],
    ['fa-clock','Overdue',m.overdue],['fa-rotate','Recurring Issues',m.recurring]
  ].map(([icon,lbl,num])=>`<div class="metric"><i class="fa-solid ${icon}"></i><div class="num">${num}</div><div class="lbl">${lbl}</div></div>`).join('');

  const recent = reports.slice().sort((a,b)=>b.SubmittedAt-a.SubmittedAt).slice(0,5);
  const recentWrap = document.getElementById('recentReports');
  if(recent.length===0){
    recentWrap.innerHTML = `<div class="empty-state"><i class="fa-solid fa-inbox"></i><h3>No Reports Yet</h3><p>No community reports have been submitted.</p></div>`;
  } else {
    recentWrap.innerHTML = recent.map(r=>`
      <div class="a-record-card">
        <div class="row"><span>${ilEsc(r.ReportCode)}</span><span class="badge ${ilBadgeClass(r.Severity)}">${ilEsc(r.Severity)}</span></div>
        <div class="row"><span>${ilEsc(r.Category)}</span><span>${ilFmtDate(r.SubmittedAt)}</span></div>
        <div class="row"><span>${ilEsc(r.Title)}</span><button class="btn btn-sm btn-outline" onclick="openReportDetail('${r.ReportID}')">View</button></div>
      </div>`).join('');
  }
}

/* ---------------- Reports Management ---------------- */
function renderReports(){
  const kw = (document.getElementById('repFilterKw')?.value||'').toLowerCase();
  const cat = document.getElementById('repFilterCat')?.value || '';
  const status = document.getElementById('repFilterStatus')?.value || '';
  let reports = ilGetReports();
  reports = reports.filter(r=>{
    if(cat && r.Category!==cat) return false;
    if(status==='linked' && !r.IssueID) return false;
    if(status==='unlinked' && r.IssueID) return false;
    if(kw && !((r.Title||'').toLowerCase().includes(kw) || r.ReportCode.toLowerCase().includes(kw))) return false;
    return true;
  }).sort((a,b)=>b.SubmittedAt-a.SubmittedAt);

  const catSel = document.getElementById('repFilterCat');
  if(catSel && catSel.options.length<=1) catSel.innerHTML = '<option value="">All Categories</option>'+ilGetCategories().map(c=>`<option>${ilEsc(c.CategoryName)}</option>`).join('');

  const tbody = document.getElementById('reportsTbody');
  const cardsWrap = document.getElementById('reportsCards');
  if(reports.length===0){
    const empty = `<div class="empty-state"><i class="fa-solid fa-inbox"></i><h3>No Reports Yet</h3><p>No community reports have been submitted.</p></div>`;
    tbody.innerHTML = `<tr><td colspan="6">${empty}</td></tr>`; cardsWrap.innerHTML = empty; return;
  }
  tbody.innerHTML = reports.map(r=>`
    <tr>
      <td>${ilEsc(r.ReportCode)}</td><td>${ilEsc(r.Category)}</td><td>${ilEsc(r.Title)}</td>
      <td><span class="badge ${ilBadgeClass(r.Severity)}">${ilEsc(r.Severity)}</span></td>
      <td>${r.IssueID? ilEsc(r.IssueID) : '<span style="color:#94A3B8;">Unlinked</span>'}</td>
      <td><button class="btn btn-sm btn-outline" onclick="openReportDetail('${r.ReportID}')"><i class="fa-solid fa-eye"></i> View</button></td>
    </tr>`).join('');
  cardsWrap.innerHTML = reports.map(r=>`
    <div class="a-record-card">
      <div class="row"><b>${ilEsc(r.ReportCode)}</b><span class="badge ${ilBadgeClass(r.Severity)}">${ilEsc(r.Severity)}</span></div>
      <div class="row"><span>${ilEsc(r.Category)}</span><span>${r.IssueID?ilEsc(r.IssueID):'Unlinked'}</span></div>
      <div class="row"><span>${ilEsc(r.Title)}</span></div>
      <button class="btn btn-sm btn-outline" style="margin-top:6px;width:100%;" onclick="openReportDetail('${r.ReportID}')"><i class="fa-solid fa-eye"></i> View</button>
    </div>`).join('');
}

function openReportDetail(reportId){
  const report = ilGetReports().find(r=>r.ReportID===reportId);
  if(!report) return;
  A.currentReportId = reportId;
  const issues = ilGetIssues();
  document.getElementById('modalRoot').innerHTML = `
    <div class="modal-overlay" onclick="if(event.target===this)closeModal()">
      <div class="modal">
        <button class="modal-close" onclick="closeModal()"><i class="fa-solid fa-xmark"></i></button>
        <h2>${ilEsc(report.ReportCode)}</h2>
        <div class="review-row"><span>Category</span><span>${ilEsc(report.Category)}</span></div>
        <div class="review-row"><span>Title</span><span>${ilEsc(report.Title)}</span></div>
        <div class="review-row"><span>Description</span><span>${ilEsc(report.Description)}</span></div>
        <div class="review-row"><span>Severity</span><span>${ilEsc(report.Severity)}</span></div>
        <div class="review-row"><span>Location</span><span>${ilEsc(report.LocationText)} ${report.Latitude?`(${report.Latitude}, ${report.Longitude})`:''}</span></div>
        <div class="review-row"><span>Submitted</span><span>${ilFmtDate(report.SubmittedAt)}</span></div>
        <div class="review-row"><span>Reporter ID</span><span>${ilEsc(report.AnonymousReporterID)}</span></div>
        <div class="review-row"><span>Linked Issue</span><span>${report.IssueID? ilEsc(report.IssueID) : 'Not linked'}</span></div>
        <hr class="sep">
        <h3><i class="fa-solid fa-camera"></i> Evidence</h3>
        ${report.PhotoURLs && report.PhotoURLs.length ? report.PhotoURLs.map(p=>`<img src="${p}" class="evidence-img" onclick="window.open(this.src,'_blank')" alt="Evidence">`).join('') : '<p>No photo evidence attached.</p>'}
        <hr class="sep">
        ${!report.IssueID ? `
        <div style="display:flex;gap:8px;flex-wrap:wrap;">
          <select id="linkIssueSelect" style="flex:1;min-width:160px;">
            <option value="">Select existing issue…</option>
            ${issues.map(i=>`<option value="${i.IssueID}">${ilEsc(i.IssueID)} — ${ilEsc(i.Title)}</option>`).join('')}
          </select>
          <button class="btn btn-primary btn-sm" onclick="linkReportToIssue('${report.ReportID}', document.getElementById('linkIssueSelect').value)"><i class="fa-solid fa-link"></i> Link to Existing Issue</button>
        </div>
        <button class="btn btn-outline" style="margin-top:8px;" onclick="createIssueFromReport('${report.ReportID}')"><i class="fa-solid fa-plus"></i> Create New Issue</button>
        ` : `<p><i class="fa-solid fa-circle-check" style="color:#16A34A;"></i> Linked to ${ilEsc(report.IssueID)}</p>
        <button class="btn btn-outline btn-sm" onclick="closeModal();goSection('issues');openIssueDetailAdmin('${report.IssueID}')">View Issue</button>`}
      </div>
    </div>`;
}
function closeModal(){ document.getElementById('modalRoot').innerHTML=''; }

function createIssueFromReport(reportId){
  const reports = ilGetReports();
  const idx = reports.findIndex(r=>r.ReportID===reportId);
  if(idx===-1) return;
  const r = reports[idx];
  const issues = ilGetIssues();
  const issueId = ilNextIssueNum();
  const issue = {
    IssueID:issueId, Category:r.Category, Title:r.Title, Description:r.Description, PublicDescription:r.Description,
    Latitude:r.Latitude, Longitude:r.Longitude, LocationText:r.LocationText,
    PriorityScore:0, PriorityLevel:'Low', LinkedReportCount:0, AffectedCount:0,
    Status:'Reported', AssignedDepartment:'', AssignedStaff:'', TargetDate:null,
    CreatedAt:Date.now(), UpdatedAt:Date.now(), ResolvedAt:null, ReopenedAt:null, IsRecurring:false
  };
  issues.push(issue);
  ilSave(IL_KEYS.issues, issues);
  r.IssueID = issueId; reports[idx]=r; ilSave(IL_KEYS.reports, reports);
  ilAddTimeline(issueId,'Reported','Issue created from resident report.',false,aSession().Name);
  ilRecalcIssue(issueId);
  ilToast('Issue created successfully.','success');
  closeModal(); goSection('reports');
}
function linkReportToIssue(reportId, issueId){
  if(!issueId){ ilToast('Please select an issue first.','error'); return; }
  const reports = ilGetReports();
  const idx = reports.findIndex(r=>r.ReportID===reportId);
  if(idx===-1) return;
  reports[idx].IssueID = issueId;
  ilSave(IL_KEYS.reports, reports);
  ilAddTimeline(issueId,'Reports Linked','A report was linked to this issue.',false,aSession().Name);
  ilRecalcIssue(issueId);
  ilToast('Report linked successfully.','success');
  closeModal(); goSection('reports');
}

/* ---------------- Issue Linking Center ---------------- */
function computePossibleMatches(){
  const reports = ilGetReports().filter(r=>!r.IssueID);
  const issues = ilGetIssues();
  const matches = [];
  reports.forEach(r=>{
    issues.forEach(i=>{
      if(i.Category!==r.Category) return;
      const score = ilMatchScore(r, i);
      if(score.total>=35) matches.push({report:r, issue:i, score});
    });
  });
  // also unlinked-vs-unlinked report pairs (no issue yet)
  for(let a=0;a<reports.length;a++){
    for(let b=a+1;b<reports.length;b++){
      if(reports[a].Category!==reports[b].Category) continue;
      const score = ilMatchScore(reports[a], reports[b]);
      if(score.total>=35) matches.push({report:reports[a], report2:reports[b], score});
    }
  }
  matches.sort((x,y)=>y.score.total-x.score.total);
  return matches;
}
function renderLinking(){
  const matches = computePossibleMatches();
  const wrap = document.getElementById('linkingWrap');
  if(matches.length===0){
    wrap.innerHTML = `<div class="empty-state"><i class="fa-solid fa-diagram-project"></i><h3>No Possible Matches</h3><p>There are currently no reports requiring matching review.</p></div>`;
    return;
  }
  wrap.innerHTML = matches.map((m,idx)=>{
    const targetLabel = m.issue ? `${m.issue.IssueID} — ${ilEsc(m.issue.Title)}` : `Report ${ilEsc(m.report2.ReportCode)} (unlinked)`;
    return `
    <div class="a-card">
      <div style="display:flex;justify-content:space-between;flex-wrap:wrap;gap:8px;">
        <div><b>${ilEsc(m.report.ReportCode)}</b> — ${ilEsc(m.report.Title)}</div>
        <div class="match-score">${m.score.total}% match</div>
      </div>
      <p style="color:#94A3B8;margin:4px 0;">Possible match with: ${targetLabel}</p>
      <div class="score-bar"><div style="width:${m.score.total}%;"></div></div>
      <ul class="factor-list">
        <li><i class="fa-solid fa-location-dot"></i> Location Similarity: ${m.score.locScore}%</li>
        <li><i class="fa-solid fa-tag"></i> Category Similarity: ${m.score.catScore}%</li>
        <li><i class="fa-solid fa-align-left"></i> Description Similarity: ${m.score.descScore}%</li>
        <li><i class="fa-solid fa-clock"></i> Time Proximity: ${m.score.timeScore}%</li>
      </ul>
      <div style="display:flex;gap:8px;flex-wrap:wrap;">
        ${m.issue ? `<button class="btn btn-primary btn-sm" onclick="linkReportToIssue('${m.report.ReportID}','${m.issue.IssueID}');goSection('linking')"><i class="fa-solid fa-link"></i> Confirm Link</button>`
        : `<button class="btn btn-primary btn-sm" onclick="mergeTwoReports('${m.report.ReportID}','${m.report2.ReportID}')"><i class="fa-solid fa-object-group"></i> Confirm Link (New Issue)</button>`}
        <button class="btn btn-muted btn-sm" onclick="rejectMatch(${idx})"><i class="fa-solid fa-xmark"></i> Reject Match</button>
      </div>
    </div>`;
  }).join('');
}
function mergeTwoReports(id1, id2){
  createIssueFromReport(id1);
  const r1 = ilGetReports().find(r=>r.ReportID===id1);
  if(r1 && r1.IssueID) linkReportToIssue(id2, r1.IssueID);
  goSection('linking');
}
function rejectMatch(idx){ ilToast('Match rejected.','info'); goSection('linking'); }

/* ---------------- Issue Management ---------------- */
function renderIssuesAdmin(){
  const statusFilter = document.getElementById('issFilterStatus')?.value || '';
  let issues = ilGetIssues().sort((a,b)=>b.PriorityScore-a.PriorityScore);
  if(statusFilter) issues = issues.filter(i=>i.Status===statusFilter);
  const wrap = document.getElementById('issuesWrap');
  if(issues.length===0){
    wrap.innerHTML = `<div class="empty-state"><i class="fa-solid fa-clipboard-list"></i><h3>No Issues Yet</h3><p>Issues will appear here after reports are reviewed and consolidated.</p></div>`;
    return;
  }
  wrap.innerHTML = issues.map(i=>{
    const overdue = i.TargetDate && i.TargetDate<Date.now() && i.Status!=='Resolved';
    return `
    <div class="a-record-card" style="cursor:pointer;" onclick="openIssueDetailAdmin('${i.IssueID}')">
      <div class="row"><b>${ilEsc(i.IssueID)}</b> <span class="badge ${ilBadgeClass(i.PriorityLevel)}">${ilEsc(i.PriorityLevel)}</span></div>
      <div class="row"><span>${ilEsc(i.Title)}</span><span class="badge ${ilBadgeClass(i.Status)}">${ilEsc(i.Status)}</span></div>
      <div class="row"><span>${ilEsc(i.Category)} · ${i.LinkedReportCount||1} linked</span><span>${overdue?'<span class="overdue">OVERDUE</span>':''}</span></div>
    </div>`;
  }).join('');
}

function openIssueDetailAdmin(issueId){
  const issue = ilGetIssues().find(i=>i.IssueID===issueId);
  if(!issue) return;
  A.currentIssueId = issueId;
  const reports = ilGetReports().filter(r=>r.IssueID===issueId);
  const updates = ilGetUpdates().filter(u=>u.IssueID===issueId).sort((a,b)=>a.UpdatedAt-b.UpdatedAt);
  const depts = ilGetDepartments();
  const statuses = ['Reported','Under Review','Verified','Assigned','In Progress','Resolved','Reopened','Rejected'];
  document.getElementById('modalRoot').innerHTML = `
    <div class="modal-overlay" onclick="if(event.target===this)closeModal()">
      <div class="modal" style="max-width:680px;">
        <button class="modal-close" onclick="closeModal()"><i class="fa-solid fa-xmark"></i></button>
        <h2>${ilEsc(issue.Title)} <small style="color:#94A3B8;">${ilEsc(issue.IssueID)}</small></h2>
        <p><span class="badge ${ilBadgeClass(issue.Status)}">${ilEsc(issue.Status)}</span> <span class="badge ${ilBadgeClass(issue.PriorityLevel)}">${ilEsc(issue.PriorityLevel)}</span> ${issue.IsRecurring?'<span class="badge" style="background:#7C3AED;">Recurring</span>':''}</p>
        <p>${ilEsc(issue.Description)}</p>
        <div class="review-row"><span>Priority Score</span><span>${issue.PriorityScore}/100</span></div>
        <div class="review-row"><span>Linked Reports</span><span>${issue.LinkedReportCount||1}</span></div>
        <div class="review-row"><span>Affected Count</span><span>${issue.AffectedCount||0}</span></div>
        <ul class="factor-list">
          <li><i class="fa-solid fa-check"></i> Severity level: ${ilEsc(issue.HighestSeverity||'—')}</li>
          <li><i class="fa-solid fa-check"></i> ${issue.AffectedCount||0} residents affected</li>
          <li><i class="fa-solid fa-check"></i> ${issue.LinkedReportCount||1} linked report(s)</li>
          <li><i class="fa-solid fa-check"></i> Aging: ${Math.round((Date.now()-issue.CreatedAt)/86400000)} day(s) open</li>
        </ul>
        <hr class="sep">
        <h3>Status &amp; Assignment</h3>
        <label>Status</label>
        <select id="issStatusSel">${statuses.map(s=>`<option ${s===issue.Status?'selected':''}>${s}</option>`).join('')}</select>
        <label>Assigned Department</label>
        <select id="issDeptSel"><option value="">— None —</option>${depts.map(d=>`<option ${d.DepartmentName===issue.AssignedDepartment?'selected':''}>${ilEsc(d.DepartmentName)}</option>`).join('')}</select>
        <label>Assigned Staff</label>
        <input type="text" id="issStaffInput" value="${ilEsc(issue.AssignedStaff||'')}" placeholder="Staff member name">
        <label>Target Date</label>
        <input type="text" id="issTargetInput" value="${issue.TargetDate? new Date(issue.TargetDate).toISOString().slice(0,10):''}" placeholder="YYYY-MM-DD">
        <label>Update Message (visible to residents)</label>
        <textarea id="issMsgInput" placeholder="Optional public note"></textarea>
        <button class="btn btn-primary" onclick="saveIssueUpdate('${issueId}')"><i class="fa-solid fa-floppy-disk"></i> Save Update</button>
        <hr class="sep">
        <h3><i class="fa-solid fa-list"></i> Linked Reports (${reports.length})</h3>
        ${reports.map(r=>`
          <div class="a-record-card">
            <div class="row"><b>${ilEsc(r.ReportCode)}</b><span class="badge ${ilBadgeClass(r.Severity)}">${ilEsc(r.Severity)}</span></div>
            <div class="row"><span>${ilEsc(r.Title)}</span></div>
            ${r.PhotoURLs&&r.PhotoURLs[0]?`<img src="${r.PhotoURLs[0]}" class="evidence-img" style="max-height:140px;" onclick="window.open(this.src,'_blank')">`:'<p style="font-size:13px;">No photo evidence attached.</p>'}
          </div>`).join('')}
        <hr class="sep">
        <h3>Timeline</h3>
        <ul class="timeline">${updates.map(u=>`<li><b>${ilEsc(u.Status)}</b> ${u.Internal?'<i class="fa-solid fa-lock" title="Internal"></i>':''}<br><span class="t-time">${ilFmtDate(u.UpdatedAt)} — ${ilEsc(u.UpdatedBy)}</span>${u.Message?`<div>${ilEsc(u.Message)}</div>`:''}</li>`).join('')}</ul>
      </div>
    </div>`;
}
function saveIssueUpdate(issueId){
  const issues = ilGetIssues();
  const idx = issues.findIndex(i=>i.IssueID===issueId);
  if(idx===-1) return;
  const newStatus = document.getElementById('issStatusSel').value;
  const dept = document.getElementById('issDeptSel').value;
  const staff = document.getElementById('issStaffInput').value.trim();
  const targetStr = document.getElementById('issTargetInput').value;
  const msg = document.getElementById('issMsgInput').value.trim();
  const prevStatus = issues[idx].Status;
  issues[idx].Status = newStatus;
  issues[idx].AssignedDepartment = dept;
  issues[idx].AssignedStaff = staff;
  issues[idx].TargetDate = targetStr ? new Date(targetStr).getTime() : null;
  if(newStatus==='Resolved' && prevStatus!=='Resolved') issues[idx].ResolvedAt = Date.now();
  if(newStatus==='Reopened') issues[idx].ReopenedAt = Date.now();
  ilSave(IL_KEYS.issues, issues);
  if(newStatus!==prevStatus) ilAddTimeline(issueId, newStatus, msg, false, aSession().Name);
  else if(msg) ilAddTimeline(issueId, newStatus, msg, false, aSession().Name);
  ilRecalcIssue(issueId);
  ilToast('Status updated successfully.','success');
  closeModal(); goSection('issues');
}

/* ---------------- Analytics ---------------- */
function renderAnalytics(){
  const issues = ilGetIssues(), reports = ilGetReports(), confirmations = ilGetConfirmations();
  const wrap = document.getElementById('analyticsWrap');
  if(issues.length===0 && reports.length===0){
    wrap.innerHTML = `<div class="empty-state"><i class="fa-solid fa-chart-simple"></i><h3>No Analytics Data</h3><p>Analytics will appear after reports and issues are created.</p></div>`;
    return;
  }
  const byCat = {}; reports.forEach(r=>byCat[r.Category]=(byCat[r.Category]||0)+1);
  const byStatus = {}; issues.forEach(i=>byStatus[i.Status]=(byStatus[i.Status]||0)+1);
  const byPriority = {}; issues.forEach(i=>byPriority[i.PriorityLevel]=(byPriority[i.PriorityLevel]||0)+1);
  const resolved = issues.filter(i=>i.ResolvedAt);
  const avgResolutionDays = resolved.length ? (resolved.reduce((s,i)=>s+(i.ResolvedAt-i.CreatedAt),0)/resolved.length/86400000).toFixed(1) : '—';
  const verifyResults = {}; confirmations.forEach(c=>{ if(['Yes, fixed','Partially fixed','Still a problem'].includes(c.Response)) verifyResults[c.Response]=(verifyResults[c.Response]||0)+1; });
  const bar = (obj)=> Object.entries(obj).sort((a,b)=>b[1]-a[1]).map(([k,v])=>{
    const max = Math.max(...Object.values(obj),1);
    return `<div style="margin-bottom:8px;"><div style="display:flex;justify-content:space-between;font-size:14px;"><span>${ilEsc(k)}</span><span>${v}</span></div><div class="score-bar"><div style="width:${(v/max)*100}%;"></div></div></div>`;
  }).join('') || '<p style="color:#94A3B8;">No data yet.</p>';
  wrap.innerHTML = `
    <div class="a-grid">
      <div class="a-card"><h3><i class="fa-solid fa-tags"></i> Category Distribution</h3>${bar(byCat)}</div>
      <div class="a-card"><h3><i class="fa-solid fa-list-check"></i> Status Distribution</h3>${bar(byStatus)}</div>
      <div class="a-card"><h3><i class="fa-solid fa-fire"></i> Priority Distribution</h3>${bar(byPriority)}</div>
      <div class="a-card"><h3><i class="fa-solid fa-thumbs-up"></i> Verification Results</h3>${bar(verifyResults)}</div>
    </div>
    <div class="a-card">
      <h3><i class="fa-solid fa-stopwatch"></i> Key Metrics</h3>
      <p>Average Resolution Time: <b>${avgResolutionDays}</b> days</p>
      <p>Recurring Issues: <b>${issues.filter(i=>i.IsRecurring).length}</b></p>
      <p>Total Linked Reports: <b>${reports.filter(r=>r.IssueID).length}</b> of ${reports.length}</p>
    </div>`;
}

/* ---------------- Settings ---------------- */
function renderSettings(){
  const settings = ilGetSettings();
  document.getElementById('storageModeSel').value = settings.storageMode || 'Local Only';
  document.getElementById('scriptUrlInput').value = settings.scriptUrl || '';
  document.getElementById('lastSyncText').textContent = settings.lastSync ? ilFmtDate(settings.lastSync) : 'Never';
  document.getElementById('syncStatusText').textContent = settings.storageMode==='Google Sheets Sync' ? 'Enabled (automatic sync)' : 'Local Only';
  renderCategoriesAdmin(); renderDepartmentsAdmin(); renderAdminsAdmin();
  // resident link
  const url = new URL(window.location.href);
  url.search = '';
  url.hash = '';
  if(/(?:^|\/)index\.html$/i.test(url.pathname)){
    url.pathname = url.pathname.replace(/index\.html$/i, 'residents.html');
  }else if(!url.pathname.endsWith('/')){
    url.pathname = url.pathname.replace(/[^/]*$/, 'residents.html');
  }else{
    url.pathname += 'residents.html';
  }
  // Embed the Apps Script endpoint in the public link. This is what lets a
  // resident's phone use the same centralized backend without sharing localStorage.
  if(settings.storageMode==='Google Sheets Sync' && settings.scriptUrl){
    url.searchParams.set('script', ilNormalizeScriptUrl(settings.scriptUrl));
  }
  document.getElementById('residentLinkInput').value = url.href;
}
function saveDataSyncSettings(){
  const settings = ilGetSettings();
  settings.storageMode = document.getElementById('storageModeSel').value;
  settings.scriptUrl = ilNormalizeScriptUrl(document.getElementById('scriptUrlInput').value.trim());
  const saved = ilSave(IL_KEYS.settings, settings);
  const verify = ilGetSettings();
  const ok = saved && verify.scriptUrl === settings.scriptUrl && verify.storageMode === settings.storageMode;
  if(!ok){
    ilToast('Settings could not be saved to this browser. Open IssueLink from a normal web address (not a restricted file page).','error');
    return;
  }
  ilToast('Settings saved locally.','success');
  renderSettings();
}
function testConnection(){
  const settings = ilGetSettings();
  if(!settings.scriptUrl){ ilToast('Please enter a Google Apps Script Web App URL first.','error'); return; }
  ilToast('Testing connection…','info');
  fetch(settings.scriptUrl+'?action=ping').then(r=>r.json()).then(d=>{
    ilToast('Connection successful.','success');
  }).catch(()=>{
    ilToast('Connection unavailable. Local Mode continues working.','error');
  });
}
async function syncNow(silent=false){
  const settings = ilGetSettings();
  if(settings.storageMode!=='Google Sheets Sync' || !settings.scriptUrl){
    if(!silent) ilToast('Enable Google Sheets Sync and set a script URL first.','error');
    return false;
  }
  const btn = document.getElementById('syncNowBtn');
  if(btn && btn.disabled) return false;
  if(btn){ btn.disabled=true; btn.dataset.originalHtml=btn.innerHTML; btn.innerHTML='<i class="fa-solid fa-spinner fa-spin"></i> Syncing…'; }
  if(!silent) ilToast('Synchronizing with Google Sheets…','info');
  try{
    const payload = {
      action:'syncAll',
      reports: ilGetReports(),
      issues: ilGetIssues(),
      updates: ilGetUpdates(),
      confirmations: ilGetConfirmations(),
      categories: ilLoad(IL_KEYS.categories, []),
      departments: ilLoad(IL_KEYS.departments, []),
      admins: (ilGetSettings().admins || DEFAULT_ADMINS)
    };
    const response = await fetch(settings.scriptUrl, {
      method:'POST', headers:{'Content-Type':'text/plain;charset=utf-8'},
      body:JSON.stringify(payload), redirect:'follow', cache:'no-store'
    });
    if(!response.ok) throw new Error('HTTP '+response.status);
    const result = await response.json();
    if(!result || !result.ok) throw new Error((result && result.error) || 'The Apps Script bridge rejected the sync.');

    // Server data is authoritative after the local batch has been pushed.
    if(Array.isArray(result.reports)) ilSave(IL_KEYS.reports, result.reports);
    if(Array.isArray(result.issues)) ilSave(IL_KEYS.issues, result.issues);
    if(Array.isArray(result.updates)) ilSave(IL_KEYS.updates, result.updates);
    if(Array.isArray(result.confirmations)) ilSave(IL_KEYS.confirmations, result.confirmations);
    if(Array.isArray(result.categories) && result.categories.length) ilSave(IL_KEYS.categories, result.categories);
    if(Array.isArray(result.departments) && result.departments.length) ilSave(IL_KEYS.departments, result.departments);
    if(Array.isArray(result.admins)){
      const st=ilGetSettings();
      const localAdmins=st.admins||[];
      const byId=new Map(localAdmins.filter(a=>a&&a.AdminID).map(a=>[String(a.AdminID),a]));
      st.admins=result.admins.map(remote=>{
        const local=byId.get(String(remote.AdminID));
        return local && local.Password ? Object.assign({},remote,{Password:local.Password}) : remote;
      });
      ilSave(IL_KEYS.settings,st);
    }
    const updated = ilGetSettings();
    updated.lastSync=Date.now();
    ilSave(IL_KEYS.settings, updated);
    if(!silent) ilToast('Synchronization completed successfully.','success');
    renderDashboard();
    if(A.section!=='dashboard') goSection(A.section);
    return true;
  }catch(err){
    console.error('IssueLink sync error:',err);
    if(!silent) ilToast('Synchronization failed — Local Mode remains active. Check the Web App URL, deployment access, and Apps Script code.','error');
    return false;
  }finally{
    if(btn){ btn.disabled=false; btn.innerHTML=btn.dataset.originalHtml || '<i class="fa-solid fa-rotate"></i> Sync Now'; }
    renderSettings();
  }
}

function renderCategoriesAdmin(){
  const cats = ilLoad(IL_KEYS.categories, []);
  document.getElementById('categoriesWrap').innerHTML = cats.map(c=>`
    <div class="a-record-card"><div class="row"><span>${ilEsc(c.CategoryName)}</span>
    <span><button class="btn btn-sm btn-muted" onclick="toggleCategory('${c.CategoryID}')">${c.Active===false?'Enable':'Disable'}</button></span></div></div>`).join('');
}
async function addCategory(){
  const input = document.getElementById('newCategoryInput');
  const name = input.value.trim();
  if(!name){ ilToast('Enter a category name.','error'); return; }
  const category={CategoryID:ilId('C',5), CategoryName:name, Description:'', Active:true};
  const cats = ilLoad(IL_KEYS.categories, []); cats.push(category);
  ilSave(IL_KEYS.categories, cats); input.value=''; renderCategoriesAdmin();
  if(ilGetSettings().storageMode==='Google Sheets Sync' && ilGetSettings().scriptUrl){
    try{ await ilCloudPost('saveCategory',{category}); ilToast('Category added and synced.','success'); }
    catch(e){ ilToast('Category added locally, but cloud sync failed.','error'); }
  }else ilToast('Category added.','success');
}
function toggleCategory(id){
  const cats = ilLoad(IL_KEYS.categories, []);
  const idx = cats.findIndex(c=>c.CategoryID===id);
  if(idx!==-1){ cats[idx].Active = cats[idx].Active===false ? true : false; ilSave(IL_KEYS.categories, cats); renderCategoriesAdmin(); }
}
function renderDepartmentsAdmin(){
  const deps = ilLoad(IL_KEYS.departments, []);
  document.getElementById('departmentsWrap').innerHTML = deps.map(d=>`
    <div class="a-record-card"><div class="row"><span>${ilEsc(d.DepartmentName)}</span>
    <span><button class="btn btn-sm btn-muted" onclick="toggleDepartment('${d.DepartmentID}')">${d.Active===false?'Enable':'Disable'}</button></span></div></div>`).join('');
}
async function addDepartment(){
  const input = document.getElementById('newDeptInput');
  const name = input.value.trim();
  if(!name){ ilToast('Enter a department name.','error'); return; }
  const department={DepartmentID:ilId('D',5), DepartmentName:name, Description:'', Active:true};
  const deps = ilLoad(IL_KEYS.departments, []); deps.push(department);
  ilSave(IL_KEYS.departments, deps); input.value=''; renderDepartmentsAdmin();
  if(ilGetSettings().storageMode==='Google Sheets Sync' && ilGetSettings().scriptUrl){
    try{ await ilCloudPost('saveDepartment',{department}); ilToast('Department added and synced.','success'); }
    catch(e){ ilToast('Department added locally, but cloud sync failed.','error'); }
  }else ilToast('Department added.','success');
}
function toggleDepartment(id){
  const deps = ilLoad(IL_KEYS.departments, []);
  const idx = deps.findIndex(d=>d.DepartmentID===id);
  if(idx!==-1){ deps[idx].Active = deps[idx].Active===false ? true : false; ilSave(IL_KEYS.departments, deps); renderDepartmentsAdmin(); }
}
function renderAdminsAdmin(){
  const s = ilGetSettings();
  const wrap = document.getElementById('adminsWrap');
  if(!wrap) return;
  const isSuper = aSession().Role==='Super Admin';
  wrap.innerHTML = (s.admins||[]).map(a=>`
    <div class="a-record-card"><div class="row"><span>${ilEsc(a.Name)} (${ilEsc(a.Role)})</span><span>${ilEsc(a.Email)}</span></div>
    ${isSuper?`<div class="row"><span>Status: ${ilEsc(a.Status)}</span><button class="btn btn-sm btn-muted" onclick="toggleAdminStatus('${a.AdminID}')">Toggle</button></div>`:''}</div>`).join('');
}
async function toggleAdminStatus(id){
  const s = ilGetSettings();
  const idx = s.admins.findIndex(a=>a.AdminID===id);
  if(idx!==-1 && s.admins[idx].Role!=='Super Admin'){
    s.admins[idx].Status = s.admins[idx].Status==='Active'?'Inactive':'Active';
    const admin=s.admins[idx];
    ilSave(IL_KEYS.settings,s); renderAdminsAdmin();
    if(s.storageMode==='Google Sheets Sync' && s.scriptUrl){
      try{ await ilCloudPost('saveAdmin',{admin}); ilToast('Admin status updated and synced.','success'); }
      catch(e){ ilToast('Admin status changed locally, but cloud sync failed.','error'); }
    }
  }
}
async function addAdmin(){
  const name = document.getElementById('newAdminName').value.trim();
  const email = document.getElementById('newAdminEmail').value.trim();
  const pass = document.getElementById('newAdminPass').value;
  const role = document.getElementById('newAdminRole').value;
  if(!name||!email||!pass){ ilToast('Please fill in all fields.','error'); return; }
  const s = ilGetSettings();
  if(!s.admins) s.admins=[];
  if(s.admins.some(a=>a.Email && a.Email.toLowerCase()===email.toLowerCase())){ ilToast('An admin with that email already exists.','error'); return; }
  const admin = {AdminID:ilId('A',5), Name:name, Email:email, Password:pass, Role:role, Department:'', Status:'Active', CreatedAt:Date.now(), LastLogin:null};
  s.admins.push(admin);
  if(!ilSave(IL_KEYS.settings, s)) { ilToast('Admin could not be saved locally.','error'); return; }
  document.getElementById('newAdminName').value=''; document.getElementById('newAdminEmail').value=''; document.getElementById('newAdminPass').value='';
  renderAdminsAdmin();
  if(ilGetSettings().storageMode==='Google Sheets Sync' && ilGetSettings().scriptUrl){
    try{
      await ilCloudPost('saveAdmin',{admin});
      ilToast('Admin account created and saved to Google Sheets.','success');
      await syncNow(true);
    }catch(err){
      console.error('IssueLink admin cloud save failed:',err);
      ilToast('Admin created locally, but Google Sheets sync failed. Use Refresh & Sync after checking the Web App URL.','error');
    }
  }else{
    ilToast('Admin account created locally. Enable Google Sheets Sync to centralize it.','success');
  }
}

async function forceRefreshDashboard(){
  const btn=document.getElementById('dashboardRefreshBtn');
  if(btn && btn.disabled) return;
  if(btn){ btn.disabled=true; btn.dataset.originalHtml=btn.innerHTML; btn.innerHTML='<i class="fa-solid fa-spinner fa-spin"></i> Refreshing…'; }
  try{
    const settings=ilGetSettings();
    if(settings.storageMode==='Google Sheets Sync' && settings.scriptUrl){
      await syncNow(true);
      renderDashboard();
      if(A.section==='reports') renderReports();
      if(A.section==='issues') renderIssuesAdmin();
      if(A.section==='linking') renderLinking();
      if(A.section==='analytics') renderAnalytics();
      if(A.section==='settings') renderSettings();
      ilToast('Dashboard refreshed from Google Sheets.','success');
    }else{
      renderDashboard();
      ilToast('Dashboard refreshed from local data.','info');
    }
  }catch(err){
    console.error(err); ilToast('Refresh failed. Check Google Sheets Sync settings.','error');
  }finally{
    if(btn){ btn.disabled=false; btn.innerHTML=btn.dataset.originalHtml || '<i class="fa-solid fa-arrows-rotate"></i> Refresh & Sync'; }
  }
}

function copyResidentLink(){
  const input = document.getElementById('residentLinkInput');
  input.select();
  navigator.clipboard?.writeText(input.value).then(()=>ilToast('Link copied.','success')).catch(()=>ilToast('Copy failed — please copy manually.','error'));
}
function generateQR(){
  const url = document.getElementById('residentLinkInput').value;
  const qrWrap = document.getElementById('qrWrap');
  qrWrap.innerHTML = `<div class="qr-box">${ilSimpleQR(url)}</div><p style="font-size:12px;color:#94A3B8;">Scan to open the Residents Portal</p>`;
}
// Lightweight client-side QR-like placeholder using a matrix pattern derived from URL hash (no external API).
function ilSimpleQR(text){
  // deterministic pseudo-random matrix seeded from text for a scannable-looking pattern (visual aid; not a real QR spec).
  let seed=0; for(let i=0;i<text.length;i++) seed=(seed*31+text.charCodeAt(i))>>>0;
  function rnd(){ seed=(seed*1664525+1013904223)>>>0; return seed/4294967296; }
  const size=21, cell=8;
  let svg = `<svg width="${size*cell}" height="${size*cell}" xmlns="http://www.w3.org/2000/svg"><rect width="100%" height="100%" fill="#fff"/>`;
  for(let y=0;y<size;y++) for(let x=0;x<size;x++){
    const isFinder = (x<7&&y<7)||(x>size-8&&y<7)||(x<7&&y>size-8);
    let on;
    if(isFinder){
      const lx = x<7?x:(x>size-8?x-(size-7):x), ly = y<7?y:(y>size-8?y-(size-7):y);
      on = (lx===0||lx===6||ly===0||ly===6||(lx>=2&&lx<=4&&ly>=2&&ly<=4));
    } else { on = rnd()>0.55; }
    if(on) svg += `<rect x="${x*cell}" y="${y*cell}" width="${cell}" height="${cell}" fill="#000"/>`;
  }
  svg += '</svg>';
  return svg;
}

/* ---------------- Demo Data / Clear ---------------- */
function loadDemoData(){
  if(!confirm('Load demo data? This will add sample reports and issues.')) return;
  const now = Date.now();
  const cats = ['Road Damage','Flooding','Garbage','Streetlight'];
  const reports = ilGetReports();
  const issues = ilGetIssues();
  const placeholderPhoto = 'data:image/svg+xml;base64,'+btoa('<svg xmlns="http://www.w3.org/2000/svg" width="300" height="200"><rect width="100%" height="100%" fill="#94A3B8"/><text x="50%" y="50%" font-size="16" fill="#fff" text-anchor="middle">Demo Evidence Photo</text></svg>');
  const issue1 = {IssueID:ilNextIssueNum(), Category:'Road Damage', Title:'Large pothole on Main Street', Description:'Deep pothole causing vehicle damage near the Main St intersection.', PublicDescription:'Deep pothole causing vehicle damage near the Main St intersection.', Latitude:14.6091, Longitude:121.0223, LocationText:'Main St & 3rd Ave', PriorityScore:0, PriorityLevel:'Low', LinkedReportCount:0, AffectedCount:0, Status:'In Progress', AssignedDepartment:'Public Works', AssignedStaff:'J. Santos', TargetDate:now+7*86400000, CreatedAt:now-6*86400000, UpdatedAt:now, ResolvedAt:null, ReopenedAt:null, IsRecurring:true};
  issues.push(issue1);
  for(let i=0;i<4;i++){
    reports.push({ReportID:ilId('R',7), ReportCode:ilId('IL-RP-',5), IssueID:issue1.IssueID, Category:'Road Damage', Title:'Pothole near Main St', Description:'Same pothole reported by another resident.', Latitude:14.6091+ (Math.random()*0.001), Longitude:121.0223+(Math.random()*0.001), LocationText:'Main St & 3rd Ave', Severity: i===0?'Critical':'High', PhotoURLs:[placeholderPhoto], SubmittedAt: now-(6-i)*86400000, Status:'Reported', AnonymousReporterID: ilId('ANON-',5)});
  }
  const issue2 = {IssueID:ilNextIssueNum(), Category:'Flooding', Title:'Recurring flooding on Elm Street', Description:'Street floods every heavy rain due to clogged drainage.', PublicDescription:'Street floods every heavy rain due to clogged drainage.', Latitude:14.61, Longitude:121.03, LocationText:'Elm Street', PriorityScore:0, PriorityLevel:'Low', LinkedReportCount:0, AffectedCount:0, Status:'Verified', AssignedDepartment:'Sanitation', AssignedStaff:'', TargetDate:now+3*86400000, CreatedAt:now-10*86400000, UpdatedAt:now, ResolvedAt:null, ReopenedAt:null, IsRecurring:true};
  issues.push(issue2);
  for(let i=0;i<3;i++){
    reports.push({ReportID:ilId('R',7), ReportCode:ilId('IL-RP-',5), IssueID:issue2.IssueID, Category:'Flooding', Title:'Flooding on Elm St', Description:'Water pooling after rain, blocks pathway.', Latitude:14.61, Longitude:121.03, LocationText:'Elm Street', Severity:'Medium', PhotoURLs:[placeholderPhoto], SubmittedAt: now-(9-i)*86400000, Status:'Reported', AnonymousReporterID: ilId('ANON-',5)});
  }
  const issue3 = {IssueID:ilNextIssueNum(), Category:'Streetlight', Title:'Broken streetlight on Oak Ave', Description:'Streetlight has been out for two weeks, safety concern at night.', PublicDescription:'Streetlight has been out for two weeks, safety concern at night.', Latitude:14.615, Longitude:121.02, LocationText:'Oak Avenue', PriorityScore:0, PriorityLevel:'Low', LinkedReportCount:0, AffectedCount:0, Status:'Resolved', AssignedDepartment:'Utilities', AssignedStaff:'M. Cruz', TargetDate:now-2*86400000, CreatedAt:now-15*86400000, UpdatedAt:now, ResolvedAt:now-1*86400000, ReopenedAt:null, IsRecurring:false};
  issues.push(issue3);
  reports.push({ReportID:ilId('R',7), ReportCode:ilId('IL-RP-',5), IssueID:issue3.IssueID, Category:'Streetlight', Title:'Streetlight out on Oak Ave', Description:'Light pole #12 not working.', Latitude:14.615, Longitude:121.02, LocationText:'Oak Avenue', Severity:'High', PhotoURLs:[placeholderPhoto], SubmittedAt: now-15*86400000, Status:'Reported', AnonymousReporterID: ilId('ANON-',5)});
  // an unlinked, uncategorized report to show possible matches
  reports.push({ReportID:ilId('R',7), ReportCode:ilId('IL-RP-',5), IssueID:null, Category:'Road Damage', Title:'Pothole by Main Street intersection', Description:'Another pothole near the same intersection causing damage.', Latitude:14.6092, Longitude:121.0224, LocationText:'Main St & 3rd Ave', Severity:'High', PhotoURLs:[placeholderPhoto], SubmittedAt: now-1*86400000, Status:'Reported', AnonymousReporterID: ilId('ANON-',5)});
  reports.push({ReportID:ilId('R',7), ReportCode:ilId('IL-RP-',5), IssueID:null, Category:'Garbage', Title:'Overflowing garbage bins', Description:'Bins have not been collected in over a week.', Latitude:14.618, Longitude:121.025, LocationText:'Park Road', Severity:'Medium', PhotoURLs:[placeholderPhoto], SubmittedAt: now-2*86400000, Status:'Reported', AnonymousReporterID: ilId('ANON-',5)});

  ilSave(IL_KEYS.reports, reports);
  ilSave(IL_KEYS.issues, issues);
  ilAddTimeline(issue1.IssueID,'Reported','Issue created.',false,'System'); ilAddTimeline(issue1.IssueID,'Assigned','Assigned to Public Works.',false,'System'); ilAddTimeline(issue1.IssueID,'In Progress','Repair crew dispatched.',false,'System');
  ilAddTimeline(issue2.IssueID,'Reported','Issue created.',false,'System'); ilAddTimeline(issue2.IssueID,'Verified','Confirmed by field inspection.',false,'System');
  ilAddTimeline(issue3.IssueID,'Reported','Issue created.',false,'System'); ilAddTimeline(issue3.IssueID,'Resolved','Streetlight replaced.',false,'System');
  const confirmations = ilGetConfirmations();
  confirmations.push({ConfirmationID:ilId('CF',6), IssueID:issue3.IssueID, ReportID:null, Response:'Yes, fixed', SubmittedAt:now-12*3600000, AnonymousResidentID:ilId('ANON-',5)});
  confirmations.push({ConfirmationID:ilId('CF',6), IssueID:issue1.IssueID, ReportID:null, Response:'Affected', SubmittedAt:now-1*86400000, AnonymousResidentID:ilId('ANON-',5)});
  ilSave(IL_KEYS.confirmations, confirmations);
  [issue1.IssueID, issue2.IssueID, issue3.IssueID].forEach(ilRecalcIssue);
  ilToast('Demo data loaded.','success');
  goSection('dashboard');
}
function clearAllData(){
  if(!confirm('Clear ALL local IssueLink data? This cannot be undone.')) return;
  [IL_KEYS.reports, IL_KEYS.issues, IL_KEYS.updates, IL_KEYS.confirmations].forEach(k=>ilSave(k, []));
  Object.keys(localStorage).filter(k=>k.startsWith('issuelink_affected_')).forEach(k=>localStorage.removeItem(k));
  ilToast('All local data cleared.','success');
  goSection('dashboard');
}

document.addEventListener('DOMContentLoaded', ()=>{
  document.getElementById('loginBtn').addEventListener('click', doLogin);
  document.getElementById('loginPass').addEventListener('keydown', e=>{ if(e.key==='Enter') doLogin(); });
  document.getElementById('logoutBtn').addEventListener('click', doLogout);
  document.querySelectorAll('.a-nav-link').forEach(l=>l.addEventListener('click', ()=>goSection(l.dataset.sec)));
  document.getElementById('hamburgerBtn').addEventListener('click', ()=>document.getElementById('a-sidebar').classList.toggle('open'));
  ['repFilterKw','repFilterCat','repFilterStatus'].forEach(id=>{ const el=document.getElementById(id); if(el) el.addEventListener('input', renderReports); });
  document.getElementById('issFilterStatus').addEventListener('change', renderIssuesAdmin);
  document.getElementById('loadDemoBtn').addEventListener('click', loadDemoData);
  document.getElementById('clearDataBtn').addEventListener('click', clearAllData);
  document.getElementById('saveSyncBtn').addEventListener('click', saveDataSyncSettings);
  document.getElementById('testConnBtn').addEventListener('click', testConnection);
  document.getElementById('syncNowBtn').addEventListener('click', syncNow);
  document.getElementById('dashboardRefreshBtn').addEventListener('click', forceRefreshDashboard);
  document.getElementById('addCategoryBtn').addEventListener('click', addCategory);
  document.getElementById('addDeptBtn').addEventListener('click', addDepartment);
  document.getElementById('addAdminBtn').addEventListener('click', addAdmin);
  document.getElementById('copyLinkBtn').addEventListener('click', copyResidentLink);
  document.getElementById('genQrBtn').addEventListener('click', generateQR);
  document.getElementById('openResidentBtn').addEventListener('click', ()=>window.open(document.getElementById('residentLinkInput').value,'_blank'));
  if(aRequireAuth()){
    goSection('dashboard');
    const syncSettings = ilGetSettings();
    if(syncSettings.storageMode==='Google Sheets Sync' && syncSettings.scriptUrl){
      setTimeout(()=>syncNow(true), 600);
      setInterval(()=>{
        if(document.visibilityState==='visible') syncNow(true);
      }, 30000);
    }
  }
});

window.forceRefreshDashboard=forceRefreshDashboard;
window.openReportDetail=openReportDetail; window.closeModal=closeModal; window.createIssueFromReport=createIssueFromReport;
window.linkReportToIssue=linkReportToIssue; window.mergeTwoReports=mergeTwoReports; window.rejectMatch=rejectMatch;
window.openIssueDetailAdmin=openIssueDetailAdmin; window.saveIssueUpdate=saveIssueUpdate; window.goSection=goSection;
window.toggleCategory=toggleCategory; window.toggleDepartment=toggleDepartment; window.toggleAdminStatus=toggleAdminStatus;
