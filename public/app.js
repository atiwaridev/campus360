// =================================================================
// Campus360 - Minimalist Frontend Application Logic
// Timezone: Indian Standard Time (IST, UTC+5:30)
// Zero emojis, strict in-memory session (NO localStorage / sessionStorage)
// =================================================================

// Session & State Variables (in-memory only)
let currentUser = null;
let currentRole = null;
let currentToken = null;
let currentPhone = null;
let currentFullName = null;
let currentRoom = null;
let staffList = [];
let searchTimeout = null;
let notifPollInterval = null;
let lastKnownNotifCount = 0;

// DOM Elements
const viewLogin = document.getElementById('view-login');
const viewStudent = document.getElementById('view-student');
const viewAdmin = document.getElementById('view-admin');
const userDisplay = document.getElementById('user-display');
const activeUserName = document.getElementById('active-user-name');
const activeUserBadge = document.getElementById('active-user-badge');
const navNotifContainer = document.getElementById('nav-notif-container');
const notifBadge = document.getElementById('notif-badge');
const notifDropdown = document.getElementById('notif-dropdown');
const notifList = document.getElementById('notif-list');
const btnLogout = document.getElementById('btn-logout');
const btnThemeToggle = document.getElementById('btn-theme-toggle');
const themeLabel = document.getElementById('theme-label');

// Modals & Containers
const modalFeedback = document.getElementById('modal-feedback');
const modalAnnouncement = document.getElementById('modal-announcement');
const toastContainer = document.getElementById('toast-container');

// Forms
const formLogin = document.getElementById('form-login');
const formTicket = document.getElementById('form-ticket');
const formLostFound = document.getElementById('form-lostfound');
const formFeedback = document.getElementById('form-feedback');
const formAnnouncement = document.getElementById('form-announcement');

// -----------------------------------------------------------------
// Timezone Utilities (Indian Standard Time - Asia/Kolkata)
// -----------------------------------------------------------------
function parseServerDate(dateString) {
  if (!dateString) return null;
  let s = String(dateString).trim();
  // If SQLite format 'YYYY-MM-DD HH:MM:SS', interpret as UTC
  if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(s)) {
    s = s.replace(' ', 'T') + 'Z';
  } else if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
    s = s + 'T00:00:00Z';
  }
  const date = new Date(s);
  return isNaN(date.getTime()) ? null : date;
}

function formatIST(dateString) {
  const d = parseServerDate(dateString);
  if (!d) return dateString ? String(dateString) : 'N/A';

  return d.toLocaleString('en-IN', {
    timeZone: 'Asia/Kolkata',
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: true
  });
}

function formatISTTime(dateString) {
  const d = parseServerDate(dateString);
  if (!d) return '';

  return d.toLocaleTimeString('en-IN', {
    timeZone: 'Asia/Kolkata',
    hour: '2-digit',
    minute: '2-digit',
    hour12: true
  });
}

function formatISTDate(dateString) {
  const d = parseServerDate(dateString);
  if (!d) return '';

  return d.toLocaleDateString('en-IN', {
    timeZone: 'Asia/Kolkata',
    day: '2-digit',
    month: 'short',
    year: 'numeric'
  });
}

function timeAgo(dateString) {
  const d = parseServerDate(dateString);
  if (!d) return '';
  const now = new Date();
  const diffSec = Math.max(0, Math.floor((now.getTime() - d.getTime()) / 1000));
  if (diffSec < 60) return `${diffSec}s ago`;
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHours = Math.floor(diffMin / 60);
  if (diffHours < 24) return `${diffHours}h ago`;
  const diffDays = Math.floor(diffHours / 24);
  return `${diffDays}d ago`;
}

// -----------------------------------------------------------------
// Toast Notification Helper (Clean & Minimalist)
// -----------------------------------------------------------------
function showToast(message, type = 'info') {
  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  toast.innerHTML = `<span>${escapeHTML(message)}</span>`;
  toastContainer.appendChild(toast);

  setTimeout(() => {
    toast.style.opacity = '0';
    setTimeout(() => toast.remove(), 250);
  }, 4000);
}

// -----------------------------------------------------------------
// Authenticated API Fetch Helper
// -----------------------------------------------------------------
async function apiFetch(url, options = {}) {
  const headers = options.headers || {};
  if (currentToken) {
    headers['Authorization'] = `Bearer ${currentToken}`;
  }
  if (!(options.body instanceof FormData) && !headers['Content-Type']) {
    headers['Content-Type'] = 'application/json';
  }

  const response = await fetch(url, { ...options, headers });
  if (response.status === 401 && currentToken) {
    showToast('Session expired. Please sign in again.', 'warning');
    logout();
    throw new Error('Unauthorized');
  }
  return response;
}

// -----------------------------------------------------------------
// Dark Mode Theme Controller
// -----------------------------------------------------------------
let isDarkMode = false;
btnThemeToggle.addEventListener('click', () => {
  isDarkMode = !isDarkMode;
  if (isDarkMode) {
    document.documentElement.setAttribute('data-theme', 'dark');
    themeLabel.textContent = 'Light';
  } else {
    document.documentElement.removeAttribute('data-theme');
    themeLabel.textContent = 'Dark';
  }
});

// -----------------------------------------------------------------
// View Switching & Session Lifecycle
// -----------------------------------------------------------------
function switchView(viewName) {
  viewLogin.classList.remove('active');
  viewStudent.classList.remove('active');
  viewAdmin.classList.remove('active');

  if (viewName === 'login') {
    viewLogin.classList.add('active');
    userDisplay.classList.add('hidden');
    navNotifContainer.classList.add('hidden');
    currentUser = null;
    currentRole = null;
    currentToken = null;
    currentPhone = null;
    currentFullName = null;
    currentRoom = null;
    lastKnownNotifCount = 0;
    if (notifPollInterval) clearInterval(notifPollInterval);
  } else if (viewName === 'student') {
    viewStudent.classList.add('active');
    userDisplay.classList.remove('hidden');
    navNotifContainer.classList.remove('hidden'); // Enable notifications bell for student
    activeUserName.textContent = currentFullName || currentUser.split('@')[0];
    activeUserBadge.textContent = 'Student';
    activeUserBadge.style.color = 'var(--primary)';
    
    switchStudentTab('overview');
    loadStudentOverview();
    startNotificationPolling();
  } else if (viewName === 'admin') {
    viewAdmin.classList.add('active');
    userDisplay.classList.remove('hidden');
    navNotifContainer.classList.remove('hidden'); // Enable notifications bell for admin
    activeUserName.textContent = 'Administrator';
    activeUserBadge.textContent = 'Admin';
    activeUserBadge.style.color = 'var(--danger)';

    loadStaffList();
    switchAdminTab('stats');
    startNotificationPolling();
  }
}

