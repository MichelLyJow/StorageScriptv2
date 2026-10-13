/* ---------- Firebase init ---------- */
const firebaseConfig = {
  apiKey: "AIzaSyDRcucG7Qr9EKySpSPY2UglZ_WQTmhf6Uo",
  authDomain: "script-web-8d4a7.firebaseapp.com",
  databaseURL: "https://script-web-8d4a7-default-rtdb.asia-southeast1.firebasedatabase.app",
  projectId: "script-web-8d4a7",
  storageBucket: "script-web-8d4a7.firebasestorage.app",
  messagingSenderId: "529307129610",
  appId: "1:529307129610:web:a3f2e4a3b6e0791cec8cf3"
};
firebase.initializeApp(firebaseConfig);
const auth = firebase.auth();
const db = firebase.database();

/* Isi API key Gemini kamu di sini (ambil dari https://aistudio.google.com/apikey) */
let GEMINI_API_KEY = "AQ.Ab8RN6JXLOI3VR9IkwdOJYk7zzvtLpUUwtAGOpyrDMLHrbNssA";
const GEMINI_MODEL = "gemini-flash-lite-latest";

/* ---------- state ---------- */
let authMode = 'login';
let currentSort = 'rec';
let currentFilter = 'all';
let currentGame = null;
let gamesCache = {};
let upGameId = null, upGameName = '', upGameImage = null, upGameUniverse = null;
let upKeySys = 'keyless';
let slotCount = 0;
let currentDetailId = null;
let currentDetailAuthorUid = null;
let editingPostId = null;
let pendingThumbData = null;
let existingThumbUrl = null;
let pendingAvatarData = null;

function compressImageToDataURL(file, maxDim, quality){
  return new Promise((resolve, reject)=>{
    const reader = new FileReader();
    reader.onload = ev=>{
      const img = new Image();
      img.onload = ()=>{
        let w = img.width, h = img.height;
        if(w > maxDim || h > maxDim){
          if(w >= h){ h = Math.round(h * maxDim / w); w = maxDim; }
          else { w = Math.round(w * maxDim / h); h = maxDim; }
        }
        const canvas = document.createElement('canvas');
        canvas.width = w; canvas.height = h;
        canvas.getContext('2d').drawImage(img, 0, 0, w, h);
        resolve(canvas.toDataURL('image/jpeg', quality));
      };
      img.onerror = ()=>reject(new Error('Failed to read image'));
      img.src = ev.target.result;
    };
    reader.onerror = ()=>reject(new Error('Failed to read file'));
    reader.readAsDataURL(file);
  });
}

let currentUid = null;
let loadersCache = {}, loadersQuery = null, editingLoaderId = null;
let currentUsername = null;
let currentUserData = {};
let postsCache = {};
let usersCache = {};
let feedbackCache = {};
let myFollowersCount = 0;
let overridesCache = {followers:{}, likes:{}}, usersOverride = null;
let banWatch = null, delWatch = null, bansRef = null, bansCache = {}, viewingFollowersReal = 0;
let myFollowingCount = 0;
let viewingUid = null;
let dmIndexCache = {};
let currentDmChatId = null;
let currentDmOtherUid = null;
let currentDmOtherName = null;
let currentDmOtherAvatar = null;
let dmMessagesRef = null;

