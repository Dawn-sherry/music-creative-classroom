const socket = io();
const entryView = document.querySelector('#entry-view');
const classView = document.querySelector('#class-view');
const entryError = document.querySelector('#entry-error');
const studentForm = document.querySelector('#student-form');
const teacherForm = document.querySelector('#teacher-form');
const tabs = [...document.querySelectorAll('.role-tab')];
let identity = null;
let roomState = null;
let toastTimer;

function getParticipantId() {
  let id = localStorage.getItem('music-classroom-participant');
  if (!id) {
    id = crypto.randomUUID();
    localStorage.setItem('music-classroom-participant', id);
  }
  return id;
}

function showToast(message) {
  const toast = document.querySelector('#toast');
  toast.textContent = message;
  toast.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove('show'), 2400);
}

function showEntry(message = '') {
  identity = null;
  roomState = null;
  entryView.classList.remove('hidden');
  classView.classList.add('hidden');
  entryError.textContent = message;
}

function setBusy(form, busy) {
  const button = form.querySelector('button[type="submit"]');
  if (!button) return;
  button.disabled = busy;
  button.style.opacity = busy ? '.68' : '';
}

function openClass(data, identityData) {
  identity = identityData;
  roomState = data;
  entryView.classList.add('hidden');
  classView.classList.remove('hidden');
  entryError.textContent = '';
  document.querySelector('#class-title-display').textContent = data.title;
  document.querySelector('#class-code-display').textContent = data.code;
  document.querySelector('#teacher-line').textContent = `授课老师：${data.teacherName}  ·  当前身份：${identity.role === 'teacher' ? '老师' : identity.name}`;
  document.querySelector('#assignment-form').classList.toggle('hidden', identity.role !== 'teacher');
  document.querySelector('#hand-button').classList.toggle('hidden', identity.role !== 'student');
  document.querySelector('#people-subtitle-label').textContent = identity.role === 'teacher' ? '举手的同学' : '举手队列';
  renderRoom(data);
  if (identity.role === 'teacher') showToast('课堂已创建，把班级码分享给同学吧。');
}

function addText(parent, tag, text, className) {
  const element = document.createElement(tag);
  element.textContent = text;
  if (className) element.className = className;
  parent.append(element);
  return element;
}

function renderPeople(data) {
  const students = data.participants.filter((person) => person.role === 'student');
  document.querySelector('#online-count').textContent = String(data.onlineCount);
  document.querySelector('#participant-count').textContent = String(students.length);
  const handCount = document.querySelector('#hand-count');
  handCount.textContent = String(data.hands.length);
  const participantList = document.querySelector('#participant-list');
  participantList.replaceChildren();
  if (!students.length) addText(participantList, 'div', '等待同学加入…', 'quiet-state');
  for (const person of students) {
    const row = document.createElement('div');
    row.className = 'person-row';
    const name = document.createElement('span');
    name.className = 'person-name';
    addText(name, 'span', person.name.slice(0, 1), 'person-avatar');
    addText(name, 'span', person.name);
    row.append(name);
    if (data.hands.includes(person.name)) addText(row, 'span', '✋', 'raised-mark');
    participantList.append(row);
  }
  const handList = document.querySelector('#hand-list');
  handList.replaceChildren();
  if (!data.hands.length) addText(handList, 'div', '还没有同学举手', 'quiet-state');
  for (const name of data.hands) {
    const row = document.createElement('div');
    row.className = 'person-row hand-row';
    const nameBox = document.createElement('span');
    nameBox.className = 'person-name';
    addText(nameBox, 'span', name.slice(0, 1), 'person-avatar');
    addText(nameBox, 'span', name);
    row.append(nameBox);
    addText(row, 'span', '✋', 'raised-mark');
    handList.append(row);
  }
  const raised = identity && data.hands.includes(identity.name);
  document.querySelector('#hand-button').classList.toggle('is-raised', raised);
  document.querySelector('#hand-button-label').textContent = raised ? '放下手' : '举手发言';
}