function logout() {
  switchView('login');
  showToast('Signed out successfully.', 'info');
}

btnLogout.addEventListener('click', logout);

// -----------------------------------------------------------------
// Authentication Handler
// -----------------------------------------------------------------
formLogin.addEventListener('submit', async (e) => {
  e.preventDefault();
  const email = document.getElementById('login-email').value.trim();
  const password = document.getElementById('login-password').value;

  try {
    const res = await fetch('/api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password })
    });

    const data = await res.json();
    if (!res.ok || !data.success) {
      showToast(data.message || 'Login failed. Please check your credentials.', 'error');
      return;
    }

    currentUser = data.email;
    currentRole = data.role;
    currentToken = data.token;
    currentPhone = data.phone;
    currentFullName = data.full_name;
    currentRoom = data.room_info;

    showToast(`Signed in as ${currentFullName || currentUser}.`, 'success');
    switchView(data.role);
  } catch (err) {
    showToast('Failed to connect to campus server.', 'error');
  }
});

// -----------------------------------------------------------------
// Student Dashboard Navigation Tabs
// -----------------------------------------------------------------
function switchStudentTab(tabName) {
  const tabs = document.querySelectorAll('#view-student .nav-tab');
  const panels = document.querySelectorAll('#view-student .tab-panel');

  tabs.forEach(t => t.classList.remove('active'));
  panels.forEach(p => p.classList.remove('active'));

  const activePanel = document.getElementById(`student-tab-${tabName}`);
  if (activePanel) activePanel.classList.add('active');

  const btn = Array.from(tabs).find(t => t.getAttribute('onclick')?.includes(tabName));
  if (btn) btn.classList.add('active');

  if (tabName === 'overview') loadStudentOverview();
  if (tabName === 'my-tickets') loadStudentTickets();
  if (tabName === 'lost-found') loadLostFoundFeed('student');
  if (tabName === 'announcements') loadAnnouncements('student');
  if (tabName === 'room-info') loadStudentRoomInfo();
  if (tabName === 'sos') loadStudentSOSHistory();
}

// -----------------------------------------------------------------
// Student Overview
// -----------------------------------------------------------------
async function loadStudentOverview() {
  document.getElementById('student-welcome-msg').textContent = `Welcome back, ${currentFullName || currentUser.split('@')[0]}`;
  
  const chip = document.getElementById('overview-room-chip');
  if (currentRoom) {
    chip.innerHTML = `<strong>${escapeHTML(currentRoom.block)}</strong> - Room ${escapeHTML(currentRoom.room_number)} (Floor ${currentRoom.floor})`;
  } else {
    chip.innerHTML = `<strong>Hostel Allocated</strong> - Contact Office`;
  }

  // Announcements snippet
  try {
    const res = await apiFetch('/api/announcements');
    const data = await res.json();
    const list = document.getElementById('overview-announcements-list');
    if (data.announcements && data.announcements.length > 0) {
      list.innerHTML = data.announcements.slice(0, 3).map(a => `
        <div style="padding: 0.55rem; background: var(--surface-secondary); border-radius: 6px; font-size: 0.82rem;">
          <div style="display:flex; justify-content:space-between; align-items:center;">
            <strong>${escapeHTML(a.title)}</strong>
            <span class="badge ${a.priority === 'High' ? 'badge-priority-high' : 'badge-priority-normal'}">${a.category}</span>
          </div>
          <p style="color:var(--text-secondary); margin-top:3px;">${escapeHTML(a.content.substring(0, 80))}...</p>
        </div>
      `).join('');
    } else {
      list.innerHTML = '<p class="empty-text">No active announcements</p>';
    }
  } catch (e) {}

  // Active tickets snippet
  try {
    const res = await apiFetch('/api/tickets');
    const data = await res.json();
    const list = document.getElementById('overview-tickets-list');
    const activeTickets = (data.tickets || []).filter(t => t.status !== 'Resolved');
    if (activeTickets.length > 0) {
      list.innerHTML = activeTickets.slice(0, 3).map(t => `
        <div style="padding: 0.55rem; background: var(--surface-secondary); border-radius: 6px; font-size: 0.82rem;">
          <div style="display:flex; justify-content:space-between; align-items:center;">
            <strong>Ticket #${t.id} - ${t.category}</strong>
            <span class="badge badge-status-${t.status.toLowerCase().replace(/\s+/g, '-')}">${t.status}</span>
          </div>
          <p style="color:var(--text-secondary); margin-top:3px;">${escapeHTML(t.description.substring(0, 70))}...</p>
        </div>
      `).join('');
    } else {
      list.innerHTML = '<p class="empty-text">No pending complaints. All clear.</p>';
    }
  } catch (e) {}
}

// -----------------------------------------------------------------
// Feature 1: Raise Complaint / Ticket (Semantics Engine)
// -----------------------------------------------------------------
formTicket.addEventListener('submit', async (e) => {
  e.preventDefault();
  const descInput = document.getElementById('ticket-desc');
  const feedback = document.getElementById('ticket-feedback');
  const btn = document.getElementById('btn-submit-ticket');

  feedback.textContent = 'Analyzing and routing issue...';
  btn.disabled = true;

  try {
    const res = await apiFetch('/api/tickets', {
      method: 'POST',
      body: JSON.stringify({ description: descInput.value })
    });
    const data = await res.json();

    if (data.success) {
      feedback.innerHTML = `
        <div style="color: var(--success); padding: 0.9rem; background: var(--success-light); border-radius: 6px; border: 1px solid var(--success);">
          <h4 style="margin-bottom:0.3rem;">Ticket #${data.ticket.id} Logged Successfully</h4>
          <p style="font-size: 0.86rem;">
            <strong>Assigned Category:</strong> ${data.ticket.category} | 
            <strong>Priority Tag:</strong> <span class="badge badge-urgent-${data.ticket.urgency.toLowerCase()}">${data.ticket.urgency}</span><br>
            <strong>Status:</strong> ${data.ticket.status} (Forwarded to maintenance staff)
          </p>
          <button class="btn btn-sm btn-primary" style="margin-top:0.6rem;" onclick="switchStudentTab('my-tickets')">View in My Tickets</button>
        </div>
      `;
      descInput.value = '';
      showToast(`Complaint #${data.ticket.id} logged under ${data.ticket.category}.`, 'success');
      loadNotifications();
    } else {
      feedback.textContent = data.message || 'Failed to submit complaint.';
      showToast(data.message || 'Error logging complaint', 'error');
    }
  } catch (err) {
    feedback.textContent = 'Error connecting to server.';
  } finally {
    btn.disabled = false;
  }
});

