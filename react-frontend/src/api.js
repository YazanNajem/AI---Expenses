async function request(url, opts = {}) {
  const { headers: extraHeaders, ...restOpts } = opts;
  const r = await fetch(url, {
    headers: { 'Content-Type': 'application/json', ...extraHeaders },
    credentials: 'include',
    mode: 'cors',
    ...restOpts,
  });
  return r.json();
}

export function fetchTutoringData(month) {
  const url = month ? `/api/tutoring/data?month=${month}` : '/api/tutoring/data';
  return request(url);
}

export function fetchDashboardStats() {
  return request('/api/dashboard-stats');
}

export function addSession(data) {
  return fetch('/tutoring/add', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    credentials: 'include',
    mode: 'cors',
    body: new URLSearchParams(data)
  }).then(async r => {
    if (!r.ok) { const text = await r.text(); throw new Error(r.status === 405 ? 'Backend route not found (405)' : `HTTP ${r.status}`); }
    return r.json();
  });
}

export function editSession(sessionId, data) {
  return request('/api/tutoring/sessions/' + sessionId + '/edit', {
    method: 'POST', body: JSON.stringify(data)
  });
}

export function deleteSession(sessionId) {
  return request('/api/tutoring/sessions/' + sessionId + '/delete', {
    method: 'POST'
  });
}

export function addStudent(data) {
  return fetch('/tutoring/add-student', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    credentials: 'include',
    mode: 'cors',
    body: new URLSearchParams(data)
  }).then(r => r.json());
}

export function editStudent(studentId, data) {
  return request('/api/students/' + studentId + '/edit', {
    method: 'POST', body: JSON.stringify(data)
  });
}

export function deleteStudent(studentId) {
  return request('/api/tutoring/students/' + studentId + '/delete', {
    method: 'POST'
  });
}

export function archiveStudent(studentId, archive = true) {
  return request('/api/students/' + studentId + '/archive', {
    method: 'POST', body: JSON.stringify({ archive })
  });
}

export function fetchStudentData(studentId) {
  return request('/api/students/' + studentId + '/data');
}

export function fetchStudentSessions(studentId) {
  return request('/api/students/' + studentId + '/sessions');
}

export function fetchAnalytics() {
  return request('/api/analytics');
}

export function exportTutoring() {
  return request('/api/export/tutoring');
}