function isDeveloper(username){ return !!username && username.toLowerCase() === 'michellyjow'; }
function withTimeout(promise, ms, label){
  return Promise.race([
    promise,
    new Promise((_, reject)=>setTimeout(()=>reject(new Error(
      label+' did not respond within '+(ms/1000)+' seconds — check Rules/feature status in Firebase Console, or your internet connection.'
    )), ms))
  ]);
}
function avatarInner(username, avatarUrl){
  if(avatarUrl) return `<img src="${avatarUrl}" style="width:100%;height:100%;object-fit:cover;border-radius:50%;">`;
  return (username||'?').charAt(0).toUpperCase();
}
function devBadge(username){
  return isDeveloper(username) ? '<svg class="devCheck" viewBox="0 0 24 24" aria-label="Developer"><circle cx="12" cy="12" r="10" fill="#3b82f6"/><path d="m7.5 12.3 3 3 6-6.6" fill="none" stroke="#fff" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>' : '';
}
function postsArray(){ return Object.entries(postsCache).map(([id,p])=>({id, ...p})); }
function usersArray(){ return Object.entries(usersCache).map(([uid,u])=>({uid, ...u})); }
function getPost(id){ const p = postsCache[id]; return p ? {id, ...p} : null; }
function escapeHTML(s){ return String(s).replace(/[&<>"]/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c])); }
function friendlyAuthError(err){
  const code = (err && err.code) || '';
  if(code.includes('wrong-password') || code.includes('invalid-credential')) return 'Wrong username or password';
  if(code.includes('email-already-in-use')) return 'Username already taken';
  if(code.includes('weak-password')) return 'Password must be at least 6 characters';
  if(code.includes('network')) return 'Connection failed, check your internet';
  return 'An error occurred: ' + ((err && err.message) || 'try again');
}

/* ---------- realtime listeners ---------- */
db.ref('posts').on('value', snap=>{
  postsCache = snap.val() || {};
  updateStats();
  tryDeep();
  if(document.getElementById('page-beranda').classList.contains('active')) renderFeed();
  if(document.getElementById('page-profil').classList.contains('active')) renderProfile();
  if(document.getElementById('page-detail').classList.contains('active') && currentDetailId) renderDetail();
  if(document.getElementById('page-dev').classList.contains('active')) renderDevPanel();
});

db.ref('users').on('value', snap=>{
  usersCache = snap.val() || {};
  updateStats();
  tryDeep();
  if(document.getElementById('page-beranda').classList.contains('active') && currentFilter==='users') renderFeed();
});

/* feedback: only the developer listens (last 60 entries), everyone else just writes */
let fbQuery = null;
function syncFeedbackListener(){
  const want = !!currentUid && isDeveloper(currentUsername);
  if(want && !fbQuery){
    fbQuery = db.ref('feedback').limitToLast(60);
    fbQuery.on('value', snap=>{
      feedbackCache = snap.val() || {};
      if(document.getElementById('page-dev').classList.contains('active')) renderDevPanel();
    }, ()=>{});
  } else if(!want && fbQuery){
    fbQuery.off(); fbQuery = null; feedbackCache = {};
  }
  if(want && !bansRef){
    bansRef = db.ref('bans');
    bansRef.on('value', snap=>{
      bansCache = snap.val() || {};
      if(document.getElementById('page-dev').classList.contains('active')) renderDevUsers();
      updateManageStatus();
    }, ()=>{});
  } else if(!want && bansRef){
    bansRef.off(); bansRef = null; bansCache = {};
  }
}

db.ref('config/geminiApiKey').on('value', snap=>{
  if(snap.exists() && snap.val()){ GEMINI_API_KEY = snap.val(); }
  if(document.getElementById('page-dev').classList.contains('active')) renderDevPanel();
});

auth.onAuthStateChanged(user=>{
  if(user){
    currentUid = user.uid;
    if(banWatch){ banWatch.off(); banWatch = null; }
    if(delWatch){ delWatch.off(); delWatch = null; }
    banWatch = db.ref('bans/'+user.uid);
    banWatch.on('value', snap=>{ const b = snap.val(); if(b && b.until > Date.now()) kickBanned(b); }, ()=>{});
    delWatch = db.ref('deleted/'+user.uid);
    delWatch.on('value', snap=>{ if(snap.val()===true){ auth.signOut(); toast('This account was deleted'); } }, ()=>{});
    db.ref('users/'+currentUid).on('value', snap=>{
      currentUserData = snap.val() || {};
      currentUsername = currentUserData.username || null;
      authReady = true;
      syncFeedbackListener();
      tryDeep();
      renderProfile();
      if(document.getElementById('page-beranda').classList.contains('active')) renderFeed();
      if(document.getElementById('page-detail').classList.contains('active') && currentDetailId) renderDetail();
      if(document.getElementById('page-dev').classList.contains('active')) renderDevPanel();
    });
    db.ref('follows/'+currentUid).on('value', snap=>{
      myFollowersCount = snap.exists() ? Object.keys(snap.val()).length : 0;
      renderProfile();
    });
    db.ref('followingList/'+currentUid).on('value', snap=>{
      myFollowingCount = snap.exists() ? Object.keys(snap.val()).length : 0;
      renderProfile();
    });
    db.ref('aiChats/'+currentUid).on('value', snap=>{
      const val = snap.val() || {};
      aiMessages = Object.entries(val).map(([id,m])=>({id, ...m})).sort((a,b)=>(a.time||0)-(b.time||0));
      if(document.getElementById('page-ai').classList.contains('active')) renderAiChat();
    });
    db.ref('dmIndex/'+currentUid).on('value', snap=>{
      dmIndexCache = snap.val() || {};
      if(document.getElementById('page-inbox').classList.contains('active')) renderInbox();
    });
  } else {
    if(banWatch){ banWatch.off(); banWatch = null; }
    if(delWatch){ delWatch.off(); delWatch = null; }
    currentUid = null;
    currentUsername = null;
    syncFeedbackListener();
    currentUserData = {};
    myFollowersCount = 0;
    myFollowingCount = 0;
    aiMessages = [];
    dmIndexCache = {};
    if(dmMessagesRef){ dmMessagesRef.off(); dmMessagesRef = null; }
    currentDmChatId = null;
    currentDmOtherUid = null;
    authReady = true;
    renderProfile();
    if(document.getElementById('page-inbox').classList.contains('active')) renderInbox();
    if(document.getElementById('page-dev').classList.contains('active')) renderDevPanel();
    tryDeep();
    if(document.getElementById('page-ai').classList.contains('active')) renderAiChat();
  }
});

/* ---------- nav ---------- */
function go(name){
  document.querySelectorAll('.page').forEach(p=>p.classList.remove('active'));
  document.getElementById('page-'+name).classList.add('active');
  document.querySelectorAll('.navItem').forEach(n=>n.classList.remove('active'));
  const navBtn = document.getElementById('nav-'+name);
  if(navBtn) navBtn.classList.add('active');
  if(name==='beranda') renderFeed();
  if(name==='profil') renderProfile();
  if(name==='inbox') renderInbox();
  if(name==='ai') renderAiChat();
  if(name==='gchat') startGlobalChat(); else stopGlobalChat();
  if(name==='game') renderGamePage();
  if(name==='dev') renderDevPanel();
  if(name==='loader'){ resetLoaderForm(); startLoaderList(); } else stopLoaderList();
  document.body.classList.toggle('hideHeader', ['detail','userprofile','dm','gchat','upload','game','dev','loader'].includes(name));
  document.body.classList.toggle('hideNav', ['detail','dm','gchat','upload','game','dev','loader'].includes(name));
  try{ syncUrl(name); }catch(e){}
  window.scrollTo(0,0);
}

/* ---------- toast ---------- */
function toast(msg){
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.add('show');
  setTimeout(()=>t.classList.remove('show'), 2200);
}
function toastError(msg){
  console.error(msg);
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.style.maxWidth = '85vw';
  t.classList.add('show');
  setTimeout(()=>{ t.classList.remove('show'); t.style.maxWidth = ''; }, 5000);
}

/* ---------- auth ---------- */
function openAuth(mode){
  authMode = mode;
  updateAuthModalText();
  document.getElementById('authOverlay').classList.add('show');
}
function closeAuth(){ document.getElementById('authOverlay').classList.remove('show'); }
function switchAuthMode(){ authMode = authMode==='login' ? 'register' : 'login'; updateAuthModalText(); }
function updateAuthModalText(){
  document.getElementById('authEyebrow').textContent = authMode==='login' ? 'LOG IN TO' : 'SIGN UP FOR';
  document.getElementById('authSubmit').textContent = authMode==='login' ? 'Log In' : 'Create Account';
  document.getElementById('authSwitchLine').innerHTML = authMode==='login'
    ? 'Don\'t have an account? <a onclick="switchAuthMode()">Sign up here</a>'
    : 'Already have an account? <a onclick="switchAuthMode()">Log in here</a>';
}
async function submitAuth(){
  const usernameRaw = document.getElementById('authUser').value.trim();
  const pass = document.getElementById('authPass').value;
  if(!usernameRaw || pass.length<6){ toast('Enter username & password (min. 6 characters)'); return; }
  const usernameLower = usernameRaw.toLowerCase();
  const email = usernameLower + '@studioscripts.app';
  try{
    if(authMode==='register'){
      const existing = await withTimeout(db.ref('usernames/'+usernameLower).once('value'), 10000, 'Checking username');
      if(existing.exists()){ toast('Username already taken'); return; }
      const cred = await withTimeout(auth.createUserWithEmailAndPassword(email, pass), 10000, 'Creating account');
      const uid = cred.user.uid;
      await withTimeout(db.ref('users/'+uid).set({username:usernameRaw, name:usernameRaw, bio:'', tiktok:'', youtube:'', avatar:null}), 10000, 'Saving account data');
      await withTimeout(db.ref('usernames/'+usernameLower).set(uid), 10000, 'Registering username');
      toast('Account created! Welcome.');
    } else {
      const snap = await withTimeout(db.ref('usernames/'+usernameLower).once('value'), 10000, 'Checking username');
      if(!snap.exists()){ toast('Username not found'); return; }
      const cred2 = await withTimeout(auth.signInWithEmailAndPassword(email, pass), 10000, 'Logging in');
      try{
        const bs = await db.ref('bans/'+cred2.user.uid).once('value');
        const b = bs.val();
        if(b && b.until > Date.now()){ await auth.signOut(); closeAuth(); showBanScreen(b); return; }
        const ds = await db.ref('deleted/'+cred2.user.uid).once('value');
        if(ds.val()===true){ await auth.signOut(); toast('This account was deleted'); return; }
      }catch(e){}
    }
    closeAuth();
    rememberAccount(usernameRaw);
    document.getElementById('authUser').value='';
    document.getElementById('authPass').value='';
    go('profil');
  }catch(err){
    toastError(friendlyAuthError(err));
  }
}
function logout(){ auth.signOut(); }
function rememberAccount(username){
  let list = JSON.parse(localStorage.getItem('ss_known_accounts')||'[]');
  list = list.filter(u=>u.toLowerCase()!==username.toLowerCase());
  list.unshift(username);
  list = list.slice(0,6);
  localStorage.setItem('ss_known_accounts', JSON.stringify(list));
}
function forgetAccount(username){
  let list = JSON.parse(localStorage.getItem('ss_known_accounts')||'[]');
  list = list.filter(u=>u.toLowerCase()!==username.toLowerCase());
  localStorage.setItem('ss_known_accounts', JSON.stringify(list));
  renderKnownAccounts();
}
function renderKnownAccounts(){
  const list = JSON.parse(localStorage.getItem('ss_known_accounts')||'[]').filter(u=>u.toLowerCase()!==(currentUsername||'').toLowerCase());
  document.getElementById('knownAccountsList').innerHTML = list.length ? list.map(u=>`
    <div style="display:flex; align-items:center; justify-content:space-between; border-bottom:1px solid var(--border); padding:10px 0;">
      <div style="display:flex; align-items:center; gap:10px; cursor:pointer;" onclick="quickSwitchTo('${u.replace(/'/g,"\\'")}')"><div class="miniAvatar">${u.charAt(0).toUpperCase()}</div>@${escapeHTML(u)}</div>
      <div style="display:flex; gap:10px; align-items:center;">
        <button class="btn" style="width:auto; padding:8px 16px;" onclick="quickSwitchTo('${u.replace(/'/g,"\\'")}')">Use</button>
        <button class="replyBtn" onclick="forgetAccount('${u.replace(/'/g,"\\'")}')">Delete</button>
      </div>
    </div>`).join('') : '<div class="empty">No other accounts saved on this device.</div>';
}
function switchAccount(){
  renderKnownAccounts();
  document.getElementById('switchAccountOverlay').classList.add('show');
}
function closeSwitchAccount(){ document.getElementById('switchAccountOverlay').classList.remove('show'); }
async function quickSwitchTo(username){
  closeSwitchAccount();
  await auth.signOut();
  openAuth('login');
  document.getElementById('authUser').value = username;
  document.getElementById('authPass').value = '';
  document.getElementById('authPass').focus();
}
function openNewAccountLogin(){
  closeSwitchAccount();
  openAuth('login');
  document.getElementById('authUser').value = '';
}

/* ---------- profile ---------- */
function renderProfile(){
  const loggedIn = !!currentUid;
  document.getElementById('loggedOutRow').style.display = loggedIn ? 'none' : 'flex';
  document.getElementById('loggedInRow').style.display = loggedIn ? 'flex' : 'none';
  document.getElementById('profileEdit').style.display = 'none';
  document.getElementById('profileView').style.display = 'block';

  if(loggedIn){
    const u = currentUserData || {};
    document.getElementById('avatarInitial').innerHTML = avatarInner(currentUsername, u.avatar);
    document.getElementById('viewName').innerHTML = escapeHTML(u.name || currentUsername) + devBadge(currentUsername);
    document.getElementById('viewUser').textContent = '@'+currentUsername;
    document.getElementById('viewBio').textContent = u.bio || 'No bio yet.';
  } else {
    document.getElementById('avatarInitial').textContent = '?';
    document.getElementById('viewName').textContent = 'Guest';
    document.getElementById('viewUser').textContent = '@guest';
    document.getElementById('viewBio').textContent = 'Log in to create your profile.';
  }
  const mine = loggedIn ? postsArray().filter(p=>p.authorUid===currentUid) : [];
  document.getElementById('statPosts').textContent = mine.length;
  document.getElementById('statFollowing').textContent = loggedIn ? myFollowingCount : 0;
  document.getElementById('statFollowers').textContent = loggedIn ? followersOf(currentUid, myFollowersCount) : 0;
  const totalLikes = mine.reduce((sum,p)=>sum+likesOf(p),0);
  document.getElementById('statLikes').textContent = totalLikes;
  document.getElementById('myPosts').innerHTML = mine.length
    ? mine.map(postCardHTML).join('')
    : '<div class="empty">No scripts uploaded yet.</div>';
}
function editProfile(){
  if(!currentUid) return;
  const u = currentUserData || {};
  pendingAvatarData = null;
  document.getElementById('editAvatarInitial').innerHTML = avatarInner(currentUsername, u.avatar);
  document.getElementById('editName').value = u.name || currentUsername;
  document.getElementById('editUserLabel').textContent = '@'+currentUsername;
  document.getElementById('editBio').value = u.bio || '';
  document.getElementById('editTiktok').value = u.tiktok || '';
  document.getElementById('editYoutube').value = u.youtube || '';
  document.getElementById('profileView').style.display = 'none';
  document.getElementById('profileEdit').style.display = 'block';
}
async function pickAvatar(e){
  const file = e.target.files[0];
  if(!file) return;
  try{
    const dataUrl = await compressImageToDataURL(file, 480, 0.75);
    pendingAvatarData = dataUrl;
    document.getElementById('editAvatarInitial').innerHTML = `<img src="${dataUrl}" style="width:100%;height:100%;object-fit:cover;border-radius:50%;">`;
  }catch(err){
    toastError('Failed to process photo: '+((err && err.message) || 'try again'));
  }
}
function cancelEdit(){ document.getElementById('profileEdit').style.display='none'; document.getElementById('profileView').style.display='block'; }
async function saveProfile(){
  if(!currentUid) return;
  const name = document.getElementById('editName').value.trim() || currentUsername;
  const bio = document.getElementById('editBio').value.trim();
  const tiktok = document.getElementById('editTiktok').value.trim();
  const youtube = document.getElementById('editYoutube').value.trim();
  toast('Saving...');
  try{
    const avatarUrl = pendingAvatarData || (currentUserData && currentUserData.avatar) || null;
    await withTimeout(db.ref('users/'+currentUid).update({name, bio, tiktok, youtube, avatar: avatarUrl}), 10000, 'Saving profile data');
    pendingAvatarData = null;
    cancelEdit();
    toast('Profile saved');
  }catch(err){
    toastError('Failed to save profile: '+((err && err.message) || 'try again') + (err && err.code ? ' ('+err.code+')' : ''));
  }
}

/* ---------- public user profile / follow ---------- */
async function openUserProfile(uid){
  if(!uid) return;
  if(uid === currentUid){ go('profil'); return; }
  viewingUid = uid;
  go('userprofile');
  document.getElementById('uName').textContent = 'Loading...';
  document.getElementById('uPosts').innerHTML = '<div class="empty">Loading...</div>';
  try{
    const [userSnap, followersSnap, followingSnap] = await Promise.all([
      db.ref('users/'+uid).once('value'),
      db.ref('follows/'+uid).once('value'),
      db.ref('followingList/'+uid).once('value')
    ]);
    const u = userSnap.val() || {};
    const followersObj = followersSnap.val() || {};
    const followingObj = followingSnap.val() || {};
    const username = u.username || '(user)';

    document.getElementById('uAvatar').innerHTML = avatarInner(username, u.avatar);
    document.getElementById('uName').innerHTML = escapeHTML(u.name || username) + devBadge(username);
    document.getElementById('uUser').textContent = '@'+username;
    document.getElementById('uBio').textContent = u.bio || 'No bio yet.';
    viewingFollowersReal = Object.keys(followersObj).length;
    document.getElementById('uStatFollowers').textContent = followersOf(uid, viewingFollowersReal);
    document.getElementById('uStatFollowing').textContent = Object.keys(followingObj).length;

    const theirPosts = postsArray().filter(p=>p.authorUid===uid && canSee(p));
    document.getElementById('uStatPosts').textContent = theirPosts.length;
    document.getElementById('uPosts').innerHTML = theirPosts.length
      ? theirPosts.map(postCardHTML).join('')
      : '<div class="empty">No scripts uploaded yet.</div>';

    const followBtn = document.getElementById('followBtn');
    if(!currentUid){
      followBtn.textContent = 'Follow';
      followBtn.className = 'btn primary';
    } else {
      const isFollowing = !!followersObj[currentUid];
      followBtn.textContent = isFollowing ? 'Unfollow' : 'Follow';
      followBtn.className = isFollowing ? 'btn ghost' : 'btn primary';
    }
  }catch(err){
    toastError('Failed to load profile: '+((err && err.message) || 'try again'));
  }
}
async function toggleFollow(){
  if(!currentUid){ toast('Log in first to follow'); openAuth('login'); return; }
  if(!viewingUid || viewingUid===currentUid) return;
  try{
    const snap = await db.ref(`follows/${viewingUid}/${currentUid}`).once('value');
    if(snap.exists()){
      await db.ref().update({ [`follows/${viewingUid}/${currentUid}`]: null, [`followingList/${currentUid}/${viewingUid}`]: null });
    } else {
      await db.ref().update({ [`follows/${viewingUid}/${currentUid}`]: true, [`followingList/${currentUid}/${viewingUid}`]: true });
    }
    openUserProfile(viewingUid);
  }catch(err){
    toastError('Failed to process follow: '+((err && err.message) || 'try again'));
  }
}

/* ---------- direct messages ---------- */
function dmChatIdFor(uidA, uidB){ return [uidA, uidB].sort().join('_'); }
async function openDmChat(otherUid){
  if(!currentUid){ toast('Log in first to chat'); openAuth('login'); return; }
  if(!otherUid || otherUid===currentUid) return;

  if(dmMessagesRef){ dmMessagesRef.off(); dmMessagesRef = null; }

  currentDmOtherUid = otherUid;
  currentDmChatId = dmChatIdFor(currentUid, otherUid);
  document.getElementById('dmTitle').textContent = 'Loading...';
  document.getElementById('dmChatList').innerHTML = '<div class="empty">Loading...</div>';
  go('dm');

  try{
    const userSnap = await db.ref('users/'+otherUid).once('value');
    const u = userSnap.val() || {};
    currentDmOtherName = u.username || '(user)';
    currentDmOtherAvatar = u.avatar || null;
    document.getElementById('dmTitle').innerHTML = escapeHTML(currentDmOtherName) + devBadge(currentDmOtherName);
  }catch(err){
    currentDmOtherName = '(user)';
    currentDmOtherAvatar = null;
    document.getElementById('dmTitle').textContent = 'Messages';
  }

  dmMessagesRef = db.ref('dms/'+currentDmChatId+'/messages');
  dmMessagesRef.on('value', snap=>{
    const val = snap.val() || {};
    const messages = Object.entries(val).map(([id,m])=>({id, ...m})).sort((a,b)=>(a.time||0)-(b.time||0));
    renderDmChat(messages);
  });
}
function renderDmChat(messages){
  const wrap = document.getElementById('dmChatList');
  wrap.innerHTML = messages.length ? messages.map(m=>{
    const isMine = m.senderUid===currentUid;
    return `<div style="margin:10px 0; ${isMine?'text-align:right;':'text-align:left;'}">
      <div style="display:inline-block; max-width:85%; padding:11px 16px; border-radius:20px; text-align:left; white-space:pre-wrap; word-break:break-word; background:${isMine?'var(--accent)':'var(--panel)'}; color:${isMine?'#fff':'var(--text)'};">${escapeHTML(m.text)}</div>
    </div>`;
  }).join('') : '<div class="empty">No messages yet. Start the conversation!</div>';
  window.scrollTo({top: document.body.scrollHeight, behavior:'smooth'});
}
async function sendDmMessage(){
  const input = document.getElementById('dmInput');
  const text = input.value.trim();
  if(!text) return;
  if(!currentUid || !currentDmOtherUid || !currentDmChatId) return;
  input.value = '';
  const now = Date.now();
  const msgKey = db.ref('dms/'+currentDmChatId+'/messages').push().key;
  const updates = {};
  updates[`dms/${currentDmChatId}/messages/${msgKey}`] = { senderUid: currentUid, text, time: now };
  updates[`dmIndex/${currentUid}/${currentDmOtherUid}`] = { otherName: currentDmOtherName, otherAvatar: currentDmOtherAvatar, lastMessage: text, lastTime: now };
  updates[`dmIndex/${currentDmOtherUid}/${currentUid}`] = { otherName: currentUsername, otherAvatar: (currentUserData&&currentUserData.avatar)||null, lastMessage: text, lastTime: now };
  try{
    await withTimeout(db.ref().update(updates), 10000, 'Sending message');
  }catch(err){
    toastError('Failed to send message: '+((err && err.message) || 'try again'));
  }
}

/* ---------- feed ---------- */
const ICON_EYE = '<svg viewBox="0 0 24 24"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/></svg>';
const ICON_CODE_BIG = '<svg viewBox="0 0 24 24"><path d="m8 7-5 5 5 5M16 7l5 5-5 5M14 4l-4 16"/></svg>';
const ICON_VERIFIED = '<svg class="vcheck" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" fill="#3b82f6"/><path d="m7.5 12.3 3 3 6-6.6" fill="none" stroke="#fff" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
const SORT_LABELS = {rec:'Recommended', new:'Newest', top:'Popular'};
let onlineCount = 0, onlineLoaded = false;
function fmtNum(n){ return n>=1000 ? (n/1000).toFixed(1).replace(/\.0$/,'')+'K' : String(n); }
function updateStats(fromPresence){
  const a = document.getElementById('statScripts');
  if(!a) return;
  a.textContent = fmtNum(postsArray().filter(isPublic).length);
  document.getElementById('statUsers').textContent = fmtNum(usersOverride !== null ? usersOverride : Object.keys(usersCache).length);
  if(fromPresence===true) onlineLoaded = true;
  document.getElementById('onlineStat').style.display = onlineLoaded ? '' : 'none';
  document.getElementById('statOnline').textContent = fmtNum(onlineCount);
}
function toggleSortMenu(e){ if(e) e.stopPropagation(); document.getElementById('sortMenu').classList.toggle('show'); }
document.addEventListener('click', ()=>{ ['sortMenu','gameSortMenu'].forEach(id=>{ const m = document.getElementById(id); if(m) m.classList.remove('show'); }); });
function setSort(sort){
  currentSort = sort;
  document.getElementById('sortLabel').textContent = SORT_LABELS[sort];
  document.querySelectorAll('#sortMenu button').forEach(b=>b.classList.toggle('active', b.dataset.sort===sort));
  document.getElementById('sortMenu').classList.remove('show');
  renderFeed();
}
function setFilter(f, el){
  currentFilter = f;
  document.querySelectorAll('#filterTabs .tab').forEach(t=>t.classList.remove('active'));
  el.classList.add('active');
  const users = f==='users', games = f==='games';
  document.getElementById('searchRowPosts').style.display = users ? 'none' : 'flex';
  document.getElementById('searchRowUsers').style.display = users ? 'flex' : 'none';
  document.getElementById('sortWrap').style.display = (users||games) ? 'none' : '';
  document.getElementById('feedHeading').textContent = users ? 'People' : (games ? 'Games' : 'Latest Scripts');
  renderFeed();
}
function gameKey(n){ return String(n||'').replace(/\s+/g,' ').trim().toLowerCase(); }
function gameArg(n){ return encodeURIComponent(n).replace(/'/g,'%27'); }
let gameSort = 'top', gameBackTo = 'beranda';
const GAME_SORTS = {top:'Top liked', new:'Newest', views:'Most viewed'};
function openGame(name){
  const act = document.querySelector('.page.active');
  const from = act ? act.id.replace('page-','') : 'beranda';
  if(from !== 'game') gameBackTo = from;
  currentGame = name;
  gameSort = 'top';
  document.getElementById('gameSortLabel').textContent = GAME_SORTS.top;
  document.querySelectorAll('#gameSortMenu button').forEach(b=>b.classList.toggle('active', b.dataset.sort==='top'));
  document.getElementById('gameSearchInput').value = '';
  go('game');
}
function gameBack(){ go(gameBackTo && gameBackTo!=='game' ? gameBackTo : 'beranda'); }
function toggleGameSort(e){ if(e) e.stopPropagation(); document.getElementById('gameSortMenu').classList.toggle('show'); }
function setGameSort(k){
  gameSort = k;
  document.getElementById('gameSortLabel').textContent = GAME_SORTS[k];
  document.querySelectorAll('#gameSortMenu button').forEach(b=>b.classList.toggle('active', b.dataset.sort===k));
  document.getElementById('gameSortMenu').classList.remove('show');
  renderGamePage();
}
function postsOfGame(name){
  const k = gameKey(name);
  return postsArray().filter(p=>{
    if(!isPublic(p)) return false;
    const g = gameOfPost(p);
    return gameKey(g ? g.name : p.game) === k;
  });
}
function gameInfo(name){
  const k = gameKey(name);
  const g = gamesList().find(x=>gameKey(x.name)===k);
  if(g) return g;
  return {name, image:null, placeId:null};
}
function renderGamePage(){
  const name = currentGame;
  if(!name){ setTimeout(()=>go('beranda'),0); return; }
  const info = gameInfo(name);
  const all = postsOfGame(name);
  document.getElementById('gameBarTitle').textContent = info.name;
  document.getElementById('ghName').textContent = info.name;
  document.getElementById('ghCount').textContent = all.length+' '+(all.length===1?'script':'scripts');
  document.getElementById('ghBg').style.backgroundImage = info.image ? 'url("'+info.image+'")' : '';
  document.getElementById('ghIcon').innerHTML = info.image ? `<img src="${info.image}" alt="">` : `<span>${escapeHTML((info.name||'?').charAt(0).toUpperCase())}</span>`;
  const play = document.getElementById('gamePlayBtn');
  if(info.placeId && /^\d+$/.test(String(info.placeId))){
    play.href = 'https://www.roblox.com/games/'+info.placeId;
    play.style.display = '';
  } else { play.style.display = 'none'; }
  const q = document.getElementById('gameSearchInput').value.trim().toLowerCase();
  let posts = all;
  if(q) posts = posts.filter(p=>(p.title||'').toLowerCase().includes(q) || (p.desc||'').toLowerCase().includes(q) || (p.tags||[]).join(' ').toLowerCase().includes(q));
  const likes = likesOf;
  if(gameSort==='new') posts.sort((a,b)=>(b.created||0)-(a.created||0));
  else if(gameSort==='views') posts.sort((a,b)=>(b.views||0)-(a.views||0) || (b.created||0)-(a.created||0));
  else posts.sort((a,b)=>likes(b)-likes(a) || (b.created||0)-(a.created||0));
  document.getElementById('gameFeedList').innerHTML = posts.length ? posts.map(postCardHTML).join('') : '<div class="empty">No scripts found.</div>';
}
function gameOfPost(p){
  if(p.universal) return null;
  if(p.universeId || p.placeId || p.gameImage){
    return {id: p.universeId ? 'u'+p.universeId : 'n'+gameKey(p.game), name: p.game, image: p.gameImage||null, placeId: p.placeId||null, universeId: p.universeId||null};
  }
  if(p.gameId && gamesCache[p.gameId]) return Object.assign({id:p.gameId}, gamesCache[p.gameId]);
  const k = gameKey(p.game);
  if(!k) return null;
  for(const [id,g] of Object.entries(gamesCache)){ if(gameKey(g.name)===k) return Object.assign({id}, g); }
  return null;
}
function gamesList(){
  const map = {};
  postsArray().filter(isPublic).forEach(p=>{
    if(!p.game || p.universal) return;
    const g = gameOfPost(p);
    const key = (g && g.universeId) ? 'u'+g.universeId : 'n'+gameKey(p.game);
    if(!map[key]) map[key] = {id:key, name:(g?g.name:p.game), image:null, placeId:(g&&g.placeId)||null, universeId:(g&&g.universeId)||null, count:0, t:0};
    if(g && g.placeId && !map[key].placeId) map[key].placeId = g.placeId;
    if(g && g.universeId && !map[key].universeId) map[key].universeId = g.universeId;
    map[key].count++;
    if(g && g.image && (p.created||0) >= map[key].t){ map[key].image = g.image; map[key].t = p.created||0; }
  });
  return Object.values(map).sort((a,b)=>b.count-a.count || a.name.localeCompare(b.name));
}
function gameIconHTML(g, cls){
  if(g && g.image) return `<img class="${cls||'gIco'}" src="${g.image}" alt="">`;
  return '';
}
function gamePillHTML(p){
  const g = gameOfPost(p);
  const name = g ? g.name : p.game;
  if(!name) return '<span class="gamePill none">No game</span>';
  return `<span class="gamePill" onclick="event.stopPropagation(); openGame(decodeURIComponent('${gameArg(name)}'))">${gameIconHTML(g)}${escapeHTML(name)}</span>`;
}
function gameCardHTML(g){
  const icon = g.image ? `<img src="${g.image}" alt="">` : `<span>${escapeHTML((g.name||'?').charAt(0).toUpperCase())}</span>`;
  return `<div class="postCard gameRow" onclick="openGame(decodeURIComponent('${gameArg(g.name)}'))">
    <div class="gameIcon">${icon}</div>
    <div style="flex:1; min-width:0;">
      <div class="urName">${escapeHTML(g.name)}</div>
      <div class="urSub">${g.count} ${g.count===1?'script':'scripts'}</div>
    </div>
    <svg class="gChev" viewBox="0 0 24 24"><path d="m9 5 7 7 7-7" style="display:none"/><path d="m9 5 7 7-7 7"/></svg>
  </div>`;
}
function passesFilter(p){
  const tags = (p.tags||[]).map(t=>String(t).toLowerCase());
  if(!isPublic(p)) return false;
  if(currentFilter==='nokey') return p.keySystem ? p.keySystem==='keyless' : tags.some(t=>/no-?key|keyless/.test(t));
  if(currentFilter==='verified') return isDeveloper(p.authorName);
  return true;
}
function postCardHTML(p){
  const likeCount = likesOf(p);
  const slots = Array.isArray(p.slots) ? p.slots : Object.values(p.slots||{});
  const dev = isDeveloper(p.authorName);
  const tags = p.tags || [];
  const pt = postThumb(p);
  const thumb = pt
    ? `<img src="${pt}" alt="">`
    : `<div class="thumbPh">${ICON_CODE_BIG}</div>`;
  const badge = dev
    ? '<span class="ovBadge ok">Verified</span>'
    : `<span class="ovBadge">${slots.length} ${slots.length===1?'slot':'slots'}</span>`;
  return `<div class="feedCard" onclick="openDetail('${p.id}')">
    <div class="feedThumb">
      ${thumb}
      <span class="ovPill tl">${ICON_EYE}${p.views||0}</span>
      <span class="ovPill tr">${timeAgo(p.created)}</span>
      ${p.keySystem==='key' ? '<span class="ovKey" title="Key system"><svg viewBox="0 0 24 24"><circle cx="8" cy="15" r="4"/><path d="m11 12 8-8M16 7l3 3"/></svg></span>' : ''}
      ${badge}
    </div>
    <div class="feedMeta">
      <div class="feedTop" onclick="event.stopPropagation(); openUserProfile('${p.authorUid}')">
        <div class="miniAvatar">${avatarInner(p.authorName, p.authorAvatar)}</div>
        ${gamePillHTML(p)}
        <span class="likeMini">${likeCount} ${likeCount===1?'like':'likes'}</span>
      </div>
      <h3 class="feedTitle">${escapeHTML(p.title)}</h3>
      <div class="feedUser">@${escapeHTML(p.authorName||'')}${dev?ICON_VERIFIED:''}</div>
    </div>
  </div>`;
}
function userCardHTML(u){
  return `<div class="postCard userRow" onclick="openUserProfile('${u.uid}')">
    <div class="miniAvatar big" style="width:52px;height:52px;font-size:1.2rem;">${avatarInner(u.username, u.avatar)}</div>
    <div style="flex:1; min-width:0;">
      <div class="urName">${escapeHTML(u.name || u.username || '')}${devBadge(u.username)}</div>
      <div class="urSub">@${escapeHTML(u.username||'')}</div>
    </div>
  </div>`;
}
function renderFeed(){
  const wrap = document.getElementById('feedList');
  if(currentFilter==='users'){
    const q = document.getElementById('userSearchInput').value.trim().toLowerCase();
    let users = usersArray().filter(u=>u.uid!==currentUid);
    if(q) users = users.filter(u => (u.username||'').toLowerCase().includes(q) || (u.name||'').toLowerCase().includes(q));
    users.sort((a,b)=>(a.username||'').localeCompare(b.username||''));
    wrap.innerHTML = users.length ? users.map(userCardHTML).join('') : (q ? '<div class="empty">No users found.</div>' : '<div class="empty">Type a username to search users.</div>');
    return;
  }
  const q = document.getElementById('searchInput').value.trim().toLowerCase();
  if(currentFilter==='games'){
    let gl = gamesList();
    if(q) gl = gl.filter(g=>g.name.toLowerCase().includes(q));
    wrap.innerHTML = gl.length ? gl.map(gameCardHTML).join('') : '<div class="empty">No games yet. Games appear here once someone publishes a script.</div>';
    return;
  }
  let posts = postsArray().filter(passesFilter);
  if(q) posts = posts.filter(p => (p.title||'').toLowerCase().includes(q) || (p.desc||'').toLowerCase().includes(q) || (p.tags||[]).join(' ').toLowerCase().includes(q) || (p.game||'').toLowerCase().includes(q));
  const likes = likesOf;
  if(currentSort==='new') posts.sort((a,b)=>(b.created||0)-(a.created||0));
  else if(currentSort==='top') posts.sort((a,b)=>likes(b)-likes(a) || (b.created||0)-(a.created||0));
  else {
    const now = Date.now();
    const score = p => (likes(p)+1) / Math.pow(((now-(p.created||now))/3600000)+2, 0.8);
    posts.sort((a,b)=>score(b)-score(a));
  }
  wrap.innerHTML = posts.length ? posts.map(postCardHTML).join('') : '<div class="empty">No scripts found.</div>';
}

/* ---------- games: legacy cache + Roblox search ---------- */
db.ref('games').on('value', snap=>{
  gamesCache = snap.val() || {};   /* legacy developer games, read-only (old posts keep their photo) */
  if(document.getElementById('page-beranda').classList.contains('active')) renderFeed();
  if(document.getElementById('page-detail').classList.contains('active') && currentDetailId) renderDetail();
}, ()=>{});

function setUploadGame(id, name, image, universeId){
  upGameId = id || null;
  upGameName = name || '';
  upGameImage = image || null;
  upGameUniverse = universeId || null;
  document.getElementById('upGameLabel').textContent = name || 'Choose a game';
  document.getElementById('upGameSub').textContent = name ? 'Tap to change' : 'Search by name or paste a Roblox link';
  const ico = document.getElementById('upGameIcon');
  if(image) ico.innerHTML = `<img src="${image}" alt="">`;
  else ico.innerHTML = '<svg viewBox="0 0 24 24"><rect x="2.5" y="7" width="19" height="11" rx="5"/><path d="M8 10.5v4M6 12.5h4M15.5 11.5h.01M18 13.5h.01"/></svg>';
  refreshCoverPreview();
}

let gpTimer = null, gpSeq = 0, gpResults = [], gpQuery = '';
function fetchTimeout(url, ms){
  const ctl = new AbortController();
  const t = setTimeout(()=>ctl.abort(), ms);
  return fetch(url, {signal: ctl.signal}).finally(()=>clearTimeout(t));
}
/* roproxy.com mirrors Roblox APIs with CORS enabled; roblox.com is the fallback */
async function rbxFetch(sub, path){
  let lastErr = null;
  for(const host of ['roproxy.com','roblox.com']){
    try{
      const r = await fetchTimeout('https://'+sub+'.'+host+path, 8000);
      if(r.ok) return await r.json();
      lastErr = new Error('HTTP '+r.status);
    }catch(e){ lastErr = e; }
  }
  throw lastErr || new Error('Request failed');
}
function parseRobloxLink(q){
  const m = q.match(/roblox\.com\/(?:[a-z-]+\/)?games\/(\d+)(?:\/([^\/?#]+))?/i);
  return m ? {placeId:m[1], slug:m[2]||''} : null;
}
async function rbxSearchGames(q){
  try{
    const sid = (window.crypto && crypto.randomUUID) ? crypto.randomUUID() : String(Date.now());
    const j = await rbxFetch('apis', '/search-api/omni-search?searchQuery='+encodeURIComponent(q)+'&sessionId='+sid+'&pageType=all');
    const out = [];
    (j.searchResults||[]).forEach(grp=>{
      (grp.contents||[]).forEach(c=>{
        if(c.contentType && !/game/i.test(c.contentType)) return;
        out.push({universeId: c.universeId || c.contentId, placeId: c.rootPlaceId || c.placeId, name: c.name});
      });
    });
    if(out.length) return out;
  }catch(e){}
  const j2 = await rbxFetch('games', '/v1/games/list?model.keyword='+encodeURIComponent(q)+'&model.maxRows=24');
  return (j2.games||[]).map(g=>({universeId:g.universeId, placeId:g.placeId, name:g.name}));
}
async function rbxResolveLink(pl){
  let name = pl.slug ? decodeURIComponent(pl.slug).replace(/-/g,' ') : 'Roblox game '+pl.placeId;
  let universeId = null;
  try{ const j = await rbxFetch('apis', '/universes/v1/places/'+pl.placeId+'/universe'); universeId = j.universeId; }catch(e){}
  if(universeId){
    try{ const j = await rbxFetch('games', '/v1/games?universeIds='+universeId); const d = (j.data||[])[0]; if(d && d.name) name = d.name; }catch(e){}
  }
  return [{universeId, placeId: pl.placeId, name}];
}
async function rbxThumbs(ids){
  const map = {};
  try{
    const j = await rbxFetch('thumbnails', '/v1/games/multiget/thumbnails?universeIds='+ids.join(',')+'&countPerUniverse=1&defaults=true&size=768x432&format=Png&isCircular=false');
    (j.data||[]).forEach(d=>{ const t = (d.thumbnails||[])[0]; if(t && t.imageUrl) map[d.universeId] = t.imageUrl; });
  }catch(e){}
  const missing = ids.filter(i=>!map[i]);
  if(missing.length){
    try{
      const j = await rbxFetch('thumbnails', '/v1/games/icons?universeIds='+missing.join(',')+'&returnPolicy=PlaceHolder&size=256x256&format=Png&isCircular=false');
      (j.data||[]).forEach(d=>{ if(d.imageUrl) map[d.targetId] = d.imageUrl; });
    }catch(e){}
  }
  return map;
}
function openGamePicker(){
  document.getElementById('gamePickerSearch').value = '';
  gpSeq++; gpResults = []; gpQuery = '';
  renderGPEmpty();
  document.getElementById('gamePicker').classList.add('show');
  setTimeout(()=>{ try{ document.getElementById('gamePickerSearch').focus(); }catch(e){} }, 120);
}
function closeGamePicker(){
  gpSeq++;
  document.getElementById('gamePicker').classList.remove('show');
}
function renderGPEmpty(){
  document.getElementById('gamePickerList').innerHTML = '<div class="gpEmpty">Type at least 2 characters to search.</div>';
}
function onGameSearchInput(){
  clearTimeout(gpTimer);
  const q = document.getElementById('gamePickerSearch').value.trim();
  if(q.length < 2){ gpSeq++; renderGPEmpty(); return; }
  gpTimer = setTimeout(()=>runGameSearch(q), 350);
}
async function runGameSearch(q){
  const seq = ++gpSeq;
  gpQuery = q;
  const list = document.getElementById('gamePickerList');
  list.innerHTML = '<div class="gpEmpty">Searching...</div>';
  try{
    const link = parseRobloxLink(q);
    let items = link ? await rbxResolveLink(link) : await rbxSearchGames(q);
    if(seq !== gpSeq) return;
    const seen = {};
    items = items.filter(i=>{
      const id = String(i.placeId || i.universeId || '');
      if(!id || !i.name || seen[id]) return false;
      seen[id] = 1; i.id = id; return true;
    }).slice(0,24);
    gpResults = items;
    renderGPResults();
    const ids = items.map(i=>i.universeId).filter(Boolean);
    if(ids.length){
      const map = await rbxThumbs(ids);
      if(seq !== gpSeq) return;
      items.forEach(i=>{ i.image = map[i.universeId] || null; });
      renderGPResults();
    }
  }catch(err){
    if(seq !== gpSeq) return;
    gpResults = [];
    list.innerHTML = `<div class="gpEmpty">Couldn't reach Roblox search right now.</div>
      <div class="gpRow" onclick="pickGameManual()"><div class="gpThumb"></div><div class="gpText"><b>Use "${escapeHTML(q)}" as the game name</b><i>Search is unavailable</i></div></div>`;
  }
}
function renderGPResults(){
  const list = document.getElementById('gamePickerList');
  if(!gpResults.length){ list.innerHTML = '<div class="gpEmpty">No games found.</div>'; return; }
  list.innerHTML = gpResults.map((g,i)=>`
    <div class="gpRow" onclick="pickRobloxGame(${i})">
      <div class="gpThumb">${g.image ? `<img src="${g.image}" alt="">` : ''}</div>
      <div class="gpText"><b>${escapeHTML(g.name)}</b><i>${escapeHTML(g.id)}</i></div>
      <svg class="gpArrow" viewBox="0 0 24 24"><path d="M5 12h14M13 6l6 6-6 6"/></svg>
    </div>`).join('');
}
function pickRobloxGame(i){
  const g = gpResults[i];
  if(!g) return;
  setUploadGame(String(g.placeId || g.universeId), g.name, g.image || null, g.universeId || null);
  closeGamePicker();
}
function pickGameManual(){
  if(!gpQuery) return;
  setUploadGame('manual', gpQuery, null);
  closeGamePicker();
}

/* ---------- community links (editable by developer) ---------- */
const DEFAULT_LINKS = {
  whatsapp: 'https://whatsapp.com/channel/0029VbDPTIi9cDDRLb6Ukj3I',
  discord: 'https://discord.gg/6B36mdd6cJ'
};
let communityLinks = Object.assign({}, DEFAULT_LINKS);
function applyLinks(){
  document.querySelectorAll('[data-link]').forEach(a=>{
    const u = communityLinks[a.dataset.link];
    if(u) a.setAttribute('href', u);
  });
}
db.ref('config/links').on('value', snap=>{
  const v = snap.val() || {};
  communityLinks = {
    whatsapp: (typeof v.whatsapp==='string' && /^https:\/\//i.test(v.whatsapp)) ? v.whatsapp : DEFAULT_LINKS.whatsapp,
    discord: (typeof v.discord==='string' && /^https:\/\//i.test(v.discord)) ? v.discord : DEFAULT_LINKS.discord
  };
  applyLinks();
  if(document.getElementById('page-inbox').classList.contains('active')) renderInbox();
}, ()=>{});
async function saveCommunityLinks(){
  if(!isDeveloper(currentUsername)){ toast('Only developers can change links'); return; }
  const wa = document.getElementById('devWaInput').value.trim();
  const dc = document.getElementById('devDcInput').value.trim();
  const ok = u => /^https:\/\/[^\s]+\.[^\s]+$/i.test(u);
  if(!ok(wa)){ toast('Enter a valid WhatsApp link (https://...)'); return; }
  if(!ok(dc)){ toast('Enter a valid Discord link (https://...)'); return; }
  try{
    await withTimeout(db.ref('config/links').set({whatsapp: wa, discord: dc}), 10000, 'Saving links');
    toast('Links updated');
  }catch(err){
    toastError('Failed to save links: '+((err && err.message) || 'try again'));
  }
}

/* ---------- global chat ---------- */
const GC_LIMIT = 60;
let gcQuery = null, gcCache = {}, gcLastSend = 0, gcFirstRender = true;
function startGlobalChat(){
  if(gcQuery) return;
  gcFirstRender = true;
  document.getElementById('gcList').innerHTML = '<div class="empty">Loading...</div>';
  gcQuery = db.ref('globalChat').limitToLast(GC_LIMIT);
  gcQuery.on('value', snap=>{
    gcCache = snap.val() || {};
    renderGlobalChat();
  }, ()=>{
    document.getElementById('gcList').innerHTML = '<div class="empty">Unable to load the chat right now.</div>';
  });
}
function stopGlobalChat(){
  if(gcQuery){ gcQuery.off(); gcQuery = null; gcCache = {}; }
}
function renderGlobalChat(){
  if(!document.getElementById('page-gchat').classList.contains('active')) return;
  const nearBottom = (window.innerHeight + window.scrollY) >= document.body.scrollHeight - 180;
  const entries = Object.entries(gcCache).sort((a,b)=>(a[1].time||0)-(b[1].time||0));
  const wrap = document.getElementById('gcList');
  if(!entries.length){
    wrap.innerHTML = '<div class="empty">No messages yet. Say hi!</div>';
    return;
  }
  const dev = isDeveloper(currentUsername);
  let prev = null;
  wrap.innerHTML = '<div class="gcWrap">' + entries.map(([id,m])=>{
    const mine = currentUid && m.uid===currentUid;
    const grouped = prev === m.uid && !mine;
    prev = m.uid;
    const canDel = mine || dev;
    const del = canDel ? `<button class="gcDel" onclick="deleteGlobalMessage('${id}')" aria-label="Delete message"><svg viewBox="0 0 24 24"><path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/></svg></button>` : '';
    if(mine){
      return `<div class="gcMsg mine"><div class="gcBody">${del}<div class="gcBubble">${escapeHTML(m.text||'')}</div><div class="gcTime">${timeAgo(m.time)}</div></div></div>`;
    }
    return `<div class="gcMsg">
      <div class="gcAv" onclick="openUserProfile('${m.uid}')">${grouped ? '' : `<div class="miniAvatar big">${avatarInner(m.name, m.avatar)}</div>`}</div>
      <div class="gcBody">
        ${grouped ? '' : `<div class="gcName" onclick="openUserProfile('${m.uid}')">${escapeHTML(m.name||'')}${devBadge(m.name)}</div>`}
        <div class="gcRow"><div class="gcBubble">${escapeHTML(m.text||'')}</div>${del}</div>
        <div class="gcTime">${timeAgo(m.time)}</div>
      </div>
    </div>`;
  }).join('') + '</div>';
  if(gcFirstRender || nearBottom){
    window.scrollTo({top: document.body.scrollHeight, behavior: gcFirstRender ? 'auto' : 'smooth'});
  }
  gcFirstRender = false;
}
async function sendGlobalMessage(){
  if(!currentUid){ toast('Log in first to chat'); openAuth('login'); return; }
  const input = document.getElementById('gcInput');
  const text = input.value.trim().slice(0,300);
  if(!text) return;
  const now = Date.now();
  if(now - gcLastSend < 2000){ toast('Slow down a little'); return; }
  gcLastSend = now;
  input.value = '';
  try{
    await withTimeout(db.ref('globalChat').push().set({
      uid: currentUid,
      name: currentUsername,
      avatar: (currentUserData && currentUserData.avatar) || null,
      text,
      time: Date.now()
    }), 10000, 'Sending message');
  }catch(err){
    input.value = text;
    toastError('Failed to send message: '+((err && err.message) || 'try again'));
  }
}
async function deleteGlobalMessage(id){
  const m = gcCache[id];
  if(!m) return;
  if(!(currentUid && (m.uid===currentUid || isDeveloper(currentUsername)))) return;
  try{ await db.ref('globalChat/'+id).remove(); }catch(err){ toastError('Failed to delete: '+((err && err.message) || 'try again')); }
}

/* ---------- developer: overrides (users count, followers, likes) ---------- */
function likesOf(p){
  const o = overridesCache.likes && p && p.id ? overridesCache.likes[p.id] : undefined;
  if(typeof o === 'number') return o;
  return p && p.likedBy ? Object.keys(p.likedBy).length : 0;
}
function followersOf(uid, real){
  const o = overridesCache.followers ? overridesCache.followers[uid] : undefined;
  return typeof o === 'number' ? o : real;
}
function parseCount(v){
  const t = String(v||'').trim();
  return /^\d{1,9}$/.test(t) ? parseInt(t,10) : null;
}
function refreshCounts(){
  updateStats();
  renderProfile();
  if(document.getElementById('page-beranda').classList.contains('active')) renderFeed();
  if(document.getElementById('page-detail').classList.contains('active') && currentDetailId) renderDetail();
  if(document.getElementById('page-game').classList.contains('active')) renderGamePage();
  if(document.getElementById('page-userprofile').classList.contains('active') && viewingUid){
    document.getElementById('uStatFollowers').textContent = followersOf(viewingUid, viewingFollowersReal);
  }
  if(document.getElementById('page-dev').classList.contains('active')) fillDevNumbers();
}
db.ref('overrides').on('value', snap=>{
  const v = snap.val() || {};
  overridesCache = {followers: v.followers || {}, likes: v.likes || {}};
  refreshCounts();
}, ()=>{});
db.ref('config/usersOverride').on('value', snap=>{
  const v = snap.val();
  usersOverride = (typeof v === 'number') ? v : null;
  refreshCounts();
}, ()=>{});

function fillDevNumbers(){
  const inp = document.getElementById('devUsersCountInput');
  if(!inp) return;
  const real = Object.keys(usersCache).length;
  if(document.activeElement !== inp) inp.value = usersOverride !== null ? usersOverride : real;
  document.getElementById('devUsersCountHint').textContent = 'Real users: '+real+' · Showing: '+(usersOverride !== null ? usersOverride+' (manual)' : real+' (auto)');
}
async function saveUsersCount(){
  if(!isDeveloper(currentUsername)){ toast('Developers only'); return; }
  const n = parseCount(document.getElementById('devUsersCountInput').value);
  if(n === null){ toast('Enter a whole number'); return; }
  try{ await withTimeout(db.ref('config/usersOverride').set(n), 10000, 'Saving'); toast('Users count updated'); }
  catch(err){ toastError('Failed to save: '+((err && err.message) || 'try again')); }
}
async function resetUsersCount(){
  if(!isDeveloper(currentUsername)) return;
  try{ await db.ref('config/usersOverride').remove(); toast('Users count is automatic again'); }
  catch(err){ toastError('Failed: '+((err && err.message) || 'try again')); }
}

/* likes (per script) */
function openLikesModal(){
  if(!isDeveloper(currentUsername)){ toast('Developers only'); return; }
  const p = getPost(currentDetailId);
  if(!p) return;
  const real = p.likedBy ? Object.keys(p.likedBy).length : 0;
  const manual = typeof (overridesCache.likes||{})[p.id] === 'number';
  document.getElementById('likesInput').value = likesOf(p);
  document.getElementById('likesHint').textContent = 'Real likes: '+real+(manual ? ' · manual value is set' : '');
  document.getElementById('likesModal').classList.add('show');
}
function closeLikesModal(){ document.getElementById('likesModal').classList.remove('show'); }
async function saveLikes(){
  const n = parseCount(document.getElementById('likesInput').value);
  if(n === null){ toast('Enter a whole number'); return; }
  try{ await withTimeout(db.ref('overrides/likes/'+currentDetailId).set(n), 10000, 'Saving'); closeLikesModal(); toast('Likes updated'); }
  catch(err){ toastError('Failed to save: '+((err && err.message) || 'try again')); }
}
async function resetLikes(){
  try{ await db.ref('overrides/likes/'+currentDetailId).remove(); closeLikesModal(); toast('Likes are automatic again'); }
  catch(err){ toastError('Failed: '+((err && err.message) || 'try again')); }
}

/* ---------- developer: users (search, followers, ban, delete) ---------- */
const BAN_FOREVER = 4102444800000;
let umUid = null, umFollowersReal = 0;
function fmtLeft(ms){
  let t = Math.max(0, Math.floor(ms/1000));
  const d = Math.floor(t/86400); t -= d*86400;
  const h = Math.floor(t/3600); t -= h*3600;
  const m = Math.floor(t/60); const sec = t - m*60;
  const pad = n => String(n).padStart(2,'0');
  return (d ? d+'d ' : '') + pad(h)+':'+pad(m)+':'+pad(sec);
}
function banLeftShort(b){
  if(!b || !(b.until > Date.now())) return '';
  if(b.until >= BAN_FOREVER) return 'Permanent';
  const ms = b.until - Date.now();
  const d = Math.floor(ms/86400000), h = Math.floor(ms%86400000/3600000), m = Math.floor(ms%3600000/60000);
  return d ? d+'d '+h+'h' : (h ? h+'h '+m+'m' : Math.max(1,m)+'m');
}
function renderDevUsers(){
  const wrap = document.getElementById('devUserList');
  if(!wrap) return;
  const q = document.getElementById('devUserSearch').value.trim().toLowerCase();
  let list = usersArray().filter(u=>u.username);
  if(q) list = list.filter(u=>(u.username||'').toLowerCase().includes(q) || (u.name||'').toLowerCase().includes(q));
  list.sort((a,b)=>(a.username||'').localeCompare(b.username||''));
  const total = list.length;
  list = list.slice(0, 40);
  wrap.innerHTML = list.length ? list.map(u=>{
    const b = bansCache[u.uid];
    const left = banLeftShort(b);
    return `<div class="postCard userRow" onclick="openUserManage('${u.uid}')">
      <div class="miniAvatar big" style="width:46px;height:46px;">${avatarInner(u.username, u.avatar)}</div>
      <div style="flex:1; min-width:0;">
        <div class="urName">${escapeHTML(u.name || u.username)}${devBadge(u.username)}</div>
        <div class="urSub">@${escapeHTML(u.username)}</div>
      </div>
      ${left ? `<i class="fbState warn">Banned · ${left}</i>` : ''}
    </div>`;
  }).join('') + (total > 40 ? '<div class="hint" style="text-align:center;">Showing 40 of '+total+'. Refine your search.</div>' : '')
  : '<div class="empty">No users found.</div>';
}
function updateManageStatus(){
  const el = document.getElementById('umStatus');
  if(!el || !umUid) return;
  const left = banLeftShort(bansCache[umUid]);
  el.textContent = left ? 'Banned · '+left : 'Active';
  el.className = left ? 'umBad' : 'umOk';
  document.getElementById('umUnban').style.display = left ? '' : 'none';
}
async function openUserManage(uid){
  if(!isDeveloper(currentUsername)){ toast('Developers only'); return; }
  const u = usersCache[uid];
  if(!u) return;
  umUid = uid;
  document.getElementById('umAvatar').innerHTML = avatarInner(u.username, u.avatar);
  document.getElementById('umName').innerHTML = '@'+escapeHTML(u.username||'')+devBadge(u.username);
  document.getElementById('umFollowers').value = '';
  document.getElementById('umFollowersHint').textContent = 'Loading...';
  document.getElementById('umBanNum').value = '1';
  document.getElementById('umBanUnit').value = 'hours';
  updateManageStatus();
  document.getElementById('userManage').classList.add('show');
  try{
    const sn = await db.ref('follows/'+uid).once('value');
    umFollowersReal = sn.exists() ? Object.keys(sn.val()).length : 0;
  }catch(e){ umFollowersReal = 0; }
  if(umUid !== uid) return;
  const ov = (overridesCache.followers||{})[uid];
  document.getElementById('umFollowers').value = typeof ov === 'number' ? ov : umFollowersReal;
  document.getElementById('umFollowersHint').textContent = 'Real followers: '+umFollowersReal+(typeof ov === 'number' ? ' · manual value is set' : '');
}
function closeUserManage(){ document.getElementById('userManage').classList.remove('show'); umUid = null; }
async function saveUserFollowers(){
  if(!umUid) return;
  const n = parseCount(document.getElementById('umFollowers').value);
  if(n === null){ toast('Enter a whole number'); return; }
  try{ await withTimeout(db.ref('overrides/followers/'+umUid).set(n), 10000, 'Saving'); toast('Followers updated'); }
  catch(err){ toastError('Failed to save: '+((err && err.message) || 'try again')); }
}
async function resetUserFollowers(){
  if(!umUid) return;
  try{ await db.ref('overrides/followers/'+umUid).remove(); document.getElementById('umFollowers').value = umFollowersReal; toast('Followers are automatic again'); }
  catch(err){ toastError('Failed: '+((err && err.message) || 'try again')); }
}
async function banSelectedUser(){
  if(!umUid) return;
  const u = usersCache[umUid] || {};
  if(umUid === currentUid || isDeveloper(u.username)){ toast('You cannot ban a developer'); return; }
  const unit = document.getElementById('umBanUnit').value;
  let until, label;
  if(unit === 'forever'){ until = BAN_FOREVER; label = 'permanently'; }
  else {
    const n = parseInt(document.getElementById('umBanNum').value, 10);
    const mult = {minutes:60000, hours:3600000, days:86400000}[unit];
    if(!(n > 0) || n*mult > 3650*86400000){ toast('Enter a valid ban timer (max 3650 days)'); return; }
    until = Date.now() + n*mult;
    label = 'for '+n+' '+(n===1 ? unit.replace(/s$/,'') : unit);
  }
  if(!confirm('Ban @'+u.username+' '+label+'?')) return;
  try{
    await withTimeout(db.ref('bans/'+umUid).set({until, by: currentUid, created: Date.now(), name: u.username||''}), 10000, 'Banning');
    toast('@'+u.username+' banned '+label);
  }catch(err){ toastError('Failed to ban: '+((err && err.message) || 'try again')); }
}
async function unbanSelectedUser(){
  if(!umUid) return;
  try{ await db.ref('bans/'+umUid).remove(); toast('User unbanned'); }
  catch(err){ toastError('Failed to unban: '+((err && err.message) || 'try again')); }
}
async function deleteSelectedAccount(){
  if(!umUid) return;
  const uid = umUid;
  const u = usersCache[uid] || {};
  if(uid === currentUid || isDeveloper(u.username)){ toast('You cannot delete a developer account'); return; }
  const theirPosts = postsArray().filter(p=>p.authorUid===uid);
  if(!confirm('Delete @'+u.username+' permanently?\nThis removes the account data and '+theirPosts.length+' script(s). It cannot be undone.')) return;
  const upd = {};
  upd['users/'+uid] = null;
  upd['usernames/'+String(u.username||'').toLowerCase()] = null;
  upd['follows/'+uid] = null;
  upd['followingList/'+uid] = null;
  upd['aiChats/'+uid] = null;
  upd['bans/'+uid] = null;
  upd['overrides/followers/'+uid] = null;
  upd['deleted/'+uid] = true;
  theirPosts.forEach(p=>{ upd['posts/'+p.id] = null; });
  try{
    await withTimeout(db.ref().update(upd), 15000, 'Deleting account');
    closeUserManage();
    toast('Account deleted');
  }catch(err){ toastError('Failed to delete: '+((err && err.message) || 'try again')); }
}

/* ---------- ban screen (shown to the banned user) ---------- */
let banTimerId = null;
function kickBanned(b){
  try{ auth.signOut(); }catch(e){}
  showBanScreen(b);
}
function showBanScreen(b){
  const until = b.until;
  const timer = document.getElementById('banTimer');
  const msg = document.getElementById('banMsg');
  const title = document.getElementById('banTitle');
  clearInterval(banTimerId);
  function tick(){
    const left = until - Date.now();
    if(until >= BAN_FOREVER){
      title.textContent = 'Your account is banned';
      msg.textContent = 'This ban is permanent.';
      timer.textContent = 'Permanent';
      clearInterval(banTimerId);
      return;
    }
    if(left <= 0){
      title.textContent = 'Your ban has ended';
      msg.textContent = 'You can log in again now.';
      timer.textContent = '00:00:00';
      clearInterval(banTimerId);
      return;
    }
    title.textContent = 'Your account is banned';
    msg.textContent = 'You can log in again when the timer ends.';
    timer.textContent = fmtLeft(left);
  }
  tick();
  banTimerId = setInterval(tick, 1000);
  document.getElementById('banOverlay').classList.add('show');
}
function closeBan(){
  clearInterval(banTimerId);
  document.getElementById('banOverlay').classList.remove('show');
}

/* ---------- script loader (obfuscator) ---------- */
function loaderOrigin(){
  try{ if(location.origin && location.origin!=='null' && /^https?:$/.test(location.protocol)) return location.origin; }catch(e){}
  return null;
}
function slugifyLoaderName(s){
  return String(s||'')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g,'-')
    .replace(/^-+|-+$/g,'')
    .slice(0,60);
}
function updateLdSlugPreview(){
  const nameEl = document.getElementById('ldName');
  const hint = document.getElementById('ldSlugHint');
  if(!nameEl || !hint || nameEl.disabled) return;
  const slug = slugifyLoaderName(nameEl.value);
  hint.textContent = slug ? ('Link: mscript.vercel.app/loaders/'+slug) : 'Used in the link: mscript.vercel.app/loaders/your-name';
}
function resetLoaderForm(){
  editingLoaderId = null;
  if(!document.getElementById('ldCode')) return;
  document.getElementById('ldName').value = '';
  document.getElementById('ldName').disabled = false;
  document.getElementById('ldCode').value = '';
  document.getElementById('ldCount').textContent = '0 characters';
  document.getElementById('ldResult').style.display = 'none';
  document.getElementById('ldBtnLabel').textContent = 'Generate protected link';
  updateLdSlugPreview();
}
(function wireLoaderCounter(){
  document.addEventListener('input', e=>{
    if(e.target && e.target.id==='ldCode'){
      document.getElementById('ldCount').textContent = e.target.value.length+' characters';
    }
  });
})();
function startLoaderList(){
  if(loadersQuery || !currentUid) return;
  document.getElementById('ldList').innerHTML = '<div class="empty">Loading...</div>';
  loadersQuery = db.ref('loaders').orderByChild('ownerUid').equalTo(currentUid);
  loadersQuery.on('value', snap=>{
    loadersCache = snap.val() || {};
    renderLoaderList();
  }, ()=>{ document.getElementById('ldList').innerHTML = '<div class="empty">Unable to load your loaders right now.</div>'; });
}
function stopLoaderList(){
  if(loadersQuery){ loadersQuery.off(); loadersQuery = null; }
}
function renderLoaderList(){
  const wrap = document.getElementById('ldList');
  if(!wrap) return;
  const entries = Object.entries(loadersCache).sort((a,b)=>(b[1].updated||b[1].created||0)-(a[1].updated||a[1].created||0));
  if(!entries.length){ wrap.innerHTML = '<div class="empty">No loaders yet.</div>'; return; }
  const origin = loaderOrigin();
  wrap.innerHTML = entries.map(([id,l])=>{
    const label = l.name || id;
    const link = origin ? origin+'/loaders/'+id : '';
    const snippet = link ? 'loadstring(game:HttpGet("'+link+'"))()' : '';
    return `<div class="dCard" style="padding:18px 20px; margin-bottom:14px;">
      <div class="dLabel" style="color:var(--text); font-size:1.02rem; font-weight:600; text-transform:none; letter-spacing:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${escapeHTML(label)}</div>
      <div class="hint" style="margin-top:6px;">${(l.code||'').length} characters · ${timeAgo(l.updated||l.created)}</div>
      <div class="scriptActions" style="justify-content:flex-start; gap:10px; flex-wrap:wrap;">
        ${snippet ? `<button class="copyPill" onclick="copyText(decodeURIComponent('${gameArg(snippet)}'))">Copy</button>` : ''}
        <button class="copyPill" onclick="editLoader('${id}')">Edit</button>
        <button class="copyPill" style="color:#ff6b6b; border-color:#4a2326;" onclick="deleteLoaderItem('${id}')">Delete</button>
      </div>
    </div>`;
  }).join('');
}
function copyText(t){
  navigator.clipboard.writeText(t).then(()=>toast('Copied')).catch(()=>toast('Failed to copy'));
}
function editLoader(id){
  const l = loadersCache[id];
  if(!l) return;
  editingLoaderId = id;
  document.getElementById('ldName').value = l.name || id;
  document.getElementById('ldName').disabled = true;
  document.getElementById('ldSlugHint').textContent = 'Link: mscript.vercel.app/loaders/'+id+' (name can\'t be changed)';
  document.getElementById('ldCode').value = l.code || '';
  document.getElementById('ldCount').textContent = (l.code||'').length+' characters';
  document.getElementById('ldBtnLabel').textContent = 'Save changes';
  document.getElementById('ldResult').style.display = 'none';
  window.scrollTo({top:0, behavior:'smooth'});
}
async function deleteLoaderItem(id){
  if(!confirm('Delete this loader? Any loadstring link using it will stop working.')) return;
  try{ await db.ref('loaders/'+id).remove(); toast('Loader deleted'); if(editingLoaderId===id) resetLoaderForm(); }
  catch(err){ toastError('Failed to delete: '+((err && err.message) || 'try again')); }
}
async function generateLoader(){
  if(!currentUid){ toast('Log in first to create a loader'); openAuth('login'); return; }
  const origin = loaderOrigin();
  if(!origin){ toast('This only works once the app is deployed (not opened as a local file)'); return; }
  const code = document.getElementById('ldCode').value;
  if(!code.trim()){ toast('Paste your script first'); return; }
  if(code.length > 200000){ toast('Script is too large (max 200,000 characters)'); return; }
  const rawName = document.getElementById('ldName').value;
  const btn = document.getElementById('ldBtnLabel');
  const wasEditing = !!editingLoaderId;
  let slug = editingLoaderId;
  if(!wasEditing){
    slug = slugifyLoaderName(rawName);
    if(!slug){ toast('Give your script a name first'); return; }
  }
  btn.textContent = wasEditing ? 'Saving...' : 'Generating...';
  try{
    let id = editingLoaderId;
    if(wasEditing){
      await withTimeout(db.ref('loaders/'+id).update({code, updated: Date.now()}), 12000, 'Saving script');
    } else {
      const existing = await db.ref('loaders/'+slug+'/ownerUid').once('value');
      if(existing.exists() && existing.val() !== currentUid){
        toast('That name is already taken, try another');
        btn.textContent = 'Generate protected link';
        return;
      }
      id = slug;
      await withTimeout(db.ref('loaders/'+id).set({code, name: rawName.trim().slice(0,60), ownerUid: currentUid, created: Date.now()}), 12000, 'Saving script');
    }
    const link = origin+'/loaders/'+id;
    const snippet = 'loadstring(game:HttpGet("'+link+'"))()';
    document.getElementById('ldSnippet').textContent = snippet;
    document.getElementById('ldLink').textContent = link;
    document.getElementById('ldPreview').href = link;
    document.getElementById('ldResult').style.display = '';
    try{
      await navigator.clipboard.writeText(snippet);
      toast('Copied: loadstring(...)');
    }catch(e){
      toast(wasEditing ? 'Loader updated' : 'Loader created');
    }
    editingLoaderId = id;
    document.getElementById('ldName').disabled = true;
    document.getElementById('ldSlugHint').textContent = 'Link: mscript.vercel.app/loaders/'+id+' (name can\'t be changed)';
    btn.textContent = 'Save changes';
    return;
  }catch(err){
    toastError('Failed to save: '+((err && err.message) || 'try again'));
  }
  btn.textContent = wasEditing ? 'Save changes' : 'Generate protected link';
}
function copyLoaderSnippet(){
  navigator.clipboard.writeText(document.getElementById('ldSnippet').textContent).then(()=>toast('Copied')).catch(()=>toast('Failed to copy'));
}
function copyLoaderLink(){
  navigator.clipboard.writeText(document.getElementById('ldLink').textContent).then(()=>toast('Link copied')).catch(()=>toast('Failed to copy'));
}

/* ---------- menu sheet ---------- */
/* ---------- menu sheet ---------- */
function openMenu(){
  document.getElementById('menuDev').style.display = isDeveloper(currentUsername) ? '' : 'none';
  document.getElementById('menuOverlay').classList.add('show');
}
function closeMenu(){ document.getElementById('menuOverlay').classList.remove('show'); }
function menuGo(name){ closeMenu(); if(name==='upload') openUploadFresh(); else go(name); }

/* ---------- online presence ---------- */
(function initPresence(){
  try{
    const myRef = db.ref('presence').push();
    db.ref('.info/connected').on('value', s=>{
      if(s.val()===true){ myRef.onDisconnect().remove().then(()=>myRef.set(true)).catch(()=>{}); }
    }, ()=>{});
    db.ref('presence').on('value', snap=>{ onlineCount = snap.numChildren(); updateStats(true); }, ()=>{});
  }catch(e){}
})();

/* ---------- detail page ---------- */
function openDetail(id){
  const pp = getPost(id);
  if(!pp) return;
  if(!canSee(pp)){ toast('This script is private'); return; }
  currentDetailId = id;
  try{
    if(!sessionStorage.getItem('ms_v_'+id)){
      sessionStorage.setItem('ms_v_'+id,'1');
      db.ref('posts/'+id+'/views').transaction(v=>(v||0)+1).catch(()=>{});
    }
  }catch(e){}
  renderDetail();
  go('detail');
}
function timeAgo(ts){
  if(!ts) return '';
  const sec = Math.max(1, Math.floor((Date.now()-ts)/1000));
  if(sec < 60) return 'just now';
  const m = Math.floor(sec/60); if(m < 60) return m+'min ago';
  const h = Math.floor(m/60); if(h < 24) return h+'h ago';
  const d = Math.floor(h/24); if(d < 30) return d+'d ago';
  const mo = Math.floor(d/30); if(mo < 12) return mo+'mo ago';
  return Math.floor(mo/12)+'y ago';
}
const ICON_UP = '<svg viewBox="0 0 24 24"><path d="M7 11v9H4v-9z"/><path d="M7 11l4-7c1.5 0 2.5 1 2.5 2.5V9H19a2 2 0 0 1 2 2.3l-1.2 7A2 2 0 0 1 17.8 20H7"/></svg>';
const ICON_EYE_CLOCK = '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>';
const ICON_FILE = '<svg viewBox="0 0 24 24"><path d="M8 7 3 12l5 5"/><path d="m16 7 5 5-5 5"/></svg>';
let lastFollowPost = null;
function renderDetail(){
  const p = getPost(currentDetailId);
  if(!p){ go('beranda'); return; }
  const th = document.getElementById('detailThumb');
  const dThumb = postThumb(p);
  if(dThumb){
    th.style.display = '';
    th.innerHTML = `<span class="badge">ROBLOX</span><img src="${dThumb}" style="width:100%;height:100%;object-fit:cover;display:block;">`;
  } else {
    th.style.display = 'none';
    th.innerHTML = '';
  }
  document.getElementById('detailTitle').textContent = p.title;
  currentDetailAuthorUid = p.authorUid;
  document.getElementById('detailAvatar').innerHTML = avatarInner(p.authorName, p.authorAvatar);
  document.getElementById('detailAuthor').innerHTML = escapeHTML(p.authorName||'') + devBadge(p.authorName);

  const desc = p.desc || 'No description.';
  const descEl = document.getElementById('detailDesc');
  descEl.textContent = desc;
  const long = desc.length > 220 || desc.split('\n').length > 5;
  if(lastFollowPost !== currentDetailId){ descEl.classList.add('collapsed'); document.getElementById('descMore').innerHTML = 'Show more '+'<svg viewBox="0 0 24 24"><path d="m6 9 6 6 6-6"/></svg>'; }
  document.getElementById('descMore').style.display = long ? '' : 'none';
  if(!long) descEl.classList.remove('collapsed');

  const tags = p.tags || [];
  const keyChip = p.keySystem==='key' ? '<span class="chip keyc">Key system</span>' : (p.keySystem==='keyless' ? '<span class="chip freec">Keyless</span>' : '');
  const extraChips = (p.universal ? '<span class="chip">Universal</span>' : '')
    + ((p.visibility && p.visibility!=='public') ? '<span class="chip visc">'+(p.visibility==='private'?'Private':'Unlisted')+'</span>' : '');
  const chipsHTML = keyChip + extraChips + tags.map(t=>`<span class="chip">#${escapeHTML(String(t).replace(/^#+/,''))}</span>`).join('');
  const feats = p.features ? (Array.isArray(p.features) ? p.features : Object.values(p.features)) : [];
  document.getElementById('featuresCard').style.display = feats.length ? '' : 'none';
  document.getElementById('detailFeatures').innerHTML = feats.map(f=>`<li>${escapeHTML(f)}</li>`).join('');
  const okUrl = u => typeof u==='string' && /^https:\/\/[^\s"'<>]+$/i.test(u);
  const linkBtns = [];
  if(okUrl(p.discord)) linkBtns.push(`<a class="linkBtn dc" href="${p.discord}" target="_blank" rel="noopener"><svg viewBox="0 0 24 24"><path d="M7.5 6.5C9 5.8 10.4 5.5 12 5.5s3 .3 4.5 1c1.7 2.5 2.5 5.2 2.8 8.3-1.3 1-2.7 1.6-4.2 2l-1-1.6M7.5 6.5C5.8 9 5 11.7 4.7 14.8c1.3 1 2.7 1.6 4.2 2l1-1.6"/><circle cx="9.6" cy="12" r="1.1"/><circle cx="14.4" cy="12" r="1.1"/></svg>Discord</a>`);
  if(okUrl(p.youtube)) linkBtns.push(`<a class="linkBtn yt" href="${p.youtube}" target="_blank" rel="noopener"><svg viewBox="0 0 24 24"><rect x="3" y="6" width="18" height="12" rx="4"/><path d="m10 9.5 5 2.5-5 2.5z"/></svg>YouTube</a>`);
  document.getElementById('detailLinks').innerHTML = linkBtns.join('');
  document.getElementById('detailLinks').style.display = linkBtns.length ? '' : 'none';
  document.getElementById('detailTags').innerHTML = chipsHTML;
  document.getElementById('tagsDivider').style.display = chipsHTML ? '' : 'none';
  document.getElementById('detailTags').style.display = chipsHTML ? '' : 'none';
  const gl = document.getElementById('detailGame');
  if(p.game){
    gl.style.display = '';
    const gg = gameOfPost(p);
    const gname = gg ? gg.name : p.game;
    gl.innerHTML = gameIconHTML(gg)+'<span>'+escapeHTML(gname)+'</span><svg viewBox="0 0 24 24"><path d="m9 5 7 7-7 7"/></svg>';
    gl.onclick = ()=>openGame(gname);
  } else { gl.style.display = 'none'; gl.innerHTML = ''; }
  document.getElementById('ownerActions').style.display = (currentUid && (currentUid===p.authorUid || isDeveloper(currentUsername))) ? 'flex' : 'none';
  document.getElementById('devLikesBtn').style.display = (currentUid && isDeveloper(currentUsername)) ? '' : 'none';

  const slots = Array.isArray(p.slots) ? p.slots : Object.values(p.slots||{});
  document.getElementById('detailSlotsStat').innerHTML = ICON_FILE + slots.length + (slots.length===1 ? ' slot' : ' slots');
  document.getElementById('detailTime').innerHTML = ICON_EYE_CLOCK + timeAgo(p.created);
  document.getElementById('detailViews').innerHTML = ICON_EYE + (p.views||0) + ' views';
  document.getElementById('detailSlots').innerHTML = slots.map((sl,i)=>{
    const code = sl.code || '';
    const lines = code ? code.split('\n').length : 0;
    const label = slots.length > 1 ? (sl.name || ('Slot '+(i+1))) : 'Script';
    return `<div class="dCard">
      <div class="dLabelRow"><span class="dLabel">${escapeHTML(label)}</span><span class="dCount">${lines} ${lines===1?'line':'lines'}</span></div>
      <div class="scriptActions"><button class="copyPill" onclick="copySlot(${i})">Copy</button></div>
      <pre class="codeBlock">${escapeHTML(code)}</pre>
    </div>`;
  }).join('') || '<div class="empty">No script slots.</div>';

  const likedBy = p.likedBy || {};
  const likeCount = likesOf(p);
  const liked = !!(currentUid && likedBy[currentUid]);
  const likeBtn = document.getElementById('likeBtn');
  likeBtn.classList.toggle('liked', liked);
  likeBtn.innerHTML = ICON_UP + '<span id="likeCount">'+likeCount+'</span>';

  document.getElementById('composeAvatar').innerHTML = currentUid ? avatarInner(currentUsername, currentUserData && currentUserData.avatar) : '?';
  updateSaveBtn();
  refreshDetailFollow(p.authorUid);
  lastFollowPost = currentDetailId;
  renderComments(p);
}
function toggleDesc(){
  const el = document.getElementById('detailDesc');
  const btn = document.getElementById('descMore');
  const collapsed = el.classList.toggle('collapsed');
  btn.innerHTML = (collapsed ? 'Show more ' : 'Show less ') + '<svg viewBox="0 0 24 24" style="transform:rotate('+(collapsed?0:180)+'deg)"><path d="m6 9 6 6 6-6"/></svg>';
}
function updateCommentChars(){
  const v = document.getElementById('commentInput').value.length;
  document.getElementById('commentChars').textContent = v+'/500';
}
function getSaved(){ try{ return JSON.parse(localStorage.getItem('ss_saved')||'[]'); }catch(e){ return []; } }
function updateSaveBtn(){ document.getElementById('saveBtn').classList.toggle('on', getSaved().includes(currentDetailId)); }
function toggleSave(){
  const list = getSaved();
  const i = list.indexOf(currentDetailId);
  if(i>=0){ list.splice(i,1); toast('Removed from saved'); } else { list.push(currentDetailId); toast('Saved'); }
  localStorage.setItem('ss_saved', JSON.stringify(list));
  updateSaveBtn();
}
async function refreshDetailFollow(authorUid){
  const btn = document.getElementById('detailFollowBtn');
  if(!authorUid || authorUid===currentUid){ btn.style.display = 'none'; return; }
  btn.style.display = '';
  if(!currentUid){ btn.textContent = '+ Follow'; btn.classList.remove('following'); return; }
  try{
    const snap = await db.ref(`follows/${authorUid}/${currentUid}`).once('value');
    if(currentDetailAuthorUid !== authorUid) return;
    btn.textContent = snap.exists() ? 'Following' : '+ Follow';
    btn.classList.toggle('following', snap.exists());
  }catch(e){}
}
async function toggleFollowAuthor(){
  if(!currentUid){ toast('Log in first to follow'); openAuth('login'); return; }
  const uid = currentDetailAuthorUid;
  if(!uid || uid===currentUid) return;
  try{
    const snap = await db.ref(`follows/${uid}/${currentUid}`).once('value');
    if(snap.exists()){
      await db.ref().update({ [`follows/${uid}/${currentUid}`]: null, [`followingList/${currentUid}/${uid}`]: null });
    } else {
      await db.ref().update({ [`follows/${uid}/${currentUid}`]: true, [`followingList/${currentUid}/${uid}`]: true });
    }
    refreshDetailFollow(uid);
  }catch(err){
    toastError('Failed to process follow: '+((err && err.message) || 'try again'));
  }
}
function copyMain(){
  const p = getPost(currentDetailId);
  if(!p) return;
  const slots = Array.isArray(p.slots) ? p.slots : Object.values(p.slots||{});
  const code = slots.map(sl=>sl.code||'').join('\n\n');
  navigator.clipboard.writeText(code).then(()=>toast('Script copied')).catch(()=>toast('Failed to copy'));
}
function copySlot(i){
  const p = getPost(currentDetailId);
  const slots = Array.isArray(p.slots) ? p.slots : Object.values(p.slots||{});
  const code = slots[i] ? (slots[i].code||'') : '';
  navigator.clipboard.writeText(code).then(()=>toast('Script copied')).catch(()=>toast('Failed to copy'));
}
async function toggleLike(){
  if(!currentUid){ toast('Log in first to like'); openAuth('login'); return; }
  const ref = db.ref(`posts/${currentDetailId}/likedBy/${currentUid}`);
  const snap = await ref.once('value');
  if(snap.exists()) await ref.remove(); else await ref.set(true);
}
function siteOrigin(){
  try{ if(location.origin && location.origin!=='null') return location.origin; }catch(e){}
  return '';
}
function baseUrl(){
  try{ if(location.origin && location.origin!=='null') return location.origin+location.pathname; }catch(e){}
  return location.href.split('#')[0];
}
async function shareText(title, text){
  if(navigator.share){
    try{ await navigator.share({title, text}); return; }
    catch(e){ if(e && e.name==='AbortError') return; }
  }
  try{ await navigator.clipboard.writeText(text); toast('Link copied'); }
  catch(e){ toast('Failed to share'); }
}
function sharePost(){
  const p = getPost(currentDetailId);
  if(!p) return;
  const gg = gameOfPost(p);
  const gname = gg ? gg.name : p.game;
  const url = siteOrigin()+'/script/'+p.id;
  shareText(p.title, p.title+'\n'+(gname ? gname+' · ' : '')+'by @'+(p.authorName||'')+'\n'+url);
}
function shareGame(){
  if(!currentGame) return;
  const info = gameInfo(currentGame);
  const n = postsOfGame(currentGame).length;
  const url = siteOrigin()+'/game/'+gameSlug(info.name);
  shareText(info.name, info.name+'\n'+n+' '+(n===1?'script':'scripts')+' on MScript\n'+url);
}
async function deletePost(){
  const p = getPost(currentDetailId);
  if(!p) return;
  if(!currentUid || (currentUid!==p.authorUid && !isDeveloper(currentUsername))){ toast('Not allowed'); return; }
  if(!confirm('Delete this script permanently?')) return;
  await db.ref('posts/'+currentDetailId).remove();
  toast('Script deleted');
  go('beranda');
}

/* ---------- comments ---------- */
function cmtHTML(c, cid, rid){
  const isReply = !!rid;
  const canDelete = currentUid && (currentUid===c.authorUid || isDeveloper(currentUsername));
  const delCall = isReply ? `deleteReply('${cid}','${rid}')` : `deleteComment('${cid}')`;
  return `<div class="cmt${isReply?' reply':''}">
    <div class="cmtAv" onclick="openUserProfile('${c.authorUid}')"><div class="miniAvatar big">${avatarInner(c.authorName,c.authorAvatar)}</div></div>
    <div class="cmtBody">
      <div class="cmtHead"><b onclick="openUserProfile('${c.authorUid}')">${escapeHTML(c.authorName||'')}</b>${devBadge(c.authorName)}<span>${timeAgo(c.created)}</span></div>
      <div class="cmtText">${escapeHTML(c.text)}</div>
      <div class="cmtActions">
        ${isReply ? '' : `<button class="cmtBtn" onclick="toggleReplyForm('${cid}')"><svg viewBox="0 0 24 24"><path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12z"/></svg>Reply</button>`}
        ${canDelete ? `<button class="cmtBtn del" onclick="${delCall}">Delete</button>` : ''}
      </div>
      ${isReply ? '' : `<div class="replyForm" id="replyForm_${cid}">
        <input id="replyInput_${cid}" placeholder="Write a reply...">
        <button class="sendBtn" onclick="submitReply('${cid}')">Send</button>
      </div>
      <div class="replyList">${Object.entries(c.replies||{}).sort((a,b)=>(a[1].created||0)-(b[1].created||0)).map(([rid2,r])=>cmtHTML(r,cid,rid2)).join('')}</div>`}
    </div>
  </div>`;
}
function renderComments(p){
  const comments = p.comments || {};
  const entries = Object.entries(comments).sort((a,b)=>(a[1].created||0)-(b[1].created||0));
  document.getElementById('commentCount').textContent = entries.length;
  const wrap = document.getElementById('commentList');
  wrap.innerHTML = entries.length ? entries.map(([cid,c])=>cmtHTML(c,cid,null)).join('') : '<div class="empty" style="padding:26px 10px 8px;">No comments yet.</div>';
}
async function submitComment(){
  if(!currentUid){ toast('Log in first to comment'); openAuth('login'); return; }
  const input = document.getElementById('commentInput');
  const text = input.value.trim();
  if(!text) return;
  const ref = db.ref(`posts/${currentDetailId}/comments`).push();
  await ref.set({authorUid:currentUid, authorName:currentUsername, authorAvatar:(currentUserData&&currentUserData.avatar)||null, text, created:Date.now()});
  input.value = '';
  updateCommentChars();
}
function toggleReplyForm(cid){
  document.getElementById('replyForm_'+cid).classList.toggle('show');
}
async function submitReply(cid){
  if(!currentUid){ toast('Log in first to reply'); openAuth('login'); return; }
  const input = document.getElementById('replyInput_'+cid);
  const text = input.value.trim();
  if(!text) return;
  const ref = db.ref(`posts/${currentDetailId}/comments/${cid}/replies`).push();
  await ref.set({authorUid:currentUid, authorName:currentUsername, authorAvatar:(currentUserData&&currentUserData.avatar)||null, text, created:Date.now()});
  input.value = '';
}
async function deleteComment(cid){
  if(!confirm('Delete this comment?')) return;
  await db.ref(`posts/${currentDetailId}/comments/${cid}`).remove();
}
async function deleteReply(cid, rid){
  if(!confirm('Delete this reply?')) return;
  await db.ref(`posts/${currentDetailId}/comments/${cid}/replies/${rid}`).remove();
}

/* ---------- inbox / developer reports ---------- */
function renderInbox(){
  updateFeedbackQuota();
  const convos = Object.entries(dmIndexCache).sort((a,b)=>(b[1].lastTime||0)-(a[1].lastTime||0));
  document.getElementById('dmConvoList').innerHTML = convos.length ? convos.map(([otherUid,c])=>`
    <div class="postCard" style="padding:12px 14px; cursor:pointer;" onclick="openDmChat('${otherUid}')">
      <div style="display:flex; align-items:center; gap:12px;">
        <div class="miniAvatar" style="width:40px;height:40px;font-size:1rem;">${avatarInner(c.otherName, c.otherAvatar)}</div>
        <div style="flex:1; min-width:0;">
          <div style="font-weight:800; color:var(--text);">${escapeHTML(c.otherName||'')}${devBadge(c.otherName)}</div>
          <div style="color:var(--muted); font-size:.85rem; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${escapeHTML(c.lastMessage||'')}</div>
        </div>
      </div>
    </div>`).join('') : '<div class="empty" id="inboxEmpty">No messages yet.</div>';

}
function renderDevPanel(){
  if(!isDeveloper(currentUsername)){ toast('Developers only'); setTimeout(()=>go('beranda'),0); return; }
  const nowT = Date.now();
  const fbEntries = Object.entries(feedbackCache)
    .filter(([id,f])=> f.read || (nowT-(f.time||0)) <= FB_TTL)
    .sort((a,b)=>(b[1].time||0)-(a[1].time||0));
  document.getElementById('devFeedbackList').innerHTML = fbEntries.length ? fbEntries.map(([fid,f])=>{
    const left = Math.max(1, Math.ceil((FB_TTL-(nowT-(f.time||0)))/3600000));
    const open = fbOpen.has(fid);
    return `<div class="fbItem ${f.read?'read':''} ${open?'open':''}">
      <button class="fbRow" onclick="toggleFeedback('${fid}')">
        <div class="fbWho"><b>${escapeHTML(f.byName||'anonymous')}</b><span>${timeAgo(f.time)}</span></div>
        <i class="fbState ${f.read?'ok':'warn'}">${f.read ? 'Read' : 'Unread · '+left+'h left'}</i>
        <svg class="fbChev" viewBox="0 0 24 24"><path d="m6 9 6 6 6-6"/></svg>
      </button>
      ${open ? `<div class="fbBody"><div class="fbText">${escapeHTML(f.text||'')}</div>
        <div class="fbActions"><button class="fbBtn del" onclick="dismissFeedback('${fid}')">Delete</button></div></div>` : ''}
    </div>`;
  }).join('') : '<div class="empty">No incoming feedback.</div>';

  const waIn = document.getElementById('devWaInput'), dcIn = document.getElementById('devDcInput');
  if(document.activeElement !== waIn) waIn.value = communityLinks.whatsapp;
  if(document.activeElement !== dcIn) dcIn.value = communityLinks.discord;
  const apiKeyInput = document.getElementById('devApiKeyInput');
  if(document.activeElement !== apiKeyInput) apiKeyInput.value = GEMINI_API_KEY || '';
  document.getElementById('dsScripts').textContent = fmtNum(postsArray().length);
  document.getElementById('dsUsers').textContent = fmtNum(Object.keys(usersCache).length);
  document.getElementById('dsUnread').textContent = Object.values(feedbackCache).filter(f=>!f.read && (nowT-(f.time||0)) <= FB_TTL).length;
  renderDevUsers();
  fillDevNumbers();
}
async function saveGeminiApiKey(){
  const val = document.getElementById('devApiKeyInput').value.trim();
  if(!val){ toast('Enter an API key first'); return; }
  try{
    await withTimeout(db.ref('config/geminiApiKey').set(val), 10000, 'Saving API key');
    toast('Gemini API key updated');
  }catch(err){
    toastError('Failed to save API key: '+((err && err.message) || 'try again'));
  }
}
const FB_LIMIT = 3;
const FB_TTL = 24*60*60*1000;
function fbDay(){ const d = new Date(); return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0'); }
function fbLocalCount(){
  try{ const o = JSON.parse(localStorage.getItem('ms_fb')||'{}'); return o.day===fbDay() ? (o.n||0) : 0; }catch(e){ return 0; }
}
function fbSetLocal(n){ try{ localStorage.setItem('ms_fb', JSON.stringify({day:fbDay(), n})); }catch(e){} }
function fbKey(){
  if(currentUid) return currentUid;
  let d = null;
  try{ d = localStorage.getItem('ms_device'); if(!d){ d = 'd'+Math.random().toString(36).slice(2)+Date.now().toString(36); localStorage.setItem('ms_device', d); } }catch(e){ d = 'anon'; }
  return d;
}
function updateFeedbackQuota(){
  const el = document.getElementById('feedbackQuota');
  if(!el) return;
  const left = Math.max(0, FB_LIMIT - fbLocalCount());
  el.textContent = left > 0 ? (left+' of '+FB_LIMIT+' feedback left today') : 'Daily limit reached ('+FB_LIMIT+' per day). Try again tomorrow.';
  const btn = document.getElementById('feedbackBtn');
  if(btn){ btn.disabled = left===0; btn.style.opacity = left===0 ? '.5' : ''; }
}
async function submitFeedback(){
  const input = document.getElementById('feedbackInput');
  const text = input.value.trim().slice(0,500);
  if(!text){ toast('Write some feedback first'); return; }
  if(fbLocalCount() >= FB_LIMIT){ toast('Daily feedback limit reached (3 per day)'); updateFeedbackQuota(); return; }
  try{
    let allowed = true;
    try{
      const res = await withTimeout(db.ref('feedbackLimits/'+fbKey()+'/'+fbDay()).transaction(v=> (v||0) >= FB_LIMIT ? undefined : (v||0)+1), 8000, 'Checking feedback limit');
      if(!res.committed) allowed = false;
    }catch(e){ /* rules/offline: the device limit above still applies */ }
    if(!allowed){ fbSetLocal(FB_LIMIT); updateFeedbackQuota(); toast('Daily feedback limit reached (3 per day)'); return; }
    const ref = db.ref('feedback').push();
    await withTimeout(ref.set({text, byUid: currentUid||null, byName: currentUsername||'anonymous', time: Date.now(), read:false}), 10000, 'Sending feedback');
    fbSetLocal(fbLocalCount()+1);
    input.value = '';
    updateFeedbackQuota();
    toast('Feedback sent, thank you');
  }catch(err){
    console.error(err);
    toastError('Failed to send feedback: '+((err && err.message) || 'try again'));
  }
}
const fbOpen = new Set();
function toggleFeedback(fid){
  if(fbOpen.has(fid)) fbOpen.delete(fid); else {
    fbOpen.add(fid);
    const f = feedbackCache[fid];
    if(f && !f.read) markFeedbackRead(fid);
  }
  renderDevPanel();
}
async function markFeedbackRead(fid){
  try{ await db.ref('feedback/'+fid+'/read').set(true); }catch(err){ toastError('Failed to update: '+((err && err.message) || 'try again')); }
}
async function markAllFeedbackRead(){
  const upd = {};
  Object.entries(feedbackCache).forEach(([id,f])=>{ if(!f.read) upd['feedback/'+id+'/read'] = true; });
  if(!Object.keys(upd).length){ toast('Nothing to mark'); return; }
  try{ await db.ref().update(upd); toast('All marked as read'); }catch(err){ toastError('Failed to update: '+((err && err.message) || 'try again')); }
}
async function dismissFeedback(fid){
  if(!confirm('Delete this feedback?')) return;
  await db.ref('feedback/'+fid).remove();
}
/* auto-delete unread feedback older than 24h (best effort, oldest first, in batches) */
async function cleanupFeedback(){
  try{
    const snap = await db.ref('feedback').limitToFirst(100).once('value');
    const val = snap.val() || {};
    const now = Date.now();
    const upd = {};
    Object.entries(val).forEach(([id,f])=>{ if(!f.read && (now-(f.time||0)) > FB_TTL) upd['feedback/'+id] = null; });
    if(Object.keys(upd).length) await db.ref().update(upd);
  }catch(e){}
}
setTimeout(cleanupFeedback, 3000);
setInterval(cleanupFeedback, 10*60*1000);

/* ---------- upload ---------- */
let upScope = 'game', upTagList = [], upFeatList = [], upVis = 'public';
const CHIP_CFG = {
  tag:  {max:10, chips:'tagChips',  count:'tagCount',  input:'tagInput',  len:30},
  feat: {max:30, chips:'featChips', count:'featCount', input:'featInput', len:80}
};
const VIS_HINTS = {
  public: 'Everyone can find this script in the feed.',
  unlisted: "Unlisted scripts don't appear in the feed or search. Only you can see them on your profile.",
  private: 'Private scripts are only visible to you.'
};
function isPublic(p){ return !p.visibility || p.visibility==='public'; }
function canSee(p){ return isPublic(p) || !!(currentUid && (p.authorUid===currentUid || isDeveloper(currentUsername))); }

function setKeySys(k){
  upKeySys = k;
  document.getElementById('tglKey').classList.toggle('on', k==='key');
}
function toggleOpt(which){
  if(which==='key') setKeySys(upKeySys==='key' ? 'keyless' : 'key');
}
function setVis(v){
  upVis = v;
  document.querySelectorAll('#visSeg button').forEach(b=>b.classList.toggle('active', b.dataset.vis===v));
  document.getElementById('visHint').textContent = VIS_HINTS[v];
}
function setScope(sc){
  upScope = sc;
  document.querySelectorAll('#scopeSeg button').forEach(b=>b.classList.toggle('active', b.dataset.scope===sc));
  document.getElementById('gameField').style.display = sc==='game' ? '' : 'none';
  document.getElementById('thumbHint').style.display = sc==='universal' ? '' : 'none';
  refreshCoverPreview();
}
function toggleMore(force){
  const box = document.getElementById('moreBox');
  const open = typeof force==='boolean' ? force : box.style.display==='none';
  box.style.display = open ? '' : 'none';
  document.getElementById('moreBtn').classList.toggle('open', open);
}
function updateCounters(){
  document.getElementById('titleCount').textContent = document.getElementById('upTitle').value.length+'/60';
  document.getElementById('descCount').textContent = document.getElementById('upDesc').value.length+'/10000';
}

/* chip inputs (tags + features) */
function chipListOf(k){ return k==='tag' ? upTagList : upFeatList; }
function renderChips(k){
  const cfg = CHIP_CFG[k], list = chipListOf(k);
  document.getElementById(cfg.chips).innerHTML = list.map((t,i)=>`<span class="inChip">${escapeHTML(t)}<button type="button" onclick="chipRemove('${k}',${i})" aria-label="Remove">✕</button></span>`).join('');
  document.getElementById(cfg.count).textContent = list.length+'/'+cfg.max;
}
function chipCommit(k){
  const cfg = CHIP_CFG[k], list = chipListOf(k), inp = document.getElementById(cfg.input);
  let v = inp.value.trim();
  if(k==='tag') v = v.replace(/^#+/,'').replace(/\s+/g,'');
  if(!v) { inp.value = ''; return; }
  if(list.length >= cfg.max){ toast('Limit reached ('+cfg.max+')'); inp.value=''; return; }
  if(!list.some(x=>x.toLowerCase()===v.toLowerCase())) list.push(v.slice(0,cfg.len));
  inp.value = '';
  renderChips(k);
}
function chipKey(e,k){
  if(e.key==='Enter' || (e.key===',' && k==='tag')){ e.preventDefault(); chipCommit(k); }
  else if(e.key==='Backspace' && !e.target.value){ chipListOf(k).pop(); renderChips(k); }
}
function chipRemove(k,i){ chipListOf(k).splice(i,1); renderChips(k); }

/* thumbnail */
function refreshCoverPreview(){
  const own = pendingThumbData || existingThumbUrl;
  if(own){ setThumbPreview(own); return; }
  if(upScope==='game' && upGameImage) setThumbPreview(upGameImage, true); else setThumbPreview(null);
}
function postThumb(p){
  if(p.thumb) return p.thumb;
  const g = gameOfPost(p);
  return g && g.image ? g.image : null;
}
function setThumbPreview(url, auto){
  const box = document.getElementById('thumbUploadBox');
  const icon = document.getElementById('thumbIcon');
  const label = document.getElementById('thumbLabel');
  const sub = document.getElementById('thumbSub');
  if(url){
    box.style.backgroundImage = 'url("'+url+'")';
    box.classList.add('hasImg');
    icon.style.display = 'none';
    sub.style.display = 'none';
    label.textContent = auto ? 'Using the game photo · tap to change' : 'Tap to change thumbnail';
  } else {
    box.style.backgroundImage = '';
    box.classList.remove('hasImg');
    icon.style.display = '';
    sub.style.display = '';
    label.textContent = 'Add a thumbnail';
  }
}
async function pickThumb(e){
  const file = e.target.files[0];
  e.target.value = '';
  if(!file) return;
  if(file.size > 5*1024*1024){ toast('Image is too large (max 5MB)'); return; }
  try{
    pendingThumbData = await compressImageToDataURL(file, 800, 0.75);
    setThumbPreview(pendingThumbData);
  }catch(err){
    toastError('Failed to process image: '+((err && err.message) || 'try again'));
  }
}

/* code editor + slots */
function addSlot(name, code){
  slotCount++;
  const id = 'slot'+slotCount;
  const div = document.createElement('div');
  div.className = 'slotBox';
  div.id = id;
  div.innerHTML = `
    <div class="slotHead">
      <input value="${escapeHTML(name || ('Slot '+slotCount))}">
      <button class="removeSlot" onclick="document.getElementById('${id}').remove()">\u2715</button>
    </div>
    <textarea class="codeArea" autocapitalize="off" autocorrect="off" spellcheck="false" autocomplete="off">${escapeHTML(code||'')}</textarea>`;
  document.getElementById('slotsWrap').appendChild(div);
}
addSlot();
function updateCodeSummary(){
  const boxes = [...document.querySelectorAll('.slotBox')].map(b=>b.querySelector('textarea').value).filter(c=>c.trim());
  const el = document.getElementById('codeSummary');
  if(!boxes.length){ el.textContent = 'Add your script code'; el.classList.remove('filled'); return; }
  const lines = boxes.reduce((n,c)=>n+c.split('\n').length, 0);
  el.textContent = boxes.length+' '+(boxes.length===1?'slot':'slots')+' · '+lines+' lines';
  el.classList.add('filled');
}
function openCodeEditor(){ document.getElementById('codeEditor').classList.add('show'); }
function closeCodeEditor(){ document.getElementById('codeEditor').classList.remove('show'); updateCodeSummary(); }

function resetUploadForm(){
  if(confirm('Clear everything on this form?')) openUploadFresh();
}
function openUploadFresh(){
  editingPostId = null;
  pendingThumbData = null;
  existingThumbUrl = null;
  document.getElementById('upTitle').value = '';
  document.getElementById('upDesc').value = '';
  document.getElementById('upDiscord').value = '';
  document.getElementById('upYoutube').value = '';
  upTagList = []; upFeatList = [];
  renderChips('tag'); renderChips('feat');
  document.getElementById('slotsWrap').innerHTML = '';
  slotCount = 0; addSlot();
  setUploadGame(null,'');
  setScope('game');
  setKeySys('keyless');
  setVis('public');
  toggleMore(false);
  updateCounters();
  updateCodeSummary();
  setThumbPreview(null);
  document.getElementById('uploadHeading').textContent = 'Publish script';
  document.getElementById('publishBtnLabel').textContent = 'Publish script';
  go('upload');
}
function startEditPost(){
  const p = getPost(currentDetailId);
  if(!p) return;
  if(!currentUid || (currentUid!==p.authorUid && !isDeveloper(currentUsername))){ toast('Not allowed'); return; }
  editingPostId = p.id;
  pendingThumbData = null;
  existingThumbUrl = p.thumb || null;
  document.getElementById('upTitle').value = p.title || '';
  document.getElementById('upDesc').value = p.desc || '';
  document.getElementById('upDiscord').value = p.discord || '';
  document.getElementById('upYoutube').value = p.youtube || '';
  upTagList = (p.tags||[]).map(t=>String(t).replace(/^#+/,'')).filter(Boolean);
  upFeatList = (p.features ? (Array.isArray(p.features) ? p.features : Object.values(p.features)) : []).slice();
  renderChips('tag'); renderChips('feat');
  document.getElementById('slotsWrap').innerHTML = '';
  slotCount = 0;
  const slots = Array.isArray(p.slots) ? p.slots : Object.values(p.slots||{});
  slots.forEach(sl=>addSlot(sl.name, sl.code));
  if(slotCount===0) addSlot();
  const gg = gameOfPost(p);
  setUploadGame(p.placeId ? String(p.placeId) : null, gg ? gg.name : (p.universal ? '' : (p.game||'')), gg ? gg.image : null, p.universeId || (gg && gg.universeId) || null);
  setScope(p.universal ? 'universal' : 'game');
  setKeySys(p.keySystem || 'keyless');
  setVis(p.visibility || 'public');
  toggleMore(!!(upTagList.length || upFeatList.length || p.discord || p.youtube || p.keySystem==='key' || (p.visibility && p.visibility!=='public')));
  updateCounters();
  updateCodeSummary();
  refreshCoverPreview();
  document.getElementById('uploadHeading').textContent = 'Edit script';
  document.getElementById('publishBtnLabel').textContent = 'Save changes';
  go('upload');
}

async function publishScript(){
  if(!currentUid){ toast('Log in first to upload scripts'); openAuth('login'); return; }
  chipCommit('tag'); chipCommit('feat');
  const universal = upScope==='universal';
  const game = universal ? 'Universal' : upGameName.trim();
  if(!universal){
    if(!game || (!upGameId && !editingPostId)){ toast('Choose a game first'); return; }
  }
  const title = document.getElementById('upTitle').value.trim();
  if(!title){ toast('Title is required'); return; }
  const slots = [...document.querySelectorAll('.slotBox')].map((b,i)=>({
    name: b.querySelector('input').value.trim() || ('Slot '+(i+1)),
    code: b.querySelector('textarea').value
  })).filter(sl=>sl.code.trim());
  if(!slots.length){ toast('Add your script code'); return; }
  const desc = document.getElementById('upDesc').value.trim();
  if(desc.length < 30){ toast('Description must be at least 30 characters'); return; }
  const thumbUrl = pendingThumbData || existingThumbUrl || null;
  if(universal && !thumbUrl){ toast('Universal scripts need a thumbnail'); return; }
  const discord = document.getElementById('upDiscord').value.trim();
  const youtube = document.getElementById('upYoutube').value.trim();
  const urlOk = u => /^https:\/\/[^\s"'<>]+$/i.test(u);
  if(discord && !(urlOk(discord) && /^https:\/\/(www\.)?(discord\.gg|discord\.com|discordapp\.com)\//i.test(discord))){ toast('Enter a valid Discord invite link'); toggleMore(true); return; }
  if(youtube && !(urlOk(youtube) && /^https:\/\/(www\.|m\.)?(youtube\.com|youtu\.be)\//i.test(youtube))){ toast('Enter a valid YouTube link'); toggleMore(true); return; }

  const placeIdVal = (!universal && /^\d+$/.test(String(upGameId||''))) ? String(upGameId) : null;
  const universeIdVal = universal ? null : (upGameUniverse ? String(upGameUniverse) : null);
  const data = {
    title, game, gameId: null, placeId: placeIdVal, universeId: universeIdVal, gameImage: universal ? null : (upGameImage||null), universal,
    keySystem: upKeySys,
    tags: upTagList.slice(), features: upFeatList.slice(),
    desc, slots, thumb: thumbUrl,
    discord: discord || null, youtube: youtube || null, visibility: upVis
  };

  toast('Saving...');
  try{
    if(editingPostId){
      const target = getPost(editingPostId);
      if(!target || (target.authorUid!==currentUid && !isDeveloper(currentUsername))){ toast('Not allowed'); return; }
      await withTimeout(db.ref('posts/'+editingPostId).update(data), 10000, 'Saving script changes');
      toast('Changes saved');
      const savedId = editingPostId;
      openUploadFresh();
      openDetail(savedId);
      return;
    }
    const ref = db.ref('posts').push();
    await withTimeout(ref.set(Object.assign({
      authorUid: currentUid, authorName: currentUsername, authorAvatar: (currentUserData&&currentUserData.avatar)||null,
      created: Date.now()
    }, data)), 10000, 'Publishing script');
    toast('Script published!');
    openUploadFresh();
    go('beranda');
  }catch(err){
    toastError('Failed to save script: '+((err && err.message) || 'try again') + (err && err.code ? ' ('+err.code+')' : ''));
  }
}

/* ---------- AI assistant (Gemini) ---------- */
let aiMessages = [];
let aiPending = false;
let aiCodeBlocks = [];
let currentViewerCode = '';

function extForLang(lang){
  const map = {
    lua:'lua', html:'html', htm:'html', js:'js', javascript:'js', ts:'ts', typescript:'ts',
    python:'py', py:'py', css:'css', json:'json', xml:'xml', bash:'sh', sh:'sh', shell:'sh',
    java:'java', c:'c', cpp:'cpp', 'c++':'cpp', csharp:'cs', cs:'cs', php:'php', sql:'sql',
    yaml:'yaml', yml:'yaml', kotlin:'kt', swift:'swift', rb:'rb', ruby:'rb', go:'go', rust:'rs'
  };
  const key = (lang||'').toLowerCase();
  return map[key] || (key && key.length<=5 ? key : 'txt');
}
function parseAiMessageSegments(text){
  const regex = /```(\w+)?\n?([\s\S]*?)```/g;
  const segments = [];
  let lastIndex = 0, match;
  while((match = regex.exec(text)) !== null){
    if(match.index > lastIndex) segments.push({type:'text', content: text.slice(lastIndex, match.index)});
    segments.push({type:'code', lang: match[1]||'txt', content: (match[2]||'').replace(/\n$/,'')});
    lastIndex = regex.lastIndex;
  }
  if(lastIndex < text.length) segments.push({type:'text', content: text.slice(lastIndex)});
  return segments;
}
function fmtAiText(t){
  return escapeHTML(t)
    .replace(/\*\*([^*\n]+)\*\*/g,'<b>$1</b>')
    .replace(/`([^`\n]+)`/g,'<code class="inl">$1</code>');
}
function aiSuggest(text){
  document.getElementById('aiInput').value = text;
  sendAiMessage();
}
function renderAiChat(){
  aiCodeBlocks = [];
  const wrap = document.getElementById('aiChatList');
  if(!aiMessages.length && !aiPending){
    wrap.innerHTML = `<div class="aiEmpty">
      <div class="aiOrb"><svg viewBox="0 0 24 24"><path d="M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5 18 18M18 6l-2.5 2.5M8.5 15.5 6 18"/></svg></div>
      <h2>How can I help?</h2>
      <p>Write, fix, or explain Roblox Lua scripts.</p>
      <div class="aiChips">
        <button onclick="aiSuggest('Write a Roblox Lua script for an auto farm loop')">Write an auto farm script</button>
        <button onclick="aiSuggest('Explain how RemoteEvents work in Roblox')">Explain RemoteEvents</button>
        <button onclick="aiSuggest('Help me fix an error in my Lua script')">Fix a bug</button>
        <button onclick="aiSuggest('Make a simple draggable GUI in Roblox Lua')">Draggable GUI</button>
      </div>
    </div>`;
    return;
  }
  const bubbles = aiMessages.map(m=>{
    if(m.role==='user'){
      return `<div class="aiRow user"><div class="aiUserBubble">${escapeHTML(m.text)}</div></div>`;
    }
    const segments = parseAiMessageSegments(m.text);
    const inner = segments.map(seg=>{
      if(seg.type==='text'){
        const trimmed = seg.content.trim();
        return trimmed ? `<div class="aiText">${fmtAiText(trimmed)}</div>` : '';
      }
      const ext = extForLang(seg.lang);
      const idx = aiCodeBlocks.length;
      aiCodeBlocks.push({ext, code: seg.content});
      return `<div class="codeFileCard" onclick="openCodeViewer(${idx})">
        <div class="codeFileIcon">&lt;/&gt;</div>
        <div class="codeFileMeta">
          <div class="codeFileName">code.${ext}</div>
          <div class="codeFileSub">Code · ${ext.toUpperCase()} · ${seg.content.split('\n').length} lines</div>
        </div>
        <button class="codeFileBtn" onclick="event.stopPropagation(); openCodeViewer(${idx})">Open</button>
      </div>`;
    }).join('');
    return `<div class="aiRow bot"><img class="aiAv" src="/logo.png" alt=""><div class="aiCol">${inner}</div></div>`;
  }).join('');
  const pendingBubble = aiPending ? `<div class="aiRow bot"><img class="aiAv" src="/logo.png" alt=""><div class="aiCol"><div class="aiText typing"><i></i><i></i><i></i></div></div></div>` : '';
  wrap.innerHTML = bubbles + pendingBubble;
  window.scrollTo({top: document.body.scrollHeight, behavior:'smooth'});
}
async function clearAiHistory(){
  if(!aiMessages.length){ toast('No history yet'); return; }
  if(!confirm('Delete all AI chat history?')) return;
  if(currentUid){
    try{
      await withTimeout(db.ref('aiChats/'+currentUid).remove(), 10000, 'Deleting chat history');
    }catch(err){
      toastError('Failed to delete history: '+((err && err.message) || 'try again'));
      return;
    }
  } else {
    aiMessages = [];
  }
  renderAiChat();
}
function openCodeViewer(idx){
  const block = aiCodeBlocks[idx];
  if(!block) return;
  currentViewerCode = block.code;
  document.getElementById('codeViewerTitle').textContent = 'code.'+block.ext;
  document.getElementById('codeViewerLang').textContent = 'Code · '+block.ext.toUpperCase();
  document.getElementById('codeViewerContent').textContent = block.code;
  document.getElementById('codeViewerOverlay').classList.add('show');
}
function closeCodeViewer(){ document.getElementById('codeViewerOverlay').classList.remove('show'); }
function copyViewerCode(){
  navigator.clipboard.writeText(currentViewerCode).then(()=>toast('Code copied')).catch(()=>toast('Failed to copy'));
}
async function fetchGeminiWithRetry(contents, attempt){
  attempt = attempt || 1;
  const maxAttempts = 3;
  try{
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${GEMINI_API_KEY}`, {
      method: 'POST',
      headers: {'Content-Type':'application/json'},
      body: JSON.stringify({
        contents,
        systemInstruction: { parts: [{ text: 'You are an assistant that helps users of the MScript app write, fix, and explain Lua scripts for Roblox, plus HTML, JavaScript, Python, and other programming languages. Answer briefly and clearly in English unless asked for another language. IMPORTANT: whenever your answer contains program code (Lua, HTML, JS, Python, etc.), ALWAYS wrap that code in a markdown code block with the language name right after the three backticks, for example: ```lua\ncode here\n```. Never put code outside a code block. Write short explanations outside the code block.' }] }
      })
    });
    if(res.status===429 && attempt<maxAttempts){
      await new Promise(r=>setTimeout(r, attempt*1200));
      return fetchGeminiWithRetry(contents, attempt+1);
    }
    if(!res.ok){
      const errText = await res.text();
      throw new Error('HTTP '+res.status+': '+errText.slice(0,200));
    }
    const data = await res.json();
    const parts = data && data.candidates && data.candidates[0] && data.candidates[0].content && data.candidates[0].content.parts;
    return (parts ? parts.map(p=>p.text||'').join('') : '') || '(no response)';
  }catch(err){
    if(attempt<maxAttempts){
      await new Promise(r=>setTimeout(r, attempt*1200));
      return fetchGeminiWithRetry(contents, attempt+1);
    }
    throw err;
  }
}
async function sendAiMessage(){
  const input = document.getElementById('aiInput');
  const text = input.value.trim();
  if(!text) return;
  if(!GEMINI_API_KEY || GEMINI_API_KEY.indexOf('PASTE_API_KEY')===0){
    toastError('Gemini API key is not set — open the code, find GEMINI_API_KEY, and fill in your API key.');
    return;
  }
  input.value = '';

  const contents = aiMessages.filter(m=>!m.pending).map(m=>({
    role: m.role==='user' ? 'user' : 'model',
    parts: [{ text: m.text }]
  }));
  contents.push({ role:'user', parts:[{ text }] });

  if(currentUid){
    await db.ref('aiChats/'+currentUid).push().set({role:'user', text, time:Date.now()});
  } else {
    aiMessages.push({role:'user', text});
  }
  aiPending = true;
  renderAiChat();

  let replyText;
  try{
    replyText = await fetchGeminiWithRetry(contents);
  }catch(err){
    replyText = 'Sorry, an error occurred: '+((err && err.message) || 'try again');
  }

  if(currentUid){
    await db.ref('aiChats/'+currentUid).push().set({role:'model', text: replyText, time:Date.now()});
  } else {
    aiMessages.push({role:'model', text: replyText});
  }
  aiPending = false;
  renderAiChat();
}
/* ---------- URL routing (clean paths: /upload, /globalchat, /script/<id> ...) ---------- */
const PAGE_PATHS = {beranda:'/', inbox:'/inbox', ai:'/ai', profil:'/profile', upload:'/upload', gchat:'/globalchat', dev:'/developer'};
const PATH_PAGES = {};
Object.keys(PAGE_PATHS).forEach(k=>{ PATH_PAGES[PAGE_PATHS[k]] = k; });
Object.assign(PATH_PAGES, {'/home':'beranda', '/profil':'profil', '/chat':'gchat', '/global-chat':'gchat', '/dev':'dev'});
const PAGE_TITLES = {beranda:'', inbox:'Inbox', ai:'AI Assistant', profil:'Profile', upload:'Publish script', gchat:'Global Chat', dev:'Developer', userprofile:'Profile', dm:'Messages'};
let routingFromUrl = false;
let pendingDeep = null;
var authReady = (typeof authReady!=='undefined') ? authReady : false;
function safeDecode(v){ try{ return decodeURIComponent(v); }catch(e){ return v; } }
function gameSlug(n){
  const sl = String(n||'').toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-+|-+$/g,'');
  return sl || encodeURIComponent(n||'');
}
function activePageName(){
  const a = document.querySelector('.page.active');
  return a ? a.id.replace('page-','') : 'beranda';
}
function pathFor(name){
  if(PAGE_PATHS[name]) return PAGE_PATHS[name];
  if(name==='detail' && currentDetailId) return '/script/'+currentDetailId;
  if(name==='game' && currentGame) return '/game/'+gameSlug(currentGame);
  if(name==='userprofile' && viewingUid){ const u = usersCache[viewingUid]; return u && u.username ? '/user/'+encodeURIComponent(u.username) : null; }
  if(name==='dm' && currentDmOtherUid){ const u = usersCache[currentDmOtherUid]; return u && u.username ? '/dm/'+encodeURIComponent(u.username) : null; }
  return null;
}
function syncUrl(name){
  let t = PAGE_TITLES[name];
  if(name==='detail'){ const p = getPost(currentDetailId); t = p ? p.title : 'Script'; }
  if(name==='game') t = currentGame || 'Game';
  document.title = t ? t+' · MScript' : 'MScript';
  if(routingFromUrl) return;
  if(!/^https?:$/.test(location.protocol)) return;
  const path = pathFor(name);
  if(!path || location.pathname === path) return;
  history.pushState({n:name}, '', path);
}
function parsePath(){
  let m = location.hash.match(/^#\/script\/([\w-]+)/);
  if(m) return {t:'script', v:m[1]};
  m = location.hash.match(/^#\/game\/(.+)$/);
  if(m) return {t:'game', v:safeDecode(m[1])};
  let path = (location.pathname || '/').replace(/\/+$/,'') || '/';
  if(path==='/index.html') path = '/';
  if(PATH_PAGES[path]) return {t:'page', v:PATH_PAGES[path]};
  m = path.match(/^\/script\/([\w-]+)$/); if(m) return {t:'script', v:m[1]};
  m = path.match(/^\/game\/(.+)$/);       if(m) return {t:'game', v:safeDecode(m[1])};
  m = path.match(/^\/user\/(.+)$/);       if(m) return {t:'user', v:safeDecode(m[1])};
  m = path.match(/^\/dm\/(.+)$/);         if(m) return {t:'dm', v:safeDecode(m[1])};
  return null;
}
function resolveGameName(v){
  const k = String(v).toLowerCase();
  const names = gamesList().map(g=>g.name).concat(['Universal']);
  return names.find(n=>gameSlug(n)===k || n.toLowerCase()===k) || null;
}
function tryDeep(){
  const d = pendingDeep;
  if(!d) return;
  const haveData = Object.keys(postsCache).length > 0;
  routingFromUrl = true;
  try{
    if(d.t==='page'){
      if(d.v==='dev' && !authReady) return;
      pendingDeep = null; go(d.v);
    }
    else if(d.t==='script'){
      if(!haveData || !getPost(d.v)) return;
      pendingDeep = null; openDetail(d.v);
    } else if(d.t==='game'){
      if(!haveData) return;
      pendingDeep = null; openGame(resolveGameName(d.v) || d.v);
    } else if(d.t==='user'){
      const u = usersArray().find(x=>(x.username||'').toLowerCase()===d.v.toLowerCase());
      if(!u) return;
      pendingDeep = null; openUserProfile(u.uid);
    } else if(d.t==='dm'){
      if(!currentUid) return;
      const u = usersArray().find(x=>(x.username||'').toLowerCase()===d.v.toLowerCase());
      if(!u) return;
      pendingDeep = null; openDmChat(u.uid);
    }
  } finally { routingFromUrl = false; }
  try{
    if(/^https?:$/.test(location.protocol)){
      const path = pathFor(activePageName());
      if(path && location.pathname !== path) history.replaceState({}, '', path);
    }
  }catch(e){}
}
window.addEventListener('popstate', ()=>{ pendingDeep = parsePath() || {t:'page', v:'beranda'}; tryDeep(); });
window.addEventListener('hashchange', ()=>{ const d = parsePath(); if(d){ pendingDeep = d; tryDeep(); } });
pendingDeep = parsePath();
if(pendingDeep && pendingDeep.t==='page' && pendingDeep.v==='beranda') pendingDeep = null;
if(!pendingDeep && /^https?:$/.test(location.protocol) && (location.pathname||'/') !== '/'){
  try{ if(!PATH_PAGES[(location.pathname||'/').replace(/\/+$/,'') || '/']) history.replaceState({}, '', '/'); }catch(e){}
}
tryDeep();