// -----------------------------------------------------------------
// Feature 2: My Tickets Lifecycle & Feedback (Green Ticked Completed UI)
// -----------------------------------------------------------------
async function loadStudentTickets() {
  const container = document.getElementById('student-tickets-container');
  container.innerHTML = '<p class="empty-text">Loading your tickets...</p>';

  try {
    const res = await apiFetch('/api/tickets');
    const data = await res.json();

    if (!data.tickets || data.tickets.length === 0) {
      container.innerHTML = `
        <div style="text-align: center; padding: 2rem;">
          <p style="font-size:1rem; color:var(--text-secondary);">No complaints lodged yet.</p>
          <button class="btn btn-primary btn-sm" style="margin-top: 0.8rem;" onclick="switchStudentTab('raise-ticket')">Raise Your First Ticket</button>
        </div>
      `;
      return;
    }

    container.innerHTML = data.tickets.map(t => {
      const steps = ['Open', 'Assigned', 'In Progress', 'Resolved'];
      const currentIdx = steps.indexOf(t.status);
      const isResolved = t.status === 'Resolved';

      return `
        <div class="ticket-card">
          <div class="ticket-header">
            <div>
              <span class="badge badge-urgent-${t.urgency.toLowerCase()}">${t.urgency} Priority</span>
              <span class="badge" style="background:var(--surface-secondary); margin-left:6px;">${t.category}</span>
              <h4 style="margin-top:0.4rem; font-size:1.02rem;">Ticket #${t.id}: ${escapeHTML(t.description.substring(0, 60))}${t.description.length > 60 ? '...' : ''}</h4>
              <p style="font-size:0.75rem; color:var(--text-secondary); margin-top:2px;">Submitted on ${formatIST(t.created_at)}</p>
            </div>
            <div>
              ${isResolved 
                ? `<span class="badge badge-status-resolved">&#x2713; Resolved</span>`
                : `<span class="badge badge-status-${t.status.toLowerCase().replace(/\s+/g, '-')}">${t.status}</span>`
              }
            </div>
          </div>

          <p style="font-size:0.86rem; margin: 0.4rem 0; color:var(--text-primary);">${escapeHTML(t.description)}</p>

          <!-- Visual Progress Lifecycle Stepper (Green Ticked on Resolution) -->
          <div class="ticket-tracker-wrapper">
            <div class="tracker-line status-${t.status.toLowerCase().replace(/\s+/g, '-')}"></div>
            <div class="ticket-tracker">
              ${steps.map((s, idx) => {
                const isStepCompleted = isResolved || (currentIdx > idx);
                const isStepActive = !isResolved && (currentIdx === idx);
                const stepClass = isStepCompleted ? 'completed' : (isStepActive ? 'active' : '');
                
                return `
                  <div class="tracker-step ${stepClass}">
                    <div class="step-circle">${isStepCompleted ? '&#x2713;' : (idx + 1)}</div>
                    <span>${s}</span>
                  </div>
                `;
              }).join('')}
            </div>
          </div>

          <!-- Metadata info box -->
          <div class="ticket-meta-grid">
            <div>
              <strong>Assigned Team:</strong><br>
              ${t.assigned_team ? `${t.assigned_team}${t.assigned_staff_name ? ` (${t.assigned_staff_name})` : ''}` : 'Pending assignment'}
            </div>
            <div>
              <strong>Resolution ETA:</strong><br>
              ${t.eta ? `${escapeHTML(t.eta)}` : 'Awaiting inspection'}
            </div>
            <div>
              <strong>Admin Note:</strong><br>
              ${t.admin_comment ? `${escapeHTML(t.admin_comment)}` : 'No notes added'}
            </div>
          </div>

          <!-- Feedback Section for Resolved Tickets -->
          ${isResolved ? `
            <div style="margin-top:0.8rem; padding-top:0.8rem; border-top:1px solid var(--border); display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:0.5rem;">
              <div>
                ${t.feedback_rating ? `
                  <div style="font-size:0.84rem; color:var(--success); font-weight:600;">
                    Your Evaluation: Rating ${t.feedback_rating}/5 
                    ${t.feedback_comment ? `<span style="font-weight:normal; color:var(--text-secondary); margin-left:6px;">"${escapeHTML(t.feedback_comment)}"</span>` : ''}
                  </div>
                ` : `
                  <span style="font-size:0.82rem; color:var(--text-secondary);">Repair completed. Please submit service feedback:</span>
                `}
              </div>
              <div>
                ${!t.feedback_rating ? `
                  <button class="btn btn-sm btn-secondary" onclick="openFeedbackModal(${t.id}, '${escapeHTML(t.category)}')">Rate Service</button>
                ` : ''}
              </div>
            </div>
          ` : ''}
        </div>
      `;
    }).join('');
  } catch (err) {
    container.innerHTML = '<p class="empty-text" style="color:var(--danger);">Failed to load tickets.</p>';
  }
}

// -----------------------------------------------------------------
// Student Feedback Modal
// -----------------------------------------------------------------
function openFeedbackModal(ticketId, category) {
  document.getElementById('feedback-ticket-id').value = ticketId;
  document.getElementById('feedback-ticket-info').textContent = `Evaluating service for Ticket #${ticketId} (${category})`;
  selectRating(5);
  document.getElementById('feedback-comment').value = '';
  modalFeedback.classList.remove('hidden');
}

function closeFeedbackModal() {
  modalFeedback.classList.add('hidden');
}

function selectRating(val) {
  document.getElementById('feedback-rating-val').value = val;
  const pills = document.querySelectorAll('.rating-pill');
  pills.forEach(p => {
    if (parseInt(p.getAttribute('data-val'), 10) === val) {
      p.classList.add('active');
    } else {
      p.classList.remove('active');
    }
  });
}

formFeedback.addEventListener('submit', async (e) => {
  e.preventDefault();
  const ticketId = document.getElementById('feedback-ticket-id').value;
  const rating = document.getElementById('feedback-rating-val').value;
  const comment = document.getElementById('feedback-comment').value;

  try {
    const res = await apiFetch(`/api/tickets/${ticketId}/feedback`, {
      method: 'POST',
      body: JSON.stringify({ rating, comment })
    });
    const data = await res.json();
    if (data.success) {
      showToast('Thank you for your service feedback.', 'success');
      closeFeedbackModal();
      loadStudentTickets();
    } else {
      showToast(data.message || 'Failed to submit feedback.', 'error');
    }
  } catch (err) {
    showToast('Network error submitting feedback.', 'error');
  }
});

// -----------------------------------------------------------------
// Feature 3: Lost and Found Board & Matching Engine
// -----------------------------------------------------------------
function toggleStudentLFForm() {
  formLostFound.classList.toggle('hidden');
}

formLostFound.addEventListener('submit', async (e) => {
  e.preventDefault();
  const type = document.getElementById('lf-type').value;
  const name = document.getElementById('lf-name').value;
  const location = document.getElementById('lf-location').value;
  const fileInput = document.getElementById('lf-image');

  if (!fileInput.files[0]) {
    showToast('A photograph of the item is required.', 'warning');
    return;
  }

  const formData = new FormData();
  formData.append('type', type);
  formData.append('item_name', name);
  formData.append('location', location);
  formData.append('image', fileInput.files[0]);

  try {
    const res = await apiFetch('/api/lost-found', {
      method: 'POST',
      body: formData
    });
    const data = await res.json();

    if (data.success) {
      showToast('Item report published to campus notice board.', 'success');
      formLostFound.reset();
      formLostFound.classList.add('hidden');
      loadLostFoundFeed('student');

      if (data.potentialMatches && data.potentialMatches.length > 0) {
        showToast(`Potential matching report found for "${name}". Check notifications.`, 'info');
        loadNotifications();
      }
    } else {
      showToast(data.message || 'Failed to post item notice.', 'error');
    }
  } catch (err) {
    showToast('Failed to upload notice image.', 'error');
  }
});

async function loadLostFoundFeed(targetRole) {
  const containerId = targetRole === 'admin' ? 'admin-lostfound-gallery' : 'lostfound-gallery';
  const container = document.getElementById(containerId);
  container.innerHTML = '<p class="empty-text">Loading items...</p>';

  try {
    const res = await apiFetch('/api/lost-found');
    const data = await res.json();

    if (!data.items || data.items.length === 0) {
      container.innerHTML = '<p class="empty-text">No lost or found items reported yet.</p>';
      return;
    }

    container.innerHTML = data.items.map(item => `
      <div class="item-card">
        <img src="${item.image_url}" class="item-img" alt="${escapeHTML(item.item_name)}" onerror="this.src='https://via.placeholder.com/300x150?text=No+Image'">
        <div class="item-body">
          <div style="display:flex; justify-content:space-between; align-items:center;">
            <span class="badge ${item.type === 'Lost' ? 'badge-urgent-high' : 'badge-status-resolved'}">${item.type}</span>
            <span style="font-size:0.72rem; color:var(--text-secondary);">${formatISTDate(item.created_at)}</span>
          </div>
          <h4>${escapeHTML(item.item_name)}</h4>
          <p><strong>Location:</strong> ${escapeHTML(item.location)}</p>
          <p><strong>Reported by:</strong> ${escapeHTML(item.student_email)}</p>

          <!-- Possible Match Banner -->
          ${item.possible_matches && item.possible_matches.length > 0 ? `
            <div class="match-card-alert">
              <h5>Possible Match Found</h5>
              <p>Correlates with "${escapeHTML(item.possible_matches[0].item_name)}" (${item.possible_matches[0].type}) at ${escapeHTML(item.possible_matches[0].location)}.</p>
            </div>
          ` : ''}
        </div>
      </div>
    `).join('');
  } catch (err) {
    container.innerHTML = '<p class="empty-text" style="color:var(--danger);">Error loading items feed.</p>';
  }
}

// -----------------------------------------------------------------
// Feature 4: Announcements
// -----------------------------------------------------------------
async function loadAnnouncements(view) {
  const containerId = view === 'admin' ? 'admin-announcements-list' : 'student-announcements-list';
  const container = document.getElementById(containerId);
  container.innerHTML = '<p class="empty-text">Loading announcements...</p>';

  try {
    const res = await apiFetch('/api/announcements');
    const data = await res.json();

    if (!data.announcements || data.announcements.length === 0) {
      container.innerHTML = '<p class="empty-text">No active announcements.</p>';
      return;
    }

    container.innerHTML = data.announcements.map(a => `
      <div class="announcement-card ${a.priority === 'High' ? 'priority-high' : ''}">
        <div class="announcement-header">
          <div>
            <span class="badge ${a.priority === 'High' ? 'badge-priority-high' : 'badge-priority-normal'}">${a.category}</span>
            ${a.priority === 'High' ? '<span class="badge badge-urgent-high" style="margin-left:4px;">Urgent</span>' : ''}
            <h4 style="margin-top:0.3rem; font-size:1.02rem;">${escapeHTML(a.title)}</h4>
            <p style="font-size:0.75rem; color:var(--text-secondary);">Issued by ${escapeHTML(a.created_by)} on ${formatIST(a.created_at)}</p>
          </div>
          ${view === 'admin' ? `
            <div class="btn-group">
              <button class="btn btn-sm btn-outline" onclick="editAnnouncement(${a.id}, '${escapeHTML(a.title).replace(/'/g, "\\'")}', '${escapeHTML(a.content).replace(/'/g, "\\'")}', '${a.category}', '${a.priority}')">Edit</button>
              <button class="btn btn-sm btn-danger" onclick="deleteAnnouncement(${a.id})">Delete</button>
            </div>
          ` : ''}
        </div>
        <p style="font-size:0.86rem; margin-top:0.5rem; line-height:1.5;">${escapeHTML(a.content)}</p>
      </div>
    `).join('');
  } catch (err) {
    container.innerHTML = '<p class="empty-text">Error loading announcements.</p>';
  }
}