function renderAssignments(data) {
  const list = document.querySelector('#assignment-list');
  list.replaceChildren();
  document.querySelector('#task-count').textContent = `${data.assignments.length} 个任务`;
  if (!data.assignments.length) {
    const empty = document.createElement('div');
    empty.className = 'empty-state';
    addText(empty, 'span', '♫', 'empty-note');
    addText(empty, 'strong', identity.role === 'teacher' ? '发布一个创作挑战' : '课堂还没有任务');
    addText(empty, 'p', identity.role === 'teacher' ? '写下一道开放式音乐题，邀请大家一起创作。' : '等老师发布第一个创作挑战吧。');
    list.append(empty);
    return;
  }
  for (const assignment of data.assignments) {
    const card = document.createElement('article');
    card.className = 'assignment-card';
    const meta = document.createElement('div');
    meta.className = 'assignment-meta';
    addText(meta, 'span', '✳ 创作挑战', 'task-label');
    addText(meta, 'span', new Date(assignment.createdAt).toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric' }));
    card.append(meta);
    addText(card, 'h3', assignment.title);
    addText(card, 'p', assignment.description);
    const submissions = data.submissions.filter((item) => item.assignmentId === assignment.id);
    if (identity.role === 'student') {
      const previous = submissions.find((item) => item.studentId === identity.participantId);
      const form = document.createElement('form');
      form.className = 'submission-form';
      const textarea = document.createElement('textarea');
      textarea.maxLength = 1000;
      textarea.placeholder = '写下你的旋律、节奏或创作想法…';
      textarea.required = true;
      if (previous) textarea.value = previous.content;
      form.append(textarea);
      const submitButton = document.createElement('button');
      submitButton.type = 'submit';
      submitButton.textContent = previous ? '更新我的作品' : '提交作品 ↗';
      form.append(submitButton);
      form.addEventListener('submit', (event) => {
        event.preventDefault();
        socket.emit('submission:create', { assignmentId: assignment.id, content: textarea.value }, (result) => {
          if (result?.ok) showToast('作品已提交，继续打磨也可以更新哦。');
          else showToast(result?.error || '提交失败，请再试一次。');
        });
      });
      card.append(form);
    }
    const subMeta = document.createElement('div');
    subMeta.className = 'submission-count';
    subMeta.textContent = `${submissions.length} 份作品`;
    subMeta.style.marginTop = '10px';
    card.append(subMeta);
    if (identity.role === 'teacher') {
      for (const submission of submissions) {
        const item = document.createElement('div');
        item.className = 'submission-item';
        addText(item, 'strong', submission.studentName);
        addText(item, 'p', submission.content);
        card.append(item);
      }
    }
    list.append(card);
  }
}

function renderRoom(data) {
  if (!identity) return;
  roomState = data;
  renderPeople(data);
  renderAssignments(data);
}

function joinClass(payload, teacher = false) {
  const form = teacher ? teacherForm : studentForm;
  entryError.textContent = '';
  setBusy(form, true);
  const complete = () => setBusy(form, false);
  if (!socket.connected) {
    socket.once('connect', () => joinClass(payload, teacher));
    setTimeout(() => {
      if (!socket.connected && !identity) {
        complete();
        entryError.textContent = '课堂连接失败，请检查网络后重试。';
      }
    }, 6000);
    return;
  }
  socket.emit('classroom:join', payload, (result) => {
    complete();
    if (!result?.ok) {
      localStorage.removeItem('music-classroom-session');
      entryError.textContent = result?.error || '暂时无法进入课堂。';
      return;
    }
    const nextIdentity = { code: payload.code.toUpperCase(), participantId: payload.participantId, name: payload.name, role: result.role, teacherToken: payload.teacherToken };
    localStorage.setItem('music-classroom-session', JSON.stringify(nextIdentity));
    openClass(result.room, nextIdentity);
  });
}

socket.on('connect', () => {
  const saved = localStorage.getItem('music-classroom-session');
  if (!saved || identity) return;
  try {
    const previous = JSON.parse(saved);
    joinClass({ code: previous.code, name: previous.name, participantId: previous.participantId, teacherToken: previous.teacherToken });
  } catch {
    localStorage.removeItem('music-classroom-session');
  }
});

socket.on('connect_error', () => {
  if (!identity) entryError.textContent = '暂时无法连接课堂服务，请稍后重试。';
});
socket.on('classroom:update', renderRoom);

tabs.forEach((tab) => tab.addEventListener('click', () => {
  for (const item of tabs) {
    const active = item === tab;
    item.classList.toggle('active', active);
    item.setAttribute('aria-selected', String(active));
  }
  studentForm.classList.toggle('hidden', tab.dataset.role !== 'student');
  teacherForm.classList.toggle('hidden', tab.dataset.role !== 'teacher');
  entryError.textContent = '';
}));

teacherForm.addEventListener('submit', (event) => {
  event.preventDefault();
  const name = document.querySelector('#teacher-name').value.trim();
  const title = document.querySelector('#class-title').value.trim();
  setBusy(teacherForm, true);
  const create = () => socket.emit('classroom:create', { name, title, participantId: getParticipantId() }, (result) => {
    setBusy(teacherForm, false);
    if (!result?.ok) {
      entryError.textContent = result?.error || '创建课堂失败，请再试一次。';
      return;
    }
    const teacherIdentity = { code: result.room.code, participantId: getParticipantId(), name, role: 'teacher', teacherToken: result.teacherToken };
    localStorage.setItem('music-classroom-session', JSON.stringify(teacherIdentity));
    openClass(result.room, teacherIdentity);
  });
  if (!socket.connected) socket.once('connect', create); else create();
});

studentForm.addEventListener('submit', (event) => {
  event.preventDefault();
  const code = document.querySelector('#join-code').value.trim().toUpperCase();
  const name = document.querySelector('#student-name').value.trim();
  joinClass({ code, name, participantId: getParticipantId() });
});

document.querySelector('#assignment-form').addEventListener('submit', (event) => {
  event.preventDefault();
  const title = document.querySelector('#assignment-title').value.trim();
  const description = document.querySelector('#assignment-description').value.trim();
  socket.emit('assignment:create', { title, description }, (result) => {
    if (result?.ok) {
      event.target.reset();
      showToast('创作任务已发布，等大家交来灵感吧。');
    } else showToast(result?.error || '发布失败，请再试一次。');
  });
});

document.querySelector('#hand-button').addEventListener('click', () => {
  socket.emit('hand:toggle', {}, (result) => {
    if (!result?.ok) showToast(result?.error || '暂时无法举手。');
  });
});

function sendChat(message) {
  const text = message.trim();
  if (!text) return;
  const messages = document.querySelector('#chat-messages');
  addText(messages, 'div', text, 'chat-bubble user-bubble');
  const loading = addText(messages, 'div', '灵感小芽正在想一想…', 'chat-bubble bot-bubble');
  messages.scrollTop = messages.scrollHeight;
  socket.emit('assistant:ask', { message: text }, (result) => {
    loading.remove();
    addText(messages, 'div', result?.reply || '换个说法告诉我你的创作想法吧。', 'chat-bubble bot-bubble');
    messages.scrollTop = messages.scrollHeight;
  });
}

document.querySelector('#chat-form').addEventListener('submit', (event) => {
  event.preventDefault();
  const input = document.querySelector('#chat-input');
  sendChat(input.value);
  input.value = '';
});
document.querySelectorAll('.prompt-chip').forEach((chip) => chip.addEventListener('click', () => sendChat(chip.textContent)));

document.querySelector('#copy-code').addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText(roomState.code);
    showToast('班级码已复制，发给同学吧。');
  } catch {
    showToast(`班级码：${roomState.code}`);
  }
});

function leaveClass() {
  localStorage.removeItem('music-classroom-session');
  socket.disconnect();
  showEntry();
  setTimeout(() => socket.connect(), 50);
}
document.querySelector('#leave-class').addEventListener('click', leaveClass);
document.querySelector('#back-home').addEventListener('click', leaveClass);