function openAnnouncementModal() {
  document.getElementById('ann-edit-id').value = '';
  document.getElementById('modal-announcement-title').textContent = 'Publish Announcement';
  document.getElementById('ann-title').value = '';
  document.getElementById('ann-content').value = '';
  document.getElementById('ann-category').value = 'General';
  document.getElementById('ann-priority').value = 'Normal';
  modalAnnouncement.classList.remove('hidden');
}

function closeAnnouncementModal() {
  modalAnnouncement.classList.add('hidden');
}

function editAnnouncement(id, title, content, category, priority) {
  document.getElementById('ann-edit-id').value = id;
  document.getElementById('modal-announcement-title').textContent = 'Edit Announcement';
  document.getElementById('ann-title').value = title;
  document.getElementById('ann-content').value = content;
  document.getElementById('ann-category').value = category;
  document.getElementById('ann-priority').value = priority;
  modalAnnouncement.classList.remove('hidden');
}

formAnnouncement.addEventListener('submit', async (e) => {
  e.preventDefault();
  const id = document.getElementById('ann-edit-id').value;
  const title = document.getElementById('ann-title').value;
  const content = document.getElementById('ann-content').value;
  const category = document.getElementById('ann-category').value;
  const priority = document.getElementById('ann-priority').value;

  const url = id ? `/api/announcements/${id}` : '/api/announcements';
  const method = id ? 'PUT' : 'POST';

  try {
    const res = await apiFetch(url, {
      method,
      body: JSON.stringify({ title, content, category, priority })
    });
    const data = await res.json();
    if (data.success) {
      showToast(id ? 'Announcement updated.' : 'Announcement published.', 'success');
      closeAnnouncementModal();
      loadAnnouncements('admin');
    } else {
      showToast(data.message || 'Failed to save announcement.', 'error');
    }
  } catch (err) {
    showToast('Error saving announcement.', 'error');
  }
});

async function deleteAnnouncement(id) {
  if (!confirm('Are you sure you want to delete this notice?')) return;
  try {
    const res = await apiFetch(`/api/announcements/${id}`, { method: 'DELETE' });
    const data = await res.json();
    if (data.success) {
      showToast('Announcement deleted.', 'info');
      loadAnnouncements('admin');
    }
  } catch (err) {
    showToast('Failed to delete announcement.', 'error');
  }
}

// -------------------------------------------------------------
// Feature 5: Hostel & Room Information
// -------------------------------------------------------------
async function loadStudentRoomInfo() {
  const container = document.getElementById('student-room-details');
  container.innerHTML = '<p class="empty-text">Loading room details...</p>';

  try {
    const res = await apiFetch('/api/student/room-info');
    const data = await res.json();

    if (!data.success || !data.room) {
      container.innerHTML = '<p class="empty-text">No hostel allocation record found.</p>';
      return;
    }

    const r = data.room;
    container.innerHTML = `
      <div class="room-stat-tile">
        <label>Block &amp; Floor</label>
        <div class="tile-value">${escapeHTML(r.block)} - Floor ${r.floor}</div>
      </div>
      <div class="room-stat-tile">
        <label>Allocated Room No.</label>
        <div class="tile-value">Room ${escapeHTML(r.room_number)}</div>
      </div>
      <div class="room-stat-tile">
        <label>Occupancy &amp; Bed</label>
        <div class="tile-value">${escapeHTML(r.room_type)} (${escapeHTML(r.bed_number)})</div>
      </div>
      <div class="room-stat-tile">
        <label>Hostel Warden</label>
        <div class="tile-value">${escapeHTML(r.warden_name)}</div>
        <p style="font-size:0.75rem; color:var(--text-secondary); margin-top:3px;">Tel: ${escapeHTML(r.warden_contact)}</p>
      </div>
      <div class="room-stat-tile" style="grid-column: 1 / -1;">
        <label>Room Amenities &amp; Inventory</label>
        <div class="tile-value" style="font-size:0.92rem; font-weight:normal;">${escapeHTML(r.amenities)}</div>
      </div>
    `;
  } catch (err) {
    container.innerHTML = '<p class="empty-text">Error fetching room allocation.</p>';
  }
}

// -------------------------------------------------------------
// Feature 6: Emergency SOS Station
// -------------------------------------------------------------
async function triggerSOS() {
  const confirmed = confirm("EMERGENCY CONFIRMATION:\nAre you sure you want to trigger an Emergency SOS Alert? Security and warden staff will be dispatched to your location.");
  if (!confirmed) return;

  const btn = document.getElementById('sos-trigger-btn');
  btn.textContent = "Acquiring Coordinates...";
  btn.disabled = true;

  if ("geolocation" in navigator) {
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        await postSOSAlert(pos.coords.latitude, pos.coords.longitude);
      },
      async () => {
        showToast("GPS coordinates unavailable. Sending alert with phone and email.", "warning");
        await postSOSAlert(null, null);
      },
      { timeout: 10000, enableHighAccuracy: true }
    );
  } else {
    await postSOSAlert(null, null);
  }
}

async function postSOSAlert(latitude, longitude) {
  const btn = document.getElementById('sos-trigger-btn');
  try {
    const res = await apiFetch('/api/sos', {
      method: 'POST',
      body: JSON.stringify({ latitude, longitude })
    });
    const data = await res.json();
    if (data.success) {
      showToast('EMERGENCY SOS BROADCASTED. Security team notified.', 'error');
      loadStudentSOSHistory();
      loadNotifications();
    } else {
      showToast(data.message || 'Failed to dispatch SOS alert.', 'error');
    }
  } catch (err) {
    showToast('Network error triggering SOS.', 'error');
  } finally {
    btn.textContent = "SEND EMERGENCY SOS ALERT";
    btn.disabled = false;
  }
}

async function loadStudentSOSHistory() {
  const container = document.getElementById('student-sos-history');
  try {
    const res = await apiFetch('/api/sos');
    const data = await res.json();

    if (!data.alerts || data.alerts.length === 0) {
      container.innerHTML = '<p class="empty-text">No active emergency signals logged.</p>';
      return;
    }

    container.innerHTML = `
      <table>
        <thead>
          <tr>
            <th>Timestamp (IST)</th>
            <th>Location</th>
            <th>Status</th>
            <th>Security Action Note</th>
          </tr>
        </thead>
        <tbody>
          ${data.alerts.map(a => `
            <tr>
              <td>${formatIST(a.created_at)}</td>
              <td>${a.latitude ? `Coords: ${a.latitude.toFixed(4)}, ${a.longitude.toFixed(4)}` : 'Coordinates unavailable'}</td>
              <td><span class="badge ${a.status === 'Active' ? 'badge-urgent-high' : 'badge-status-resolved'}">${a.status}</span></td>
              <td>${escapeHTML(a.security_note || a.admin_comment || 'Awaiting response team')}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    `;
  } catch (e) {
    container.innerHTML = '<p class="empty-text">Error loading SOS history.</p>';
  }
}

// -------------------------------------------------------------
// Feature 7: Notifications Engine (Student & Admin)
// -------------------------------------------------------------
function startNotificationPolling() {
  loadNotifications();
  if (notifPollInterval) clearInterval(notifPollInterval);
  notifPollInterval = setInterval(loadNotifications, 15000); // 15s poll
}

async function loadNotifications() {
  if (!currentToken) return;
  try {
    const res = await apiFetch('/api/notifications');
    const data = await res.json();

    if (data.success) {
      const count = data.unreadCount || 0;
      if (count > 0) {
        notifBadge.textContent = count;
        notifBadge.classList.remove('hidden');

        // If admin and new notifications arrived, display live alert
        if (currentRole === 'admin' && count > lastKnownNotifCount) {
          const latest = data.notifications[0];
          if (latest) {
            showToast(`Notification: ${latest.title}`, latest.type === 'sos' ? 'error' : 'info');
          }
        }
      } else {
        notifBadge.classList.add('hidden');
      }
      lastKnownNotifCount = count;

      if (data.notifications && data.notifications.length > 0) {
        notifList.innerHTML = data.notifications.map(n => `
          <div class="notif-item ${n.is_read ? '' : 'unread'}" onclick="markNotificationRead(${n.id})">
            <h5>${escapeHTML(n.title)}</h5>
            <p>${escapeHTML(n.message)}</p>
            <div class="notif-time">${formatISTTime(n.created_at)}</div>
          </div>
        `).join('');
      } else {
        notifList.innerHTML = '<p class="empty-text">No notifications</p>';
      }
    }
  } catch (e) {}
}

document.getElementById('btn-notif-toggle').addEventListener('click', (e) => {
  e.stopPropagation();
  notifDropdown.classList.toggle('hidden');
});

document.addEventListener('click', () => {
  if (!notifDropdown.classList.contains('hidden')) {
    notifDropdown.classList.add('hidden');
  }
});

notifDropdown.addEventListener('click', (e) => e.stopPropagation());

async function markNotificationRead(id) {
  try {
    await apiFetch(`/api/notifications/${id}/read`, { method: 'PATCH' });
    loadNotifications();
  } catch (e) {}
}

document.getElementById('btn-mark-all-read').addEventListener('click', async () => {
  try {
    await apiFetch('/api/notifications/read-all', { method: 'PATCH' });
    loadNotifications();
  } catch (e) {}
});

// -------------------------------------------------------------
// ADMIN DASHBOARD MODULES
// -------------------------------------------------------------
function switchAdminTab(tabName) {
  const tabs = document.querySelectorAll('#view-admin .nav-tab');
  const panels = document.querySelectorAll('#view-admin .tab-panel');

  tabs.forEach(t => t.classList.remove('active'));
  panels.forEach(p => p.classList.remove('active'));

  const activePanel = document.getElementById(`admin-tab-${tabName}`);
  if (activePanel) activePanel.classList.add('active');

  const btn = Array.from(tabs).find(t => t.getAttribute('onclick')?.includes(tabName));
  if (btn) btn.classList.add('active');

  if (tabName === 'stats') loadAdminStats();
  if (tabName === 'tickets') loadAdminTickets();
  if (tabName === 'sos') loadAdminSOS();
  if (tabName === 'announcements') loadAnnouncements('admin');
  if (tabName === 'lost-found') loadLostFoundFeed('admin');
  if (tabName === 'feedback') loadAdminFeedback();
}

async function loadStaffList() {
  try {
    const res = await apiFetch('/api/staff');
    const data = await res.json();
    if (data.success) {
      staffList = data.staff || [];
    }
  } catch (e) {}
}

// -------------------------------------------------------------
// Admin Statistics Calculation View
// -------------------------------------------------------------
async function loadAdminStats() {
  try {
    const res = await apiFetch('/api/admin/stats');
    const data = await res.json();
    if (!data.success) return;

    const s = data.stats;
    document.getElementById('stat-total-tickets').textContent = s.totalTickets;
    document.getElementById('stat-open-tickets').textContent = s.openTickets;
    document.getElementById('stat-assigned-tickets').textContent = s.assignedTickets;
    document.getElementById('stat-progress-tickets').textContent = s.inProgressTickets;
    document.getElementById('stat-resolved-tickets').textContent = s.resolvedTickets;
    document.getElementById('stat-high-tickets').textContent = s.highPriorityTickets;
    document.getElementById('stat-active-sos').textContent = s.activeSOS;
    document.getElementById('stat-resolved-today').textContent = s.resolvedToday;
    document.getElementById('stat-resolved-week').textContent = s.resolvedThisWeek;
    document.getElementById('stat-avg-resolution').textContent = s.avgResolutionHours !== null ? `${s.avgResolutionHours} hrs` : 'N/A';

    // Show/hide live alert banner if active SOS
    const banner = document.getElementById('admin-live-banner');
    if (s.activeSOS > 0) {
      banner.classList.remove('hidden');
      document.getElementById('admin-live-banner-text').textContent = `Attention: ${s.activeSOS} active emergency SOS signal(s) require security response.`;
    } else {
      banner.classList.add('hidden');
    }

    // Category Breakdown
    const catList = document.getElementById('stats-category-breakdown');
    catList.innerHTML = (s.ticketsByCategory || []).map(c => `
      <div class="stat-breakdown-row">
        <span><strong>${c.category}</strong></span>
        <span>${c.count} complaints</span>
      </div>
    `).join('') || '<p class="empty-text">No category data</p>';

    // Urgency Breakdown
    const urgList = document.getElementById('stats-urgency-breakdown');
    urgList.innerHTML = (s.ticketsByUrgency || []).map(u => `
      <div class="stat-breakdown-row">
        <span><span class="badge badge-urgent-${u.urgency.toLowerCase()}">${u.urgency}</span> Priority</span>
        <span>${u.count} tickets</span>
      </div>
    `).join('') || '<p class="empty-text">No urgency data</p>';
  } catch (e) {}
}

// -------------------------------------------------------------
// Admin Ticket Management (Search, Filter, Assign, Status)
// -------------------------------------------------------------
function debounceTicketSearch() {
  clearTimeout(searchTimeout);
  searchTimeout = setTimeout(loadAdminTickets, 300);
}

async function loadAdminTickets() {
  const container = document.getElementById('admin-tickets-container');
  container.innerHTML = '<p class="empty-text">Loading complaints...</p>';

  const search = document.getElementById('admin-ticket-search').value;
  const category = document.getElementById('filter-category').value;
  const urgency = document.getElementById('filter-urgency').value;
  const status = document.getElementById('filter-status').value;
  const team = document.getElementById('filter-team').value;
  const sortVal = document.getElementById('filter-sort').value;

  let sortBy = 'date';
  let sortOrder = 'DESC';
  if (sortVal === 'date-asc') { sortBy = 'date'; sortOrder = 'ASC'; }
  if (sortVal === 'urgency-desc') { sortBy = 'urgency'; sortOrder = 'ASC'; }

  const queryParams = new URLSearchParams({
    search, category, urgency, status, team, sortBy, sortOrder
  });

  try {
    const res = await apiFetch(`/api/tickets?${queryParams.toString()}`);
    const data = await res.json();

    if (!data.tickets || data.tickets.length === 0) {
      container.innerHTML = '<p class="empty-text">No matching tickets found.</p>';
      return;
    }

    container.innerHTML = `
      <table>
        <thead>
          <tr>
            <th>ID</th>
            <th>Student Contact</th>
            <th>Category &amp; Urgency</th>
            <th>Description</th>
            <th>Status</th>
            <th>Technician Assignment</th>
            <th>Action, ETA &amp; Notes</th>
          </tr>
        </thead>
        <tbody>
          ${data.tickets.map(t => {
            const isResolved = t.status === 'Resolved';
            return `
              <tr>
                <td><strong>#${t.id}</strong></td>
                <td>
                  <strong>${escapeHTML(t.student_email)}</strong><br>
                  <span class="contact-pill">Tel: ${t.student_contact || 'N/A'}</span>
                </td>
                <td>
                  <strong>${t.category}</strong><br>
                  <span class="badge badge-urgent-${t.urgency.toLowerCase()}">${t.urgency}</span>
                </td>
                <td style="max-width:220px; word-wrap:break-word;">
                  ${escapeHTML(t.description)}
                  <div style="font-size:0.72rem; color:var(--text-secondary); margin-top:4px;">${formatIST(t.created_at)}</div>
                </td>
                <td>
                  ${isResolved 
                    ? `<span class="badge badge-status-resolved">&#x2713; Resolved</span>`
                    : `<span class="badge badge-status-${t.status.toLowerCase().replace(/\s+/g, '-')}">${t.status}</span>`
                  }
                </td>
                <td style="min-width:180px;">
                  <select id="ticket-staff-${t.id}" class="table-input" style="margin-bottom:4px;">
                    <option value="">-- Assign Staff --</option>
                    ${staffList.map(s => `
                      <option value="${s.id}" data-team="${s.team}" ${t.assigned_staff_id === s.id ? 'selected' : ''}>
                        ${s.name} (${s.team})
                      </option>
                    `).join('')}
                  </select>
                  <input type="text" id="ticket-eta-${t.id}" class="table-input" placeholder="ETA (e.g. 2 hrs / 4:00 PM)" value="${t.eta ? escapeHTML(t.eta) : ''}" />
                </td>
                <td style="min-width:210px;">
                  <div class="action-comment-box">
                    <input type="text" id="ticket-comment-${t.id}" class="table-input" placeholder="Action update note..." value="${t.admin_comment ? escapeHTML(t.admin_comment) : ''}" />
                    <div class="btn-group">
                      ${t.status === 'Open' ? `
                        <button class="btn btn-sm btn-outline" onclick="adminUpdateTicket(${t.id}, 'Assigned')">Assign</button>
                      ` : ''}
                      ${t.status !== 'In Progress' && !isResolved ? `
                        <button class="btn btn-sm btn-warning" onclick="adminUpdateTicket(${t.id}, 'In Progress')">In Progress</button>
                      ` : ''}
                      ${!isResolved ? `
                        <button class="btn btn-sm btn-primary" onclick="adminUpdateTicket(${t.id}, 'Resolved')">Mark Resolved</button>
                      ` : `
                        <span style="color:var(--success); font-size:0.8rem; font-weight:700;">&#x2713; Completed</span>
                      `}
                    </div>
                  </div>
                </td>
              </tr>
            `;
          }).join('')}
        </tbody>
      </table>
    `;
  } catch (err) {
    container.innerHTML = '<p class="empty-text">Error fetching tickets.</p>';
  }
}

async function adminUpdateTicket(id, targetStatus) {
  const staffSelect = document.getElementById(`ticket-staff-${id}`);
  const etaInput = document.getElementById(`ticket-eta-${id}`);
  const commentInput = document.getElementById(`ticket-comment-${id}`);

  const assigned_staff_id = staffSelect && staffSelect.value ? parseInt(staffSelect.value, 10) : null;
  let assigned_team = null;
  if (assigned_staff_id && staffSelect.selectedOptions[0]) {
    assigned_team = staffSelect.selectedOptions[0].getAttribute('data-team');
  }

  const eta = etaInput ? etaInput.value.trim() : null;
  const admin_comment = commentInput ? commentInput.value.trim() : null;

  try {
    const res = await apiFetch(`/api/tickets/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({
        status: targetStatus,
        assigned_staff_id,
        assigned_team,
        eta,
        admin_comment
      })
    });
    const data = await res.json();
    if (data.success) {
      showToast(`Ticket #${id} marked as ${targetStatus}.`, 'success');
      loadAdminTickets();
      loadAdminStats();
    } else {
      showToast(data.message || 'Failed to update ticket.', 'error');
    }
  } catch (err) {
    showToast('Network error updating ticket.', 'error');
  }
}

// -------------------------------------------------------------
// Admin SOS Incident Command Center (Lifecycle Flow)
// -------------------------------------------------------------
async function loadAdminSOS() {
  const container = document.getElementById('admin-sos-list');
  container.innerHTML = '<p class="empty-text">Loading SOS alerts...</p>';

  try {
    const res = await apiFetch('/api/sos');
    const data = await res.json();

    if (!data.alerts || data.alerts.length === 0) {
      container.innerHTML = '<p class="empty-text">No active emergency signals logged.</p>';
      return;
    }

    container.innerHTML = `
      <table>
        <thead>
          <tr>
            <th>Time (IST) &amp; Elapsed</th>
            <th>Student Contact</th>
            <th>GPS Location</th>
            <th>Current Stage</th>
            <th>Security Response Note</th>
            <th>Lifecycle Action</th>
          </tr>
        </thead>
        <tbody>
          ${data.alerts.map(a => `
            <tr style="${a.status === 'Active' ? 'background: var(--danger-light);' : ''}">
              <td>
                <strong>${formatIST(a.created_at)}</strong><br>
                <span style="font-size:0.75rem; color:var(--text-secondary);">${timeAgo(a.created_at)}</span>
              </td>
              <td>
                <strong>${escapeHTML(a.student_email)}</strong><br>
                <span class="contact-pill">Tel: ${a.student_contact || 'N/A'}</span>
              </td>
              <td>
                ${a.latitude && a.longitude ? `
                  <a href="https://www.google.com/maps?q=${a.latitude},${a.longitude}" target="_blank" style="color:var(--primary); font-weight:700;">
                    Map Location (${a.latitude.toFixed(4)}, ${a.longitude.toFixed(4)})
                  </a>
                ` : '<span style="color:var(--text-secondary);">GPS unavailable</span>'}
              </td>
              <td>
                <span class="badge ${a.status === 'Active' ? 'badge-urgent-high' : (a.status === 'Resolved' ? 'badge-status-resolved' : 'badge-status-assigned')}">${a.status}</span>
              </td>
              <td style="min-width:180px;">
                <input type="text" id="sos-note-${a.id}" class="table-input" placeholder="Security action note..." value="${a.security_note ? escapeHTML(a.security_note) : ''}" />
              </td>
              <td>
                <div class="btn-group">
                  ${a.status === 'Active' ? `
                    <button class="btn btn-sm btn-outline" onclick="adminAdvanceSOS(${a.id}, 'Acknowledged')">Acknowledge</button>
                  ` : ''}
                  ${a.status === 'Active' || a.status === 'Acknowledged' ? `
                    <button class="btn btn-sm btn-warning" onclick="adminAdvanceSOS(${a.id}, 'Security Dispatched')">Dispatch</button>
                  ` : ''}
                  ${a.status !== 'Resolved' ? `
                    <button class="btn btn-sm btn-primary" onclick="adminAdvanceSOS(${a.id}, 'Resolved')">Resolve</button>
                  ` : `
                    <span style="color:var(--success); font-size:0.8rem; font-weight:700;">&#x2713; Resolved</span>
                  `}
                </div>
              </td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    `;
  } catch (err) {
    container.innerHTML = '<p class="empty-text">Error loading emergency signals.</p>';
  }
}

async function adminAdvanceSOS(id, nextStage) {
  const noteInput = document.getElementById(`sos-note-${id}`);
  const security_note = noteInput ? noteInput.value.trim() : '';

  try {
    const res = await apiFetch(`/api/sos/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({ status: nextStage, security_note })
    });
    const data = await res.json();
    if (data.success) {
      showToast(`Emergency alert #${id} status updated to ${nextStage}.`, 'info');
      loadAdminSOS();
      loadAdminStats();
    }
  } catch (err) {
    showToast('Failed to advance SOS status.', 'error');
  }
}

// -------------------------------------------------------------
// Admin Feedback Console
// -------------------------------------------------------------
async function loadAdminFeedback() {
  const container = document.getElementById('admin-feedback-container');
  container.innerHTML = '<p class="empty-text">Loading feedback reviews...</p>';

  try {
    const res = await apiFetch('/api/feedback');
    const data = await res.json();

    if (!data.feedback || data.feedback.length === 0) {
      container.innerHTML = '<p class="empty-text">No student reviews recorded yet.</p>';
      return;
    }

    container.innerHTML = `
      <table>
        <thead>
          <tr>
            <th>Ticket Ref</th>
            <th>Student Email</th>
            <th>Rating</th>
            <th>Evaluation Comments</th>
            <th>Category &amp; Technician</th>
            <th>Date (IST)</th>
          </tr>
        </thead>
        <tbody>
          ${data.feedback.map(f => `
            <tr>
              <td><strong>#${f.ticket_id}</strong></td>
              <td>${escapeHTML(f.student_email)}</td>
              <td style="font-weight:700; white-space:nowrap;">
                Rating ${f.rating} / 5
              </td>
              <td style="max-width:250px;">${escapeHTML(f.comment || 'No written comment')}</td>
              <td>
                <strong>${f.category}</strong><br>
                <span style="font-size:0.75rem; color:var(--text-secondary);">${f.staff_name ? `Repaired by ${f.staff_name}` : 'Unassigned'}</span>
              </td>
              <td>${formatISTDate(f.created_at)}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    `;
  } catch (err) {
    container.innerHTML = '<p class="empty-text">Error loading feedback.</p>';
  }
}

// -----------------------------------------------------------------
// HTML Sanitization
// -----------------------------------------------------------------
function escapeHTML(str) {
  if (!str) return '';
  return String(str).replace(/[&<>'"]/g, 
    tag => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[tag] || tag)
  );
}
