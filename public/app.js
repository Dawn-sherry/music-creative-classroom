const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const socket = io({ autoConnect: false, reconnection: true });
const state = {
  role: 'student', mode: 'login', user: null, view: 'overview', module: 'listening',
  overview: { classes: [], lessons: [], sessions: [], submissions: [], knowledge: [], students: [] },
  knowledge: [], lessons: [], portfolio: [], publicClasses: [], insights: null, report: null, aiSource: '本地音乐创作引导',
  live: null, activeAssignment: null, toastTimer: null, audio: null, grid: null,
  midiAccess: null, record: null, chat: [],
};

const roleNames = { teacher: '音乐教师', student: '中小学生', preservice: '职前教师' };
const moduleNames = { listening: '创造性聆听', performance: '创造性表演', improv: '即兴编创', composition: '音乐创作空间' };
const moduleIcons = { listening: '耳', performance: '声', improv: '即', composition: '作' };
const viewNames = { overview: '学习总览', planning: '课程活动设计', knowledge: '教材知识库', classroom: '实时课堂', insights: '学情分析', portfolio: '我的作品集', report: '成长报告', blueprint: '平台设计方案', settings: '账号设置', practice: '音乐创造实践' };

function escapeHTML(value = '') {
  return String(value).replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);
}

async function api(url, options = {}) {
  const response = await fetch(url, {
    credentials: 'same-origin',
    ...options,
    headers: { ...(options.body ? { 'Content-Type': 'application/json' } : {}), ...(options.headers ?? {}) },
    body: options.body && typeof options.body !== 'string' ? JSON.stringify(options.body) : options.body,
  });
  const result = response.status === 204 ? {} : await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(result.error || `请求失败（${response.status}）`);
  return result;
}

function showToast(message) {
  const toast = $('#toast');
  if (!toast) return;
  toast.textContent = message;
  toast.classList.add('show');
  clearTimeout(state.toastTimer);
  state.toastTimer = setTimeout(() => toast.classList.remove('show'), 2800);
}

function dateLabel(date) {
  if (!date) return '刚刚';
  return new Date(date).toLocaleDateString('zh-CN', { year: 'numeric', month: 'short', day: 'numeric' });
}

function initials(name) { return escapeHTML((name || '芽').slice(0, 1)); }

function setEntryRole(role) {
  state.role = role;
  $$('.role-choice').forEach((button) => {
    const active = button.dataset.role === role;
    button.classList.toggle('active', active);
    button.setAttribute('aria-selected', String(active));
  });
  updateAuthForm();
}

function updateAuthForm() {
  const student = state.role === 'student';
  const registering = state.mode === 'register';
  $('#student-class-wrap').classList.toggle('hidden', !student);
  $('#register-name-wrap').classList.toggle('hidden', !registering);
  $('#auth-name').required = registering;
  $('#auth-class').required = student;
  $('#auth-class-code').required = student && registering;
  $('#class-code-wrap').classList.toggle('hidden', !registering || !student);
  $('#auth-password').autocomplete = registering ? 'new-password' : 'current-password';
  $('#password-hint').textContent = registering ? '· 至少 10 位，设为自己的初始密码' : '';
  $('#auth-mode-hint').textContent = registering ? `创建${roleNames[state.role]}账号` : `欢迎回来，继续你的音乐探索`;
  $('#auth-submit-label').textContent = registering ? '创建账号并进入' : '登录豆芽AI';
  $('#auth-mode-toggle').innerHTML = registering ? '返回账号登录 <span>→</span>' : '创建新账号 <span>→</span>';
  $('#auth-error').textContent = '';
}

async function loadPublicClasses() {
  const select = $('#auth-class');
  try {
    const classes = await api('/api/classes');
    state.publicClasses = classes;
    select.innerHTML = `<option value="">${classes.length ? '选择学校班级' : '暂无班级，请先联系老师'}</option>${classes.map((item) => `<option value="${escapeHTML(item.id)}">${escapeHTML(item.name)} · ${escapeHTML(item.grade)} · ${escapeHTML(item.teacherName)}</option>`).join('')}`;
  } catch {
    select.innerHTML = '<option value="">暂时无法读取班级</option>';
  }
}

async function handleAuth(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const submit = form.querySelector('[type=submit]');
  submit.disabled = true;
  $('#auth-error').textContent = '';
  const payload = { role: state.role, username: $('#auth-username').value, password: $('#auth-password').value };
  if (state.mode === 'register') {
    payload.name = $('#auth-name').value;
    if (state.role === 'student') {
      payload.classId = $('#auth-class').value;
      payload.classCode = $('#auth-class-code').value.trim().toUpperCase();
    }
  } else if (state.role === 'student') payload.classId = $('#auth-class').value;
  try {
    await api(state.mode === 'register' ? '/api/register' : '/api/login', { method: 'POST', body: payload });
    await enterPlatform();
  } catch (error) {
    $('#auth-error').textContent = error.message;
  } finally {
    submit.disabled = false;
  }
}

async function loadPortalData() {
  const [me, overview, knowledge, lessons, portfolio] = await Promise.all([
    api('/api/me'), api('/api/overview'), api('/api/knowledge'), api('/api/lessons'), api('/api/portfolio'),
  ]);
  state.user = me.user;
  state.overview = overview;
  state.knowledge = knowledge;
  state.lessons = lessons;
  state.portfolio = portfolio;
  state.live = null;
}

async function enterPlatform() {
  await loadPortalData();
  $('#home-screen').classList.add('hidden');
  $('#portal-screen').classList.remove('hidden');
  socket.connect();
  state.view = 'overview';
  renderPortal();
}

async function refreshPortal() {
  const [overview, knowledge, lessons, portfolio] = await Promise.all([
    api('/api/overview'), api('/api/knowledge'), api('/api/lessons'), api('/api/portfolio'),
  ]);
  state.overview = overview;
  state.knowledge = knowledge;
  state.lessons = lessons;
  state.portfolio = portfolio;
}

function menuForRole(role) {
  if (role === 'student') return [
    ['overview', '学习总览', '⌂'], ['practice', '音乐创造实践', '♫'], ['classroom', '实时课堂', '◉'],
    ['portfolio', '我的作品集', '▧'], ['report', '成长报告', '↗'], ['knowledge', '教材知识库', '▤'], ['blueprint', '平台设计方案', '◇'],
  ];
  const menu = [['overview', '教学总览', '⌂'], ['planning', role === 'preservice' ? '教研与课程设计' : '课程活动设计', '✳'], ['knowledge', '教材知识库', '▤'], ['classroom', '实时课堂', '◉'], ['insights', '学情分析', '▥']];
  if (role === 'preservice') menu.splice(4, 0, ['portfolio', '试教作品集', '▧']);
  menu.push(['blueprint', '平台设计方案', '◇']);
  return menu;
}

function renderPortal() {
  if (!state.user) return;
  const user = state.user;
  const menu = menuForRole(user.role);
  $('#portal-screen').innerHTML = `
    <div class="portal-layout">
      <aside class="sidebar">
        <a class="logo-lockup side-logo" href="#" data-action="go-home"><span class="logo-seed"><i></i><i></i><i></i></span><span>豆芽<span class="logo-ai">AI</span></span></a>
        <div class="side-research"><span>课题研究平台</span><b>JSJY2025015</b></div>
        <div class="side-user"><span class="user-avatar">${initials(user.name)}</span><span><b>${escapeHTML(user.name)}</b><small>${roleNames[user.role]}</small></span><span class="user-online-dot"></span></div>
        <nav class="side-nav" aria-label="平台导航">${menu.map(([view, label, icon]) => `<button type="button" class="side-link ${state.view === view ? 'active' : ''}" data-view="${view}"><span class="side-icon">${icon}</span><span>${label}</span>${view === 'classroom' && state.live ? '<i class="nav-live-dot"></i>' : ''}</button>`).join('')}</nav>
        <div class="sidebar-bottom"><div class="privacy-note"><span>◈</span><p>学习数据用于课堂反馈<br />作品由学生自己创作</p></div><button type="button" class="side-link settings-link" data-view="settings"><span class="side-icon">⚙</span><span>账号与安全</span></button><button type="button" class="side-link logout-link" data-action="logout"><span class="side-icon">↪</span><span>退出登录</span></button></div>
      </aside>
      <section class="portal-main">
        <header class="portal-topbar"><div><span class="crumb-root">豆芽AI</span><span class="crumb-slash">/</span><span class="crumb-current">${escapeHTML(viewNames[state.view] ?? '音乐创造实践')}</span></div><div class="portal-top-actions">${state.live ? `<span class="session-indicator"><i></i>课堂进行中 · ${escapeHTML(state.live.code)}</span>` : ''}<button class="top-avatar" type="button" data-view="settings" aria-label="账号设置">${initials(user.name)}</button></div></header>
        <main id="portal-content" class="portal-content">${renderView()}</main>
        <footer class="portal-footer"><span>豆芽AI · 音乐创造教育平台</span><span>以知识为底座，以创作为中心</span></footer>
      </section>
    </div>`;
}

function renderView() {
  switch (state.view) {
    case 'overview': return state.user.role === 'student' ? renderStudentHome() : renderTeacherHome();
    case 'planning': return renderPlanning();
    case 'knowledge': return renderKnowledge();
    case 'classroom': return renderClassroom();
    case 'insights': return renderInsights();
    case 'portfolio': return renderPortfolio();
    case 'report': return renderReport();
    case 'blueprint': return renderBlueprint();
    case 'settings': return renderSettings();
    case 'practice': return renderPractice();
    default: return renderStudentHome();
  }
}

function pageIntro(kicker, title, description, actions = '') {
  return `<div class="page-intro"><div><span class="page-kicker">${escapeHTML(kicker)}</span><h1>${escapeHTML(title)}</h1><p>${escapeHTML(description)}</p></div>${actions ? `<div class="page-intro-actions">${actions}</div>` : ''}</div>`;
}

function statCard(icon, label, value, note, hue = 'mint') {
  return `<article class="stat-card stat-${hue}"><div class="stat-icon">${icon}</div><span>${escapeHTML(label)}</span><strong>${escapeHTML(value)}</strong><small>${escapeHTML(note)}</small></article>`;
}

function classCard(classroom, teacher = true) {
  const count = state.overview.students.filter((student) => student.classId === classroom.id).length;
  return `<article class="class-card"><div class="class-card-top"><span class="class-grade">${escapeHTML(classroom.grade)}</span><span class="class-card-spark">✳</span></div><h3>${escapeHTML(classroom.name)}</h3><p>${teacher ? `已加入 ${count} 位学生` : `${escapeHTML(classroom.teacherName)} · 音乐课堂`}</p><div class="permanent-code"><span>班级专属码</span><b>${escapeHTML(classroom.code)}</b><button type="button" data-action="copy" data-copy="${escapeHTML(classroom.code)}">复制</button></div><small class="permanent-hint">长期有效 · 仅用于班级归属</small></article>`;
}

function renderTeacherHome() {
  const user = state.user;
  const classes = state.overview.classes;
  const active = state.overview.sessions.filter((session) => session.status === 'active');
  const classForm = `<form class="inline-create-form" data-form="create-class"><div><label>班级名称</label><input name="name" placeholder="例如：七年级 2 班" required maxlength="50" /></div><div><label>年级</label><select name="grade" required><option value="">选择年级</option>${['小学三年级', '小学四年级', '小学五年级', '小学六年级', '初中一年级', '初中二年级', '初中三年级'].map((grade) => `<option>${grade}</option>`).join('')}</select></div><button class="button-primary compact">创建班级 +</button></form>`;
  return `${pageIntro(user.role === 'preservice' ? 'TEACHER LAB' : 'TEACHING STUDIO', `你好，${user.name}`, '从课程目标、教材知识和学生最近发展区出发，设计一堂可以自由创造的音乐课。', `<button class="button-primary" data-view="planning">设计一节音乐课 <span>↗</span></button>`)}
    <div class="stats-row">${statCard('♧', '管理班级', classes.length, '每个班级都有长期专属码')}${statCard('♫', '课堂活动', state.overview.lessons.length, '跨聆听、表演、即兴与创作', 'peach')}${statCard('◉', '正在上课', active.length, '使用单次临时课堂码', 'blue')}${statCard('▧', '学生作品', state.overview.submissions.length, '课堂提交与修改记录', 'lilac')}</div>
    <div class="content-columns teacher-overview-columns"><section class="content-panel"><div class="section-head"><div><span class="section-kicker">MY CLASSES</span><h2>我的班级</h2></div><span class="soft-badge">班级码长期有效</span></div>${classes.length ? `<div class="class-grid-cards">${classes.map((classroom) => classCard(classroom)).join('')}</div>` : `<div class="empty-panel"><span>✳</span><h3>先创建你的第一个班级</h3><p>班级专属码供学生注册和归属班级使用；每次上课会另外生成临时课堂码。</p></div>`}${classForm}</section>
      <section class="content-panel"><div class="section-head"><div><span class="section-kicker">CLASSROOM LOOP</span><h2>教学闭环</h2></div><span class="section-mark">◇</span></div><div class="loop-steps">${[['01', '备课设计', '关联教材目标与创造性活动'], ['02', '实时实践', '四类音乐活动实时协作'], ['03', '过程观察', '关注参与、尝试和作品修改'], ['04', '适配反馈', '以最近发展区建议下一步']].map(([n, title, note]) => `<div class="loop-step"><span>${n}</span><div><b>${title}</b><small>${note}</small></div></div>`).join('')}</div><button class="text-action" data-view="blueprint">查看平台架构与技术路径 ↗</button></section></div>
      <section class="content-panel recent-sessions"><div class="section-head"><div><span class="section-kicker">LIVE & RECENT</span><h2>课堂记录</h2></div><button class="button-soft" data-view="classroom">进入实时课堂 →</button></div>${active.length ? active.map((session) => `<div class="session-row"><span class="session-icon">♫</span><span class="session-row-main"><b>${escapeHTML(session.title)}</b><small>${escapeHTML(session.className || '')} · 临时码 ${escapeHTML(session.code)}</small></span><span class="online-pill">◉ ${session.onlineCount ?? 0} 在线</span><button class="icon-button" data-action="open-session" data-id="${escapeHTML(session.id)}">进入 ↗</button></div>`).join('') : '<p class="empty-inline">还没有进行中的课堂。创建班级后，可发布一间临时课堂。</p>'}</section>`;
}

function moduleCard(module, note) {
  const colors = { listening: 'mint', performance: 'peach', improv: 'blue', composition: 'lilac' };
  return `<button type="button" class="module-card module-${colors[module]}" data-module="${module}"><span class="module-symbol">${moduleIcons[module]}</span><span><b>${moduleNames[module]}</b><small>${note}</small></span><span class="module-go">↗</span></button>`;
}

function renderStudentHome() {
  const user = state.user;
  const classes = state.overview.classes;
  const active = state.overview.sessions.filter((session) => session.status === 'active');
  const submissions = state.overview.submissions;
  const bestNext = submissions.length + state.portfolio.length < 2 ? '从一段音乐中找出最打动你的声音线索，然后用三个音回应它。' : '挑选一段熟悉的旋律，换一种节奏或音色，让它表达另一种心情。';
  const tasks = state.overview.sessions.flatMap((session) => (session.assignments ?? []).map((assignment) => ({ ...assignment, sessionId: session.id, sessionTitle: session.title, className: session.className })));
  return `${pageIntro('YOUR MUSIC JOURNEY', `${user.name}，今天想探索什么？`, '不必等灵感准备好。先听见一个细节，创造就已经开始。', `<button class="button-primary" data-view="practice">进入音乐创造空间 <span>↗</span></button>`)}
    <div class="student-welcome-strip"><span class="welcome-seed">芽</span><span><b>${classes.length ? escapeHTML(classes.map((item) => item.name).join('、')) : '欢迎来到豆芽AI'}</b><small>你可以自由探索，也可以继续课堂任务。</small></span><button class="text-action" data-view="classroom">${active.length ? `进入课堂 · ${active.length} 间正在进行` : '查看课堂 →'}</button></div>
    ${state.publicClasses.some((item) => !state.user.classIds.includes(item.id)) ? `<form class="student-enroll-strip" data-form="enroll-class"><b>加入另一个班级</b><select name="classId" required><option value="">选择老师创建的班级</option>${state.publicClasses.filter((item) => !state.user.classIds.includes(item.id)).map((item) => `<option value="${escapeHTML(item.id)}">${escapeHTML(item.name)} · ${escapeHTML(item.grade)}</option>`).join('')}</select><input name="classCode" maxlength="6" placeholder="班级专属码" required /><button class="button-soft">加入班级 +</button></form>` : ''}
    <div class="stats-row student-stats">${statCard('✧', '我的创意记录', submissions.length + state.portfolio.length, '每一次尝试都算数')}${statCard('◌', '探索方式', new Set([...submissions.map((item) => item.module), ...state.portfolio.map((item) => item.module)]).size + ' / 4', '听、演、即兴、创作', 'peach')}${statCard('♫', '已完成作品', state.portfolio.length, '保存到个人作品集', 'blue')}</div>
    <section class="content-panel practice-launch"><div class="section-head"><div><span class="section-kicker">FOUR WAYS TO CREATE</span><h2>音乐创造实践</h2></div><span class="soft-badge">四种方式 · 同一创作空间</span></div><div class="module-launch-grid">${moduleCard('listening', '用耳朵发现音乐线索')}${moduleCard('performance', '把想法变成声音表达')}${moduleCard('improv', '试着改变节奏与音高')}${moduleCard('composition', '排列、聆听并保存旋律')}</div></section>
    <div class="content-columns student-home-columns"><section class="content-panel"><div class="section-head"><div><span class="section-kicker">NEXT SMALL STEP</span><h2>给你的创作建议</h2></div><span class="section-mark">✳</span></div><div class="zpd-card"><span class="zpd-label">最近发展区 · 一小步挑战</span><p>${bestNext}</p><button class="button-primary compact" data-action="start-recommended">开始这个小练习 <span>↗</span></button></div></section><section class="content-panel"><div class="section-head"><div><span class="section-kicker">LIVE CLASS</span><h2>课堂任务</h2></div><span class="section-mark">◉</span></div>${tasks.length ? tasks.slice(0, 3).map((task) => `<article class="task-mini"><span class="task-module-tag">${moduleNames[task.module] ?? '音乐创作'}</span><b>${escapeHTML(task.title)}</b><small>${escapeHTML(task.sessionTitle)} · ${escapeHTML(task.className ?? '')}</small><button class="text-action" data-action="start-task" data-session="${escapeHTML(task.sessionId)}" data-id="${escapeHTML(task.id)}" data-module="${escapeHTML(task.module)}" data-title="${escapeHTML(task.title)}" data-description="${escapeHTML(task.description)}">去完成并创作 →</button></article>`).join('') : `<div class="empty-inline">${active.length ? '课堂中还没有发布任务。' : '老师发布课堂任务后，会出现在这里。'} <button class="text-action" data-view="classroom">查看实时课堂 →</button></div>`}</section></div>`;
}

function renderPlanning() {
  const knowledge = state.knowledge;
  const lessons = state.lessons;
  const activityPrompts = {
    listening: '听辨一个音乐要素，记录线索，并用语言、动作或图像表达联想。',
    performance: '选用人声、身体打击或乐器回应音乐，尝试改变音色、力度或速度。',
    improv: '用限定音组和节奏做问答，即兴发展一个两小节动机。',
    composition: '整理并发展个人动机，形成有呼吸感的乐句，保存创作版本。',
  };
  return `${pageIntro('TEACHER STUDIO · BEFORE CLASS', '设计一堂有创造路径的音乐课', '以知识库中的教材目标和音乐要素作起点，串联聆听、表演、即兴与创作。')}
    <div class="content-columns plan-columns"><section class="content-panel plan-form-panel"><div class="section-head"><div><span class="section-kicker">LESSON DESIGN</span><h2>课程活动设计</h2></div><span class="soft-badge">四模块已串联</span></div>
      <form class="stack-form" data-form="save-lesson"><div class="field-row"><label>课程主题<input name="title" placeholder="例：用五个音描绘一场春雨" required maxlength="100" /></label><label>适用年级<select name="grade"><option>小学四—六年级</option><option>初中七年级</option><option>初中八年级</option><option>初中九年级</option></select></label></div><label>学习目标<textarea name="objective" rows="2" required placeholder="写下学生能听见、能表达、能创造什么"></textarea></label><div class="activity-plan-grid">${Object.entries(moduleNames).map(([module, name]) => `<label class="activity-step step-${module}"><span class="step-number">${moduleIcons[module]}</span><span><b>${name}</b><small>${activityPrompts[module]}</small></span><input name="module-${module}" type="checkbox" checked aria-label="加入${name}" /></label>`).join('')}</div><div class="knowledge-picker"><div class="field-subhead"><b>关联教材知识</b><small>课堂文本与 AI 引导优先引用已选资源</small></div>${knowledge.map((item) => `<label class="knowledge-option"><input name="knowledgeIds" type="checkbox" value="${escapeHTML(item.id)}" /><span><b>${escapeHTML(item.title)}</b><small>${escapeHTML(item.grade)} · ${escapeHTML(item.unit)}</small></span></label>`).join('')}</div><button class="button-primary">保存课程设计 <span>↗</span></button></form>
    </section><aside class="content-panel resource-side"><div class="section-head"><div><span class="section-kicker">FROM KNOWLEDGE TO CLASS</span><h2>知识底座</h2></div><button class="text-action" data-view="knowledge">管理 →</button></div><p class="aside-copy">上传教材与目标后，这些内容会成为备课、实践提示和 AI 音乐伙伴的共同依据。</p>${knowledge.slice(0, 3).map((item) => `<article class="resource-mini"><span class="resource-mini-icon">▤</span><span><b>${escapeHTML(item.title)}</b><small>${escapeHTML(item.textbook)} · ${escapeHTML(item.unit)}</small></span></article>`).join('')}<div class="objective-note"><span>✦</span><p>让技术提供支架，让音乐选择留给学生。每个活动都从“听见什么”走向“我想怎样表达”。</p></div></aside></div>
    <section class="content-panel saved-lessons"><div class="section-head"><div><span class="section-kicker">MY LESSONS</span><h2>已保存的课程设计</h2></div><span class="count-chip">${lessons.length} 份</span></div>${lessons.length ? lessons.slice().reverse().map((lesson) => `<article class="lesson-row"><span class="lesson-icon">♫</span><span class="lesson-row-main"><b>${escapeHTML(lesson.title)}</b><small>${escapeHTML(lesson.grade)} · ${lesson.knowledge.length} 条教材关联 · ${dateLabel(lesson.createdAt)}</small><small>${escapeHTML(lesson.objective)}</small></span><button type="button" class="button-soft" data-action="use-lesson" data-id="${escapeHTML(lesson.id)}">用于课堂 →</button></article>`).join('') : '<p class="empty-inline">保存第一份课程设计后，会在这里关联到实时课堂。</p>'}</section>`;
}

function renderKnowledge() {
  const teacher = ['teacher', 'preservice'].includes(state.user.role);
  const sections = [...new Set(state.knowledge.map((item) => item.stage))];
  return `${pageIntro('CURRICULUM KNOWLEDGE BASE', '教材知识库', '存放并整理教材目标、音乐要素、乐谱与教学文本，为备课、学生实践、AI 引导和课后分析提供共同依据。', teacher ? '<button class="button-primary" data-action="focus-import">导入教材资料 <span>＋</span></button>' : '')}
    <div class="knowledge-banner"><span class="knowledge-banner-icon">▤</span><div><b>知识底座 · 可持续生长</b><p>当前内置的是通用音乐创造基础知识。教师上传教材文本后，可补充年级、单元、目标与音乐要素标签，再关联到课程和活动。</p></div><span class="knowledge-count">${state.knowledge.length} 条资料</span></div>
    <div class="knowledge-layout"><section class="knowledge-list-panel">${sections.map((section) => `<div class="knowledge-section"><div class="knowledge-section-title"><span>${escapeHTML(section)}</span><i></i></div>${state.knowledge.filter((item) => item.stage === section).map((item) => `<article class="knowledge-card"><div class="knowledge-card-top"><span class="knowledge-unit">${escapeHTML(item.unit)}</span><span class="knowledge-grade">${escapeHTML(item.grade)}</span></div><h3>${escapeHTML(item.title)}</h3><p>${escapeHTML(item.content)}</p><div class="element-tags">${(item.elements ?? []).map((element) => `<span>${escapeHTML(element)}</span>`).join('')}</div><div class="knowledge-objectives"><b>教学目标</b>${(item.objectives ?? []).map((objective) => `<span>· ${escapeHTML(objective)}</span>`).join('')}</div><footer><span>${escapeHTML(item.textbook)} · ${escapeHTML(item.sourceName)}</span><small>${dateLabel(item.createdAt)}</small></footer></article>`).join('')}</div>`).join('')}</section>
    ${teacher ? `<aside class="content-panel import-panel" id="knowledge-import"><div class="section-head"><div><span class="section-kicker">ADD TEACHING MATERIAL</span><h2>整理教材内容</h2></div><span class="section-mark">✦</span></div><p class="aside-copy">先上传或粘贴可读取的文本资料，再标注教材版本、目标和音乐要素。扫描版乐谱可先做 OCR 后导入文本，原文件不会传到外部模型。</p><form class="stack-form" data-form="save-knowledge"><label>资料标题<input name="title" required placeholder="例：七年级上册 · 民歌中的旋律" maxlength="120" /></label><div class="field-row"><label>教材 / 版本<input name="textbook" placeholder="出版社、册次或校本资料" maxlength="120" /></label><label>年级<input name="grade" placeholder="例：初中七年级" maxlength="40" /></label></div><div class="field-row"><label>阶段<input name="stage" placeholder="小学 / 初中" maxlength="40" /></label><label>单元 / 主题<input name="unit" placeholder="例：节奏与节拍" maxlength="100" /></label></div><label>文本文件<input name="sourceFile" type="file" accept=".txt,.md,.csv,.json,text/plain,text/markdown,application/json" data-action="read-knowledge-file" /></label><label>教材与教学文本<textarea name="content" id="knowledge-content" rows="8" required placeholder="粘贴教材中的教学目标、音乐要素、谱例说明或课堂活动文本……"></textarea></label><label>教学目标 <small>每行一项</small><textarea name="objectives" rows="3" placeholder="辨认旋律动机\n用声音表达对比"></textarea></label><label>音乐要素标签 <small>用逗号分隔</small><input name="elements" placeholder="音高，节奏，乐句，力度" /></label><button class="button-primary">加入知识库 <span>↗</span></button></form><p class="knowledge-privacy">资料保存在学校平台空间，默认仅登录用户可查阅。</p></aside>` : ''}</div>`;
}

function renderClassroom() {
  const student = state.user.role === 'student';
  const classes = state.overview.classes;
  const activeSessions = state.overview.sessions.filter((session) => session.status === 'active');
  if (state.live) return renderLiveRoom();
  const sessions = student ? activeSessions : state.overview.sessions.filter((session) => session.status === 'active');
  return `${pageIntro('LIVE MUSIC CLASS', student ? '进入实时音乐课堂' : '实时课堂', student ? '选择老师正在进行的课堂，或输入临时课堂码。班级专属码与每次课堂码用途不同。' : '班级专属码长期有效；新建课堂时另生成一次性临时码，用于进入本次实时互动。', !student && classes.length ? '<button class="button-soft" data-action="show-class-codes">查看班级专属码</button>' : '')}
    ${!student ? `<div class="content-columns classroom-start-columns"><section class="content-panel"><div class="section-head"><div><span class="section-kicker">START A LIVE SESSION</span><h2>新建一次课堂</h2></div><span class="session-temp-label">临时码 · 本次有效</span></div>${classes.length ? `<form class="stack-form" data-form="create-session"><label>选择班级<select name="classId" required>${classes.map((item) => `<option value="${escapeHTML(item.id)}">${escapeHTML(item.name)} · 班级专属码 ${escapeHTML(item.code)}</option>`).join('')}</select></label><label>本节课内容<input name="title" required placeholder="例：用五声音阶描绘校园清晨" maxlength="100" /></label><label>关联备课设计<select name="lessonId"><option value="">不指定 / 现场调整</option>${state.lessons.map((item) => `<option value="${escapeHTML(item.id)}">${escapeHTML(item.title)} · ${escapeHTML(item.grade)}</option>`).join('')}</select></label><div class="code-difference-note"><span>▦</span><p><b>班级码 ${escapeHTML(classes[0].code)}</b> 负责学生注册和班级归属。<br />点击开始后会生成一个全新的 <b>临时课堂码</b>，只用于本节课。</p></div><button class="button-primary">开始课堂并生成临时码 <span>↗</span></button></form>` : `<div class="empty-panel"><span>✳</span><h3>先创建一个班级</h3><p>到教学总览创建班级，会获得长期班级专属码。</p><button class="button-primary compact" data-view="overview">创建班级 →</button></div>`}</section><section class="content-panel"><div class="section-head"><div><span class="section-kicker">STUDENT TASKS</span><h2>发布创造任务</h2></div><span class="section-mark">♫</span></div><p class="aside-copy">课堂开始后可发布任务。学生的实践入口会自动切换到对应模块，作品和修改过程回流到学情分析。</p><div class="task-design-preview">${Object.entries(moduleNames).map(([key, name]) => `<div><span>${moduleIcons[key]}</span><b>${name}</b></div>`).join('')}</div><button class="text-action" data-view="planning">先完成课程活动设计 →</button></section></div>` : `<div class="student-join-box"><div class="join-box-icon">◉</div><div><h2>进入老师的课堂</h2><p>临时课堂码只在本节课使用。已登录后，你的班级会由账号绑定。</p></div><form data-form="join-session"><input name="code" placeholder="输入 6 位临时课堂码" maxlength="6" required /><button class="button-primary compact">加入课堂 ↗</button></form></div>`}
    <section class="content-panel live-session-list"><div class="section-head"><div><span class="section-kicker">${student ? 'YOUR CLASSROOMS' : 'LIVE SESSIONS'}</span><h2>${student ? '班级正在进行的课堂' : '进行中的课堂'}</h2></div><span class="count-chip">${sessions.length} 间</span></div>${sessions.length ? sessions.map((session) => `<article class="session-card"><span class="session-card-symbol">♫</span><div class="session-card-main"><span class="live-tag"><i></i>实时课堂</span><h3>${escapeHTML(session.title)}</h3><p>${escapeHTML(session.className ?? '')} · ${escapeHTML(session.teacherName ?? '')} · ${session.assignments?.length ?? 0} 个任务</p></div><div class="session-card-code"><small>临时课堂码</small><b>${escapeHTML(session.code)}</b></div><button class="button-primary compact" data-action="join-session" data-id="${escapeHTML(session.id)}">${student ? '进入课堂' : '教师控制台'} ↗</button></article>`).join('') : '<div class="empty-inline">暂时没有进行中的课堂。老师开始上课后，会在这里出现一次性课堂码。</div>'}</section>
    ${!student && classes.length ? `<section class="content-panel"><div class="section-head"><div><span class="section-kicker">CLASSROOM CODES</span><h2>长期班级专属码</h2></div><span class="soft-badge">学生注册时选择班级并填写</span></div><div class="class-grid-cards">${classes.map((item) => classCard(item)).join('')}</div></section>` : ''}`;
}

function renderLiveRoom() {
  const live = state.live;
  const teacher = state.user.role !== 'student' && live.viewerIsTeacher;
  const handNames = new Set(live.hands ?? []);
  const people = (live.participants ?? []).filter((person) => person.role === 'student');
  return `${pageIntro('LIVE NOW', live.title, `${live.className} · ${live.teacherName} · 临时课堂码`, `<button class="button-soft" data-action="leave-session">← 返回课堂列表</button>`)}
    <section class="live-room-banner"><div><span>本节课临时课堂码</span><b class="live-code">${escapeHTML(live.code)}</b></div><button class="button-light" data-action="copy" data-copy="${escapeHTML(live.code)}">复制课堂码</button><span class="online-big">◉ <b>${live.onlineCount}</b> 人在线</span><span class="session-only-note">和长期班级码不同 · 下课后结束</span></section>
    <div class="content-columns live-room-columns"><section class="content-panel live-tasks-panel"><div class="section-head"><div><span class="section-kicker">SHARED MUSIC TASKS</span><h2>课堂创作任务</h2></div>${teacher ? '<span class="soft-badge">发布后实时同步</span>' : '<span class="soft-badge">完成后自动进入作品集</span>'}</div>
      ${teacher ? `<form class="assignment-publish-form" data-form="publish-assignment"><label>任务名称<input name="title" required placeholder="例：用四个音描绘一阵微风" maxlength="100" /></label><label>活动模块<select name="module">${Object.entries(moduleNames).map(([key, name]) => `<option value="${key}">${name}</option>`).join('')}</select></label><label>适配难度<select name="level"><option>起步支架</option><option selected>适中</option><option>进阶探索</option></select></label><label>引导说明<textarea name="description" rows="2" required placeholder="先聆听……再选择一个音高或节奏做变化"></textarea></label><button class="button-primary compact">发布任务 ↗</button></form>` : `<button type="button" class="hand-action ${handNames.has(state.user.name) ? 'raised' : ''}" data-action="toggle-hand">✋ ${handNames.has(state.user.name) ? '放下手' : '举手发言'}</button>`}
      <div class="live-assignment-list">${live.assignments?.length ? live.assignments.map((assignment) => `<article class="live-assignment"><div class="live-assignment-head"><span class="task-module-tag">${moduleNames[assignment.module] ?? '音乐创造'}</span><span class="level-tag">${escapeHTML(assignment.level)}</span></div><h3>${escapeHTML(assignment.title)}</h3><p>${escapeHTML(assignment.description)}</p>${teacher ? `<div class="submission-review"><b>学生提交 · ${live.submissions.filter((item) => item.assignmentId === assignment.id).length} 份</b>${live.submissions.filter((item) => item.assignmentId === assignment.id).map((item) => `<div><span class="review-avatar">${initials(item.studentName)}</span><p><b>${escapeHTML(item.studentName)}</b><br />${escapeHTML(item.content)}</p></div>`).join('') || '<small>同学提交后会显示在这里。</small>'}</div>` : `<button class="button-primary compact" data-action="start-task" data-session="${escapeHTML(live.id)}" data-id="${escapeHTML(assignment.id)}" data-module="${escapeHTML(assignment.module)}" data-title="${escapeHTML(assignment.title)}" data-description="${escapeHTML(assignment.description)}">进入${moduleNames[assignment.module]}完成 ↗</button>`}</article>`).join('') : '<div class="empty-inline">老师还没有发布任务。可以先进入音乐创造空间自由探索。</div>'}</div>
      ${!teacher ? '<button class="text-action" data-view="practice">不等任务，去自由创作 →</button>' : ''}</section>
      <aside class="content-panel roster-panel"><div class="section-head"><div><span class="section-kicker">HERE TOGETHER</span><h2>课堂现场</h2></div><span class="count-chip">${live.onlineCount} 在线</span></div><div class="roster-section-title"><b>举手队列</b><span>${live.hands.length}</span></div>${live.hands.length ? live.hands.map((name) => `<div class="roster-person hand-person"><span class="roster-avatar">${initials(name)}</span><span>${escapeHTML(name)}</span><span>✋</span></div>`).join('') : '<p class="empty-inline small-empty">还没有同学举手。</p>'}<div class="roster-section-title roster-online-title"><b>在线同学</b><span>${people.length}</span></div>${people.map((person) => `<div class="roster-person"><span class="roster-avatar">${initials(person.name)}</span><span>${escapeHTML(person.name)}</span><i class="user-online-dot"></i></div>`).join('') || '<p class="empty-inline small-empty">等待同学加入课堂。</p>'}</aside></div>`;
}

function renderInsights() {
  const data = state.insights;
  if (!data) return `${pageIntro('FORMATIVE ASSESSMENT', '学生学情与创造过程', '查看班级参与路径、作品变化和下一步可尝试的支架建议。')}<div class="loading-panel">正在整理课堂过程记录…</div>`;
  const avg = (key) => data.students.length ? Math.round(data.students.reduce((sum, student) => sum + student[key], 0) / data.students.length) : 0;
  return `${pageIntro('FORMATIVE ASSESSMENT', '学生学情与创造过程', '以作品、尝试路径与修改记录形成可解释的课堂反馈。指标用于发现下一步教学机会，不替代教师判断。')}
    <div class="stats-row">${statCard('✧', '参与学生', data.students.length, '来自你管理的班级')}${statCard('▧', '课堂提交', data.students.reduce((sum, item) => sum + item.submissions, 0), '已归档的音乐作品', 'peach')}${statCard('◌', '实践方式覆盖', `${avg('flexibility')}%`, '聆听 / 表演 / 即兴 / 创作', 'blue')}${statCard('↗', '修改精进记录', `${avg('refinement')}%`, '从版本变化中观察成长', 'lilac')}</div>
    <section class="content-panel insights-panel"><div class="section-head"><div><span class="section-kicker">CLASS LEARNING MAP</span><h2>班级创造力观察</h2></div><span class="soft-badge">基于四维过程代理指标</span></div>${data.students.length ? `<div class="insights-table"><div class="insights-table-head"><span>学生 / 班级</span><span>流畅性</span><span>变通性</span><span>独特性</span><span>精进性</span><span>下一步建议</span></div>${data.students.map((student) => `<article class="insight-row"><div class="insight-student"><span class="user-avatar small">${initials(student.name)}</span><span><b>${escapeHTML(student.name)}</b><small>${escapeHTML(student.className)} · ${student.submissions} 件提交 / ${student.logs} 次过程</small></span></div>${[['fluency', '创意记录'], ['flexibility', '活动覆盖'], ['originality', '版本差异'], ['refinement', '修改行为']].map(([key, label]) => `<div class="metric-cell"><div class="metric-track"><i style="width:${student[key]}%"></i></div><b>${student[key]}%</b><small>${label}</small></div>`).join('')}<p class="zpd-suggestion">${escapeHTML(student.nextStep)}</p></article>`).join('')}</div>` : '<div class="empty-panel"><span>◌</span><h3>等待学生加入并留下创作过程</h3><p>班级里的实践、提交和作品修改会出现在学情视图中。</p></div>'}<p class="metric-method-note">评估说明：流畅性以创意记录数量估算；变通性以参与的活动类型估算；独特性以个人版本差异作为线索；精进性以修改行为估算。系统不宣称可以仅凭文本判断艺术质量，也不用于学生排名。</p></section>
    <div class="content-columns"><section class="content-panel"><div class="section-head"><div><span class="section-kicker">ZONE OF PROXIMAL DEVELOPMENT</span><h2>最近发展区分层任务</h2></div><span class="section-mark">✦</span></div><div class="zpd-levels"><article><span>01 · 需要支架</span><b>先听一段，指出一个声音变化</b><small>用三到五个音模仿，提供节奏卡与范例。</small></article><article><span>02 · 正在掌握</span><b>给动机做一次有目的的变化</b><small>尝试变换节奏、音区或情绪，再解释选择。</small></article><article><span>03 · 拓展挑战</span><b>为同一主题创作两种不同版本</b><small>增加限制条件，与同伴合奏或互相续写。</small></article></div></section><section class="content-panel"><div class="section-head"><div><span class="section-kicker">NEXT TEACHING MOVES</span><h2>教师观察提示</h2></div></div><p class="aside-copy">先观察学生用了哪些音乐线索，再决定是否提供节奏、音组或同伴合作支架。让学生说明自己的选择，比替作品打分更能看见思考过程。</p><button class="text-action" data-view="classroom">把适配挑战带进下一节实时课堂 →</button></section></div>`;
}

function renderPortfolio() {
  const items = [...state.portfolio.map((item) => ({ ...item, source: '作品' })), ...state.overview.submissions.map((item) => ({ ...item, source: '课堂任务' }))].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  return `${pageIntro('MY MUSIC ARCHIVE', state.user.role === 'student' ? '我的作品集' : '试教作品与学习档案', '把创作草图、即兴片段和课堂提交收在一起，持续回看想法如何生长。', state.user.role === 'student' ? '<button class="button-primary" data-view="practice">继续创作 <span>↗</span></button>' : '')}
    <div class="portfolio-banner"><span>▧</span><div><b>作品保留创作痕迹</b><p>旋律格、活动类型、提交与修改记录都归入个人过程档案；音频采集在本地设备进行，不会自动上传。</p></div></div>
    <section class="portfolio-grid">${items.length ? items.map((item) => `<article class="portfolio-card"><div class="portfolio-card-top"><span class="portfolio-module">${moduleNames[item.module] ?? '音乐创作'}</span><span>${dateLabel(item.createdAt)}</span></div><div class="portfolio-score-visual"><span>${moduleIcons[item.module] ?? '作'}</span><div class="score-lines"><i></i><i></i><i></i><i></i><i></i><b>♪　${escapeHTML((item.content ?? item.title ?? '旋律草图').slice(0, 90))}</b></div></div><h3>${escapeHTML(item.title ?? '我的旋律小样')}</h3><p>${escapeHTML(item.content ?? '一段等待继续发展的音乐想法。')}</p><footer><span>${escapeHTML(item.source ?? '个人创作')}</span><span>${item.revisionCount ? `已修改 ${item.revisionCount} 次` : '初稿'}</span></footer></article>`).join('') : `<div class="empty-panel portfolio-empty"><span>♫</span><h3>你的第一段旋律还在等你</h3><p>在实践空间里试试音符、节奏和变化，保存后作品会自动归档。</p><button class="button-primary compact" data-view="practice">开始一段创作 →</button></div>`}</section>`;
}

function renderReport() {
  if (!state.report) return `${pageIntro('GROWTH JOURNAL', '我的音乐创造成长报告', '回看实践方式、作品版本和下一步的创作建议。')}<div class="loading-panel">正在整理成长记录…</div>`;
  const report = state.report;
  return `${pageIntro('GROWTH JOURNAL', '我的音乐创造成长报告', '看见自己使用过的创造方式，也找到下一步可以试试的小挑战。')}
    <section class="report-summary"><div><span class="section-kicker">A NOTE FOR YOU</span><h2>创造力不是一个分数，是不断尝试的过程。</h2><p>${escapeHTML(report.advice)}</p></div><span class="report-flower">✳</span></section>
    <div class="report-metrics">${report.indicators.map((item, index) => `<article class="report-metric metric-${index}"><div class="report-ring" style="--metric:${item.value}%"><span>${item.value}</span></div><b>${escapeHTML(item.label)}</b><small>${escapeHTML(item.note)}</small></article>`).join('')}</div>
    <section class="content-panel"><div class="section-head"><div><span class="section-kicker">MY PRACTICE PATH</span><h2>最近的创造过程</h2></div><button class="text-action" data-view="portfolio">查看全部作品 →</button></div>${report.records.length ? report.records.map((item) => `<div class="lesson-row"><span class="lesson-icon">${moduleIcons[item.module] ?? '♫'}</span><span class="lesson-row-main"><b>${escapeHTML(item.title)}</b><small>${moduleNames[item.module] ?? '音乐创造'} · ${dateLabel(item.createdAt)} · 修改 ${item.revisionCount} 次</small></span></div>`).join('') : '<p class="empty-inline">尝试完成一个课堂挑战或保存一个作品，成长过程会从这里开始。</p>'}<p class="metric-method-note">指标仅根据你在平台留下的尝试与版本记录生成，用来帮助你发现自己的创作习惯，不代表对音乐能力的定论。</p></section>`;
}

function renderBlueprint() {
  const architecture = [
    ['师生入口', '三类账号 · 角色权限 · 班级归属'], ['教师工作台', '教材资源 · 课程设计 · 学情监控'], ['学生创造空间', '聆听 · 表演 · 即兴 · DAW'], ['学习与作品数据', '班级课堂 · 作品集 · 过程记录'], ['AI 与评估', '知识增强对话 · 形成性反馈'],
  ];
  return `${pageIntro('PRODUCT DESIGN · RESEARCH PLATFORM', '豆芽AI平台设计方案', '课题：人工智能赋能青少年音乐创造力培养的机制剖析与模式探索（课题编号：JSJY2025015）')}
    <section class="content-panel architecture-panel"><div class="section-head"><div><span class="section-kicker">SYSTEM ARCHITECTURE</span><h2>分层架构 · 知识与创造数据闭环</h2></div><span class="soft-badge">Web · 实时课堂 · AI 辅助</span></div><div class="architecture-stack">${architecture.map(([title, note], index) => `<article class="architecture-layer layer-${index}"><span class="architecture-index">0${index + 1}</span><b>${title}</b><span>${note}</span></article>`).join('')}</div><div class="architecture-rails"><span>HTTPS / HttpOnly 登录会话</span><span>REST API + Socket.IO 实时事件</span><span>课程知识库检索增强 Qwen 对话</span><span>结构化数据库 / 对象存储（生产扩展）</span></div></section>
    <div class="content-columns blueprint-columns"><section class="content-panel"><div class="section-head"><div><span class="section-kicker">ROLE FLOWS</span><h2>各端核心功能流程</h2></div></div><div class="flow-map"><article><span>教师端</span><p>登录 → 上传教材/知识目标 → 设计四段活动 → 选班级开课 → 发布分层挑战 → 看过程报告</p></article><article><span>学生端</span><p>选身份与班级登录 → 进入临时课堂 → 聆听 / 表演 / 即兴 / 创作 → 提交作品 → 查看下一步建议</p></article><article><span>职前教师端</span><p>注册 → 整理教研资料 → 设计试教课程 → 观察互动过程 → 复盘并修订教学设计</p></article></div></section><section class="content-panel"><div class="section-head"><div><span class="section-kicker">KEY INTERACTION WIREFRAME</span><h2>学生实践界面原型</h2></div></div><div class="wireframe"><div class="wireframe-top"><span>● ● ●</span><b>音乐创造空间</b><small>课程知识提示</small></div><div class="wireframe-tabs">${Object.entries(moduleNames).map(([key, label]) => `<span class="${key === 'improv' ? 'selected' : ''}">${moduleIcons[key]} ${label}</span>`).join('')}</div><div class="wireframe-workspace"><div class="wireframe-canvas"><b>即兴旋律格</b><div class="wireframe-grid">${Array.from({ length: 24 }, (_, i) => `<i class="${[3, 6, 13, 19].includes(i) ? 'filled' : ''}"></i>`).join('')}</div><small>音高 × 节奏 · 播放 · 撤回 · 保存</small></div><div class="wireframe-ai"><span>✳ 豆芽AI创作伙伴</span><p>你想让这个动机听起来像什么？试着改变一个音，再告诉我听到了什么变化。</p><small>关联知识：旋律动机与乐句</small></div></div></div></section></div>
    <section class="content-panel roadmap-panel"><div class="section-head"><div><span class="section-kicker">IMPLEMENTATION ROADMAP</span><h2>关键技术路径与阶段边界</h2></div></div><div class="roadmap-grid"><article><span>现阶段 · 教学闭环原型</span><b>账号 / 班级 / 实时课 / 知识库 / 音序器</b><p>Node.js + Express + Socket.IO；密码 scrypt、签名会话；本地结构化 JSON 原型存储；Web Audio / Web MIDI；知识增强聊天与形成性指标。</p></article><article><span>第二阶段 · 校园试点</span><b>音频、MIDI 与作品分析</b><p>迁移 PostgreSQL 与对象存储；接入音频片段与 MIDI 符号分析；建设教材版本映射、教师审核和数据保留机制。</p></article><article><span>第三阶段 · 规模化服务</span><b>安全审查与并发扩展</b><p>Socket.IO Redis 适配器与任务队列；权限审计、家校授权与数据删除；模型服务代理、限流、脱敏和可追溯引用。</p></article></div><p class="metric-method-note">当前作品与报告以文本、旋律格及过程日志作可解释的形成性观察。音频风格识别、自动和声与专业 MIDI 评分仍需后续模型验证，界面不会把这些尚未接入的能力标成已完成。</p></section>`;
}

function renderSettings() {
  const enrollment = state.user.role === 'student' ? `<section class="content-panel class-enrollment-panel"><div class="section-head"><div><span class="section-kicker">MY CLASSROOMS</span><h2>班级选择与加入</h2></div></div><div class="element-tags">${state.overview.classes.map((item) => `<span>${escapeHTML(item.name)} · ${escapeHTML(item.grade)}</span>`).join('') || '<span>尚未加入班级</span>'}</div><form class="inline-create-form" data-form="enroll-class"><div><label>选择班级</label><select name="classId" required><option value="">选择老师创建的班级</option>${state.publicClasses.filter((item) => !state.user.classIds.includes(item.id)).map((item) => `<option value="${escapeHTML(item.id)}">${escapeHTML(item.name)} · ${escapeHTML(item.grade)} · ${escapeHTML(item.teacherName)}</option>`).join('')}</select></div><div><label>长期班级专属码</label><input name="classCode" placeholder="老师分享的 6 位码" maxlength="6" required /></div><button class="button-soft">加入班级 +</button></form></section>` : '';
  return `${pageIntro('ACCOUNT & PRIVACY', '账号与安全', `你的账号属于“${roleNames[state.user.role]}”。可以随时修改登录密码或安全退出。`)}${enrollment}
    <div class="settings-grid"><section class="content-panel account-card"><div class="large-avatar">${initials(state.user.name)}</div><span class="section-kicker">CURRENT ACCOUNT</span><h2>${escapeHTML(state.user.name)}</h2><p>${escapeHTML(state.user.username)}</p><span class="account-role-pill">${roleNames[state.user.role]}</span></section><section class="content-panel"><div class="section-head"><div><span class="section-kicker">PASSWORD & SESSION</span><h2>登录安全</h2></div><span class="section-mark">◈</span></div><p class="aside-copy">密码使用 scrypt 单向加密保存。平台不会提供所有人共用的初始密码；注册时设置的密码可以在这里修改。</p><button class="button-primary" data-action="change-password">修改密码 <span>↗</span></button><button class="button-soft danger-soft" data-action="logout">退出当前账号</button></section></div>
    <section class="content-panel privacy-card"><span>◈</span><div><b>未成年人数据保护设计</b><p>课堂只记录必要的账号、班级、活动类型和作品内容。AI 对话默认使用本地音乐引导；管理员配置并启用云端模型后，学生主动发送的提问才会传送给模型服务。麦克风练习在本地设备分析音量，不会自动上传音频。</p></div></section>`;
}

function renderListening() {
  return `<div class="workspace-topline"><div><span class="activity-index">01</span><span class="section-kicker">LISTEN & NOTICE</span></div><span class="soft-badge">聆听一次 · 发现一个线索</span></div><h2>如果旋律是一段风景，你听见了什么？</h2><p class="workspace-lede">先播放一小段旋律，再听听它是向上还是向下、哪里停了一停。没有唯一答案。</p><div class="listen-player"><button class="round-play" data-action="play-listening" aria-label="播放聆听示例">▶</button><div class="waveform" aria-hidden="true">${Array.from({ length: 39 }, (_, i) => `<i style="--bar:${18 + ((i * 17 + 11) % 34)}px"></i>`).join('')}</div><span>00:06</span></div><div class="listening-question"><b>你注意到旋律怎样移动？</b><div class="choice-row"><button data-action="listen-answer" data-answer="rise">逐渐升高 ↑</button><button data-action="listen-answer" data-answer="fall">逐渐降低 ↓</button><button data-action="listen-answer" data-answer="repeat">有重复音 →</button></div><p id="listen-feedback" class="feedback-line">听完后选一个观察，也可以告诉豆芽AI你的想象。</p></div><div class="reflection-box"><label for="listen-reflection">我的想象与线索</label><textarea id="listen-reflection" maxlength="800" rows="3" placeholder="这段声音让我想到……我听见音高……"></textarea><button class="button-primary compact" data-action="save-reflection">保存聆听笔记 ↗</button></div>`;
}

function renderPerformance() {
  return `<div class="workspace-topline"><div><span class="activity-index">02</span><span class="section-kicker">PERFORM & RESPOND</span></div><span class="soft-badge">浏览器本地声音引擎</span></div><h2>用自己的声音回应音乐</h2><p class="workspace-lede">播放一段简单伴奏，用人声、乐器或身体打击来回应。麦克风只在本地显示音量，不会自动上传录音。</p><div class="perform-stage"><div class="perform-orbit"><span class="orbit-note">♫</span><span class="orbit-ring"></span><span class="orbit-ring ring-two"></span></div><div><b>跟着节拍，试一个自己的回应</b><small id="perform-status">选择伴奏情绪，点击开始</small></div></div><div class="performance-controls"><label>伴奏感觉<select id="performance-mood"><option value="gentle">轻柔流动</option><option value="playful">轻快跳跃</option><option value="steady">稳定行进</option></select></label><button class="button-primary compact" data-action="play-accompaniment">▶ 播放伴奏</button><button class="button-soft" data-action="record-audio">● 开始麦克风练习</button></div><div class="local-audio-meter"><span>本地音量</span><div><i id="audio-meter"></i></div><small>声音不会离开当前设备</small></div><div id="recording-tools" class="recording-tools hidden"><audio id="recording-preview" controls></audio><button class="button-soft" data-action="download-audio">下载我的表演</button></div><div class="performance-prompt"><b>改变一个表演要素</b><div class="choice-row"><button data-action="perform-choice" data-choice="强弱">力度：渐强 / 渐弱</button><button data-action="perform-choice" data-choice="音色">音色：明亮 / 柔和</button><button data-action="perform-choice" data-choice="速度">速度：舒展 / 活泼</button></div><p id="performance-feedback" class="feedback-line">试着演奏两种版本，听听哪个更接近你的想象。</p></div>`;
}

function randomMotif() {
  const candidates = [60, 62, 64, 67, 69];
  return Array.from({ length: 8 }, (_, i) => i % 4 === 0 || Math.random() > 0.35 ? candidates[Math.floor(Math.random() * candidates.length)] : null);
}

function renderImprovGrid(pattern = state.improvPattern ?? randomMotif()) {
  state.improvPattern = pattern;
  const names = ['C', 'D', 'E', 'G', 'A'];
  return `<div class="motif-grid">${names.map((name, row) => `<div class="motif-row"><span>${name}4</span><div>${Array.from({ length: 8 }, (_, step) => `<button type="button" class="motif-cell ${pattern[step] === 60 + [0, 2, 4, 7, 9][row] ? 'selected' : ''}" data-action="toggle-improv" data-step="${step}" data-note="${60 + [0, 2, 4, 7, 9][row]}" aria-label="${name}4 第${step + 1}拍"></button>`).join('')}</div></div>`).join('')}</div>`;
}

function renderImprovisation() {
  return `<div class="workspace-topline"><div><span class="activity-index">03</span><span class="section-kicker">IMPROVISE & TRANSFORM</span></div><span class="soft-badge">五声音组 · 八拍</span></div><h2>给一个动机，找一个新的方向</h2><p class="workspace-lede">点击音格加入音符。先听一遍，再做一次自己的变化：重复、模进或改变节奏。</p><div class="improv-toolbar"><button class="button-primary compact" data-action="play-improv">▶ 播放动机</button><button class="button-soft" data-action="new-improv">生成一个起点 ✧</button><button class="button-soft" data-action="save-improv">保存这个动机</button><span>每列一拍 · 速度 ♩ = 88</span></div>${renderImprovGrid()}<div class="variation-prompts"><button data-action="vary-improv" data-variation="模进">试试模进 ↗</button><button data-action="vary-improv" data-variation="节奏">改变节奏 ↗</button><button data-action="vary-improv" data-variation="结尾">换一个结尾 ↗</button></div><p class="feedback-line" id="improv-feedback">你的选择就是音乐的一部分。点击空格改变它，再试听差异。</p>`;
}

function defaultTracks() {
  return [
    { name: '旋律', color: 'mint', notes: [60, null, 62, null, 64, null, 67, null] },
    { name: '低音', color: 'peach', notes: [48, null, null, null, 55, null, null, null] },
    { name: '节奏', color: 'blue', notes: [null, 36, null, 36, null, 36, null, 36] },
  ];
}

function renderComposer() {
  state.grid ??= defaultTracks();
  const steps = Array.from({ length: 8 }, (_, index) => `<span>${index + 1}</span>`).join('');
  const tracks = state.grid.map((track, row) => `<div class="daw-track"><span class="track-name track-${track.color}">${escapeHTML(track.name)}</span><div class="track-steps">${track.notes.map((note, index) => `<button class="daw-step ${note ? `on step-${track.color}` : ''}" data-action="toggle-step" data-track="${row}" data-step="${index}" aria-label="${escapeHTML(track.name)}第${index + 1}拍 ${note ? '有音符' : '空'}"></button>`).join('')}</div><button class="track-mute" data-action="clear-track" data-track="${row}">清除</button></div>`).join('');
  return `<div class="workspace-topline"><div><span class="activity-index">04</span><span class="section-kicker">COMPOSE & KEEP</span></div><span class="soft-badge">三轨旋律工坊</span></div><h2>把灵感排成一段可以播放的音乐</h2><p class="workspace-lede">在旋律、低音和节奏轨道上点选音符。试听、修改，满意后保存草图或导出标准 MIDI 文件。</p><div class="daw-shell"><div class="daw-toolbar"><div><span class="daw-led"></span><b>豆芽简易音序器</b><small>4 小节 · 五声音阶</small></div><div><button class="button-primary compact" data-action="play-composition">▶ 播放</button><button class="button-soft compact" data-action="download-midi">导出 MIDI ↓</button></div></div><div class="daw-ruler"><span>声部</span><div class="track-steps">${steps}</div><span></span></div>${tracks}<div class="daw-bottom"><label>速度 <input id="composer-tempo" type="range" min="60" max="132" value="88" /><b id="tempo-value">88</b> BPM</label><button class="text-action" data-action="regenerate-grid">换一组起点 ✧</button></div></div><div class="save-composition-row"><label>作品名称<input id="composition-title" maxlength="100" placeholder="给这段旋律取个名字" value="我的旋律草图" /></label><button class="button-primary" data-action="save-composition">保存到作品集 ↗</button></div><p id="midi-status" class="feedback-line">使用浏览器 Web Audio 播放。可连接 MIDI 键盘输入音符，或导出为 MIDI 在其他软件中继续编辑。</p>`;
}

async function navigate(view) {
  if (view === 'practice') state.activeAssignment ??= null;
  state.view = view;
  if (view === 'insights' && state.user.role !== 'student') state.insights = await api('/api/insights').catch(() => null);
  if (view === 'report' && state.user.role === 'student') state.report = await api('/api/report').catch(() => null);
  if (view === 'portfolio') state.portfolio = await api('/api/portfolio').catch(() => state.portfolio);
  if (view === 'classroom') await refreshPortal().catch(() => {});
  renderPortal();
}

function setModule(module) {
  if (!moduleNames[module]) return;
  state.module = module;
  state.activeAssignment = state.activeAssignment?.module === module ? state.activeAssignment : null;
  api('/api/practice-log', { method: 'POST', body: { module, action: 'open', classId: state.user.activeClassId } }).catch(() => {});
  renderPortal();
}

function getAudioContext() {
  if (!state.audio) state.audio = new (window.AudioContext || window.webkitAudioContext)();
  if (state.audio.state === 'suspended') state.audio.resume();
  return state.audio;
}

function playNote(midi, at = 0, duration = 0.25, wave = 'sine', volume = 0.18) {
  const context = getAudioContext();
  const start = context.currentTime + at;
  const oscillator = context.createOscillator();
  const gain = context.createGain();
  oscillator.type = wave;
  oscillator.frequency.value = 440 * (2 ** ((midi - 69) / 12));
  gain.gain.setValueAtTime(0.0001, start);
  gain.gain.exponentialRampToValueAtTime(volume, start + 0.02);
  gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
  oscillator.connect(gain).connect(context.destination);
  oscillator.start(start);
  oscillator.stop(start + duration + 0.02);
}

function playNotes(notes, tempo = 88, durationBeats = 0.5) {
  const beat = 60 / tempo;
  notes.forEach((note, index) => { if (note) playNote(note, index * beat * durationBeats, beat * durationBeats * 0.85, index % 2 ? 'triangle' : 'sine'); });
}

function logAction(module, action) {
  api('/api/practice-log', { method: 'POST', body: { module, action, classId: state.user.activeClassId } }).catch(() => {});
}

async function connectToSession(idOrCode) {
  if (!socket.connected) socket.connect();
  if (!socket.connected) await new Promise((resolve) => socket.once('connect', resolve));
  return new Promise((resolve) => socket.emit('session:join', { code: idOrCode }, (result) => {
    if (!result?.ok) { showToast(result?.error || '无法加入课堂'); return resolve(false); }
    state.live = result.state;
    sessionStorage.setItem('douyai-session', state.live.id);
    state.view = 'classroom';
    renderPortal();
    showToast(`已进入「${state.live.title}」`);
    resolve(true);
  }));
}

async function sendCoach(message) {
  const prompt = message.trim();
  if (!prompt) return;
  const history = state.chat.filter((item) => item.content !== '我来陪你听一听这个想法…').slice(-8);
  state.chat.push({ role: 'user', content: prompt });
  state.chat.push({ role: 'assistant', content: '我来陪你听一听这个想法…' });
  if (state.chat.length > 12) state.chat = state.chat.slice(-12);
  renderPortal();
  const messages = $('#coach-messages');
  if (messages) messages.scrollTop = messages.scrollHeight;
  try {
    const result = await api('/api/assistant/chat', { method: 'POST', body: { message: prompt, history, module: state.module, knowledgeIds: state.live?.knowledgeIds ?? [] } });
    const last = state.chat.at(-1);
    if (last?.role === 'assistant') last.content = result.reply;
    state.aiSource = result.source === 'qwen' ? `豆芽AI · ${result.model} · 回应基于教材知识库` : '本地音乐创作引导 · 配置模型后可启用增强对话';
    renderPortal();
    const hint = $('.coach-model-hint');
    if (hint) hint.textContent = state.aiSource;
    const scroll = $('#coach-messages'); if (scroll) scroll.scrollTop = scroll.scrollHeight;
  } catch (error) {
    const last = state.chat.at(-1);
    if (last) last.content = `刚才没能连上引导服务。你可以先试试：用三个音哼出一个上行的动机，再改变最后一个音。`;
    state.aiSource = '本地音乐创作引导';
    renderPortal();
    showToast(error.message);
  }
}

function selectedCheckboxes(form, name) { return $$(`input[name="${name}"]:checked`, form).map((input) => input.value); }

async function handlePortalSubmit(event) {
  const form = event.target.closest('[data-form]');
  if (!form) return;
  event.preventDefault();
  const data = new FormData(form);
  const values = Object.fromEntries(data.entries());
  const button = form.querySelector('[type=submit]');
  if (button) button.disabled = true;
  try {
    switch (form.dataset.form) {
      case 'create-class': {
        await api('/api/classes', { method: 'POST', body: values });
        await refreshPortal(); await loadPublicClasses(); renderPortal(); showToast('班级已创建，新的长期班级专属码已生成。'); break;
      }
      case 'enroll-class': {
        const result = await api('/api/classes/join', { method: 'POST', body: { classId: values.classId, classCode: values.classCode.trim().toUpperCase() } });
        state.user = result.user; await refreshPortal(); renderPortal(); showToast(`已加入「${result.classroom.name}」。`); break;
      }
      case 'save-lesson': {
        const phases = ['listening', 'performance', 'improv', 'composition'].filter((module) => form.elements[`module-${module}`].checked);
        if (phases.length < 2) throw new Error('至少选择两个课堂活动环节。');
        await api('/api/lessons', { method: 'POST', body: { title: values.title, grade: values.grade, objective: values.objective, knowledgeIds: selectedCheckboxes(form, 'knowledgeIds'), steps: Object.fromEntries(phases.map((module) => [module, moduleNames[module]])) } });
        await refreshPortal(); renderPortal(); showToast('课程设计已保存，可以带入实时课堂。'); break;
      }
      case 'save-knowledge': {
        const textContent = values.content;
        await api('/api/knowledge', { method: 'POST', body: { title: values.title, textbook: values.textbook, grade: values.grade, stage: values.stage, unit: values.unit, content: textContent, objectives: values.objectives.split('\n').map((item) => item.trim()).filter(Boolean), elements: values.elements.split(/[，,、]/).map((item) => item.trim()).filter(Boolean), sourceName: values.sourceName || form.elements.sourceFile.files[0]?.name || '教师录入' } });
        await refreshPortal(); renderPortal(); showToast('教材文本与教学目标已加入知识底座。'); break;
      }
      case 'create-session': {
        const result = await api('/api/sessions', { method: 'POST', body: values });
        await refreshPortal();
        await connectToSession(result.session.id); break;
      }
      case 'publish-assignment': {
        await api('/api/assignments', { method: 'POST', body: { ...values, sessionId: state.live?.id } });
        showToast('创作任务已发送到学生实践空间。'); break;
      }
      case 'join-session': await connectToSession(values.code.toUpperCase()); break;
      case 'chat': {
        const input = form.elements.message;
        const prompt = input.value;
        input.value = '';
        await sendCoach(prompt); break;
      }
      case 'password': {
        await api('/api/password', { method: 'POST', body: values });
        $('#password-dialog').close(); form.reset(); showToast('登录密码已更新。'); break;
      }
      default: break;
    }
  } catch (error) {
    showToast(error.message);
  } finally {
    if (button?.isConnected) button.disabled = false;
  }
}

async function createSessionForLesson(lessonId) {
  if (!state.overview.classes.length) return showToast('先创建一个班级，再开启课堂。');
  const lesson = state.lessons.find((item) => item.id === lessonId);
  state.view = 'classroom';
  renderPortal();
  const select = $('[name="lessonId"]');
  if (select) select.value = lessonId;
  const title = $('[name="title"]');
  if (title && lesson) title.value = lesson.title;
  const classId = $('[name="classId"]');
  if (classId) classId.value = state.overview.classes[0].id;
}

async function toggleHand() {
  if (!socket.connected || !state.live) return showToast('请先进入实时课堂。');
  socket.emit('session:hand', {}, (result) => {
    if (!result?.ok) return showToast(result?.error || '举手失败');
    showToast(result.raised ? '已举手，老师能看到你。' : '已放下手。');
  });
}

function startTaskFromButton(button) {
  state.activeAssignment = { id: button.dataset.id, sessionId: button.dataset.session, module: button.dataset.module, title: button.dataset.title, description: button.dataset.description };
  state.module = state.activeAssignment.module;
  navigate('practice');
}

async function saveTaskSubmission() {
  const content = $('#task-submission')?.value.trim();
  if (!content) return showToast('写下一点自己的音乐尝试再提交。');
  const active = state.activeAssignment;
  if (!active) return showToast('这不是课堂任务，可以保存到个人作品集。');
  try {
    await api('/api/submissions', { method: 'POST', body: { sessionId: active.sessionId, assignmentId: active.id, module: state.module, content, payload: state.module === 'composition' ? state.grid : state.module === 'improv' ? state.improvPattern : null } });
    await refreshPortal();
    showToast('作品已提交，课堂作品集和学情记录已更新。');
  } catch (error) { showToast(error.message); }
}

async function savePortfolio() {
  const title = $('#composition-title')?.value.trim() || `${moduleNames[state.module]}练习`;
  const payload = state.module === 'composition' ? state.grid : state.module === 'improv' ? state.improvPattern : { note: $('#listen-reflection')?.value ?? '' };
  await api('/api/portfolio', { method: 'POST', body: { title, module: state.module, payload } });
  state.portfolio = await api('/api/portfolio');
  showToast('创作草图已保存到作品集。');
}

function xmlMidi() {
  const tracks = state.grid ?? defaultTracks();
  const events = [];
  tracks.forEach((track, channel) => track.notes.forEach((note, step) => {
    if (!note) return;
    const tick = step * 120;
    events.push({ tick, bytes: [0x90 | channel, note, 92] }, { tick: tick + 100, bytes: [0x80 | channel, note, 0] });
  }));
  events.sort((a, b) => a.tick - b.tick || a.bytes[0] - b.bytes[0]);
  const vlq = (number) => {
    let value = number & 0x7f;
    while ((number >>= 7)) value = (value << 8) | ((number & 0x7f) | 0x80);
    const output = [];
    while (true) { output.push(value & 0xff); if (value & 0x80) value >>= 8; else break; }
    return output;
  };
  const body = [0x00, 0xff, 0x51, 0x03, 0x07, 0xa1, 0x20];
  let prior = 0;
  for (const event of events) { body.push(...vlq(event.tick - prior), ...event.bytes); prior = event.tick; }
  body.push(0x00, 0xff, 0x2f, 0x00);
  const header = [0x4d, 0x54, 0x68, 0x64, 0, 0, 0, 6, 0, 0, 0, 1, 1, 0xe0];
  const trackChunk = [0x4d, 0x54, 0x72, 0x6b, (body.length >>> 24) & 255, (body.length >>> 16) & 255, (body.length >>> 8) & 255, body.length & 255, ...body];
  return new Blob([new Uint8Array([...header, ...trackChunk])], { type: 'audio/midi' });
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url; link.download = filename; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function startMicPractice() {
  if (state.record?.recorder?.state === 'recording') {
    state.record.recorder.stop();
    return;
  }
  if (!navigator.mediaDevices?.getUserMedia) return showToast('当前浏览器不支持麦克风。请使用安全连接或下载 MIDI 草图。');
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const context = getAudioContext();
    const source = context.createMediaStreamSource(stream);
    const analyser = context.createAnalyser(); analyser.fftSize = 256; source.connect(analyser);
    const recorder = new MediaRecorder(stream);
    const parts = [];
    recorder.ondataavailable = (event) => { if (event.data.size) parts.push(event.data); };
    recorder.onstop = () => {
      cancelAnimationFrame(state.record.animation);
      stream.getTracks().forEach((track) => track.stop());
      const blob = new Blob(parts, { type: recorder.mimeType || 'audio/webm' });
      const audio = $('#recording-preview');
      if (audio) { state.record.audioUrl = URL.createObjectURL(blob); audio.src = state.record.audioUrl; }
      $('#recording-tools')?.classList.remove('hidden');
      $('#perform-status').textContent = '练习已结束，可在本地试听或下载';
      showToast('练习音频只保存在当前页面，下载后可自行保存。');
    };
    recorder.start();
    state.record = { recorder, stream, analyser, source, animation: null, audioUrl: null };
    const meter = $('#audio-meter');
    const data = new Uint8Array(analyser.frequencyBinCount);
    const draw = () => {
      if (!state.record || recorder.state !== 'recording') return;
      analyser.getByteTimeDomainData(data);
      const energy = data.reduce((sum, value) => sum + Math.abs(value - 128), 0) / data.length;
      if (meter) meter.style.width = `${Math.min(100, Math.round(energy * 5))}%`;
      state.record.animation = requestAnimationFrame(draw);
    };
    draw();
    $('#perform-status').textContent = '正在本地练习…点击按钮结束并回听';
    const button = $('[data-action="record-audio"]');
    if (button) button.textContent = '■ 结束并回听';
  } catch {
    showToast('没有麦克风权限也没关系，可以用 Web Audio 或 MIDI 继续创作。');
  }
}

async function connectMidi() {
  if (!navigator.requestMIDIAccess) return showToast('此浏览器暂不支持 Web MIDI，可直接使用屏幕音符格。');
  try {
    state.midiAccess = await navigator.requestMIDIAccess();
    for (const input of state.midiAccess.inputs.values()) input.onmidimessage = (event) => {
      const [status, note, velocity] = event.data;
      if ((status & 0xf0) !== 0x90 || velocity === 0) return;
      state.grid ??= defaultTracks();
      const nextStep = state.grid[0].notes.findIndex((item) => !item);
      state.grid[0].notes[nextStep < 0 ? 7 : nextStep] = note;
      if (state.view === 'practice' && state.module === 'composition') renderPortal();
      playNote(note, 0, 0.35, 'triangle', 0.22);
    };
    showToast('MIDI 键盘已连接。弹奏的音符会加入旋律轨。');
    if (state.view === 'practice') renderPortal();
  } catch { showToast('无法连接 MIDI 设备。'); }
}

async function handleAction(event) {
  const button = event.target.closest('[data-action]');
  if (!button) return;
  const action = button.dataset.action;
  switch (action) {
    case 'logout': await api('/api/logout', { method: 'POST', body: {} }).catch(() => {}); socket.disconnect(); state.user = null; state.live = null; state.chat = []; $('#portal-screen').classList.add('hidden'); $('#home-screen').classList.remove('hidden'); await loadPublicClasses(); break;
    case 'go-home': event.preventDefault(); await navigate('overview'); break;
    case 'copy': await navigator.clipboard?.writeText(button.dataset.copy).then(() => showToast('已复制到剪贴板。')).catch(() => showToast(`班级码：${button.dataset.copy}`)); break;
    case 'show-class-codes': showToast('长期班级专属码展示在页面下方。'); break;
    case 'open-session': await connectToSession(button.dataset.id); break;
    case 'join-session': await connectToSession(button.dataset.id); break;
    case 'leave-session':
      if (socket.connected) socket.emit('session:leave', {}, () => {});
      state.live = null; sessionStorage.removeItem('douyai-session'); await refreshPortal(); renderPortal(); break;
    case 'toggle-hand': await toggleHand(); break;
    case 'focus-import': $('#knowledge-import')?.scrollIntoView({ behavior: 'smooth', block: 'center' }); $('input[name="title"]', $('#knowledge-import'))?.focus(); break;
    case 'use-lesson': await createSessionForLesson(button.dataset.id); showToast('已选好课程设计，选择班级后开始实时课堂。'); break;
    case 'start-task': startTaskFromButton(button); break;
    case 'clear-task': state.activeAssignment = null; renderPortal(); break;
    case 'start-recommended': state.activeAssignment = null; state.module = 'listening'; await navigate('practice'); break;
    case 'change-password': $('#password-dialog').showModal(); break;
    case 'chat-suggestion': await sendCoach(button.dataset.message); break;
    case 'play-listening': playNotes([60, 62, 64, 67, 69, 67, 64, 62], 88, 0.5); logAction('listening', 'play'); break;
    case 'listen-answer': {
      const feedback = $('#listen-feedback');
      const correct = button.dataset.answer === 'rise';
      feedback.textContent = correct ? '你发现了旋律上行的线索。再听一次：音程跳跃时，画面感有什么变化？' : '这是一个很有意思的观察。再听听开头几个音，注意它们的方向和重复。';
      $$('.choice-row button', button.parentElement).forEach((item) => item.classList.toggle('selected', item === button));
      logAction('listening', correct ? 'notice-upward-contour' : 'notice-alternative-contour'); break;
    }
    case 'save-reflection': {
      const reflection = $('#listen-reflection')?.value.trim();
      if (!reflection) return showToast('先写下一条聆听发现或想象。');
      await api('/api/portfolio', { method: 'POST', body: { title: '我的创造性聆听笔记', module: 'listening', payload: { reflection } } });
      state.portfolio = await api('/api/portfolio'); showToast('聆听笔记已保存到作品集。'); break;
    }
    case 'play-accompaniment': {
      const mood = $('#performance-mood')?.value ?? 'gentle';
      const notes = mood === 'playful' ? [60, 64, 67, 64, 62, 65, 69, 65] : mood === 'steady' ? [48, 55, 48, 55, 50, 57, 50, 57] : [48, 55, 52, 59, 48, 55, 52, 59];
      playNotes(notes, mood === 'playful' ? 112 : 82, 0.8);
      $('#perform-status').textContent = '伴奏正在播放：试着用人声、乐器或身体打击回应。'; logAction('performance', `play-${mood}`); break;
    }
    case 'record-audio': await startMicPractice(); break;
    case 'download-audio': {
      const audio = $('#recording-preview');
      if (!audio?.src) return showToast('还没有可以下载的练习音频。');
      const blob = await fetch(audio.src).then((response) => response.blob()); downloadBlob(blob, 'douya-ai-performance.webm'); break;
    }
    case 'perform-choice': $('#performance-feedback').textContent = `你选择了“${button.dataset.choice}”。演奏两个不同版本，再说说它怎样改变了音乐情绪。`; logAction('performance', `choose-${button.dataset.choice}`); break;
    case 'toggle-improv': {
      const step = Number(button.dataset.step), note = Number(button.dataset.note);
      state.improvPattern ??= randomMotif();
      state.improvPattern[step] = state.improvPattern[step] === note ? null : note;
      renderPortal(); playNote(note, 0, 0.2, 'triangle'); logAction('improv', 'edit-note'); break;
    }
    case 'play-improv': playNotes(state.improvPattern ?? randomMotif(), 88, 0.5); logAction('improv', 'play'); break;
    case 'new-improv': state.improvPattern = randomMotif(); renderPortal(); showToast('有了一个新的声音起点。'); logAction('improv', 'generate-motif'); break;
    case 'vary-improv': {
      const variation = button.dataset.variation;
      const pattern = state.improvPattern ?? randomMotif();
      if (variation === '模进') state.improvPattern = pattern.map((note) => note ? note + 2 : null);
      if (variation === '节奏') state.improvPattern = pattern.map((note, index) => index % 2 ? null : note);
      if (variation === '结尾') state.improvPattern = [...pattern.slice(0, 6), 62, 60];
      renderPortal(); $('#improv-feedback').textContent = `已尝试${variation}。听听变化怎样影响了动机，再决定保留还是继续修改。`; logAction('improv', `vary-${variation}`); break;
    }
    case 'save-improv': await savePortfolio(); break;
    case 'toggle-step': {
      const track = Number(button.dataset.track), step = Number(button.dataset.step);
      state.grid ??= defaultTracks();
      const baseNotes = [[60, 62, 64, 67, 69, 72, 74, 76], [48, 48, 55, 55, 50, 50, 57, 57], [36, 36, 36, 36, 38, 38, 38, 38]];
      state.grid[track].notes[step] = state.grid[track].notes[step] ? null : baseNotes[track][step];
      renderPortal(); playNote(baseNotes[track][step], 0, 0.17, track === 1 ? 'triangle' : 'sine', 0.12); logAction('composition', 'edit-step'); break;
    }
    case 'clear-track': state.grid ??= defaultTracks(); state.grid[Number(button.dataset.track)].notes = Array(8).fill(null); renderPortal(); logAction('composition', 'clear-track'); break;
    case 'play-composition': {
      const tempo = Number($('#composer-tempo')?.value || 88);
      state.grid ??= defaultTracks();
      state.grid.forEach((track) => track.notes.forEach((note, index) => { if (note) playNote(note, index * (60 / tempo) * 0.5, (60 / tempo) * 0.38, track.color === 'peach' ? 'triangle' : track.color === 'blue' ? 'square' : 'sine', track.color === 'blue' ? 0.06 : 0.12); }));
      logAction('composition', 'play'); break;
    }
    case 'regenerate-grid': state.grid = defaultTracks().map((track, i) => ({ ...track, notes: track.notes.map((note, step) => Math.random() < (i === 0 ? .58 : .32) ? note ?? (i === 0 ? [60, 62, 64, 67, 69, 72, 74, 76][step] : [48, 48, 55, 55, 50, 50, 57, 57][step]) : null) })); renderPortal(); showToast('换了一种声音组合，继续试听和修改。'); logAction('composition', 'regenerate'); break;
    case 'download-midi': downloadBlob(xmlMidi(), 'douya-ai-melody.mid'); showToast('MIDI 文件已导出。'); logAction('composition', 'export-midi'); break;
    case 'save-composition': await savePortfolio(); break;
    case 'connect-midi': await connectMidi(); break;
    case 'submit-practice': await saveTaskSubmission(); break;
    case 'save-free-composition': await savePortfolio(); break;
    default: break;
  }
}

function practiceAssignmentSubmit() {
  if (!state.activeAssignment) return '';
  return `<section class="assignment-submit-box"><span class="section-kicker">CLASS TASK · YOUR RESPONSE</span><h3>把这次尝试交给老师</h3><p>写下你作了什么选择、听见了什么变化。你可以之后继续修改。</p><textarea id="task-submission" maxlength="4000" rows="4" placeholder="我先尝试了……后来把……改成……，听起来……"></textarea><button class="button-primary" data-action="submit-practice">提交作品并同步课堂 ↗</button></section>`;
}

function renderPractice() {
  const assigned = state.activeAssignment;
  const module = state.module;
  const relevant = state.knowledge.filter((item) => ({ listening: /聆听|要素/, performance: /表演|聆听/, improv: /即兴|动机/, composition: /旋律|创作/ }[module]).test(`${item.title} ${item.unit}`)).slice(0, 2);
  const moduleTabs = Object.entries(moduleNames).map(([key, label]) => `<button type="button" class="practice-tab ${module === key ? 'active' : ''}" data-module="${key}"><span>${moduleIcons[key]}</span><b>${label}</b><small>${{ listening: '听见线索', performance: '表达声音', improv: '即兴变化', composition: '发展作品' }[key]}</small></button>`).join('');
  let workspace = '';
  if (module === 'listening') workspace = renderListening();
  if (module === 'performance') workspace = renderPerformance();
  if (module === 'improv') workspace = renderImprovisation();
  if (module === 'composition') workspace = renderComposer();
  return `${pageIntro('STUDENT MUSIC LAB', '音乐创造实践', '同一创作空间，四种可以来回切换的探索方式。先试听、再尝试，留下自己的声音。', `<button class="button-soft" data-action="connect-midi">${state.midiAccess ? 'MIDI 已连接' : '连接 MIDI 键盘'}</button>`)}
    <div class="practice-layout"><div class="practice-main"><nav class="practice-module-tabs" aria-label="选择实践模块">${moduleTabs}</nav>${assigned ? `<section class="assigned-challenge"><span class="task-module-tag">课堂任务 · ${moduleNames[assigned.module]}</span><button data-action="clear-task" aria-label="退出任务">×</button><b>${escapeHTML(assigned.title)}</b><p>${escapeHTML(assigned.description)}</p></section>` : ''}<section class="practice-workspace">${workspace}</section>${practiceAssignmentSubmit()}<div class="practice-knowledge"><span class="knowledge-cue">▤ 教材知识提示</span>${relevant.length ? relevant.map((item) => `<article><b>${escapeHTML(item.title)}</b><p>${escapeHTML(item.content.slice(0, 280))}${item.content.length > 280 ? '…' : ''}</p><small>${escapeHTML(item.textbook)} · ${escapeHTML(item.unit)}</small></article>`).join('') : '<p>上传教材并关联本次课程后，知识提示会按活动内容更新。</p>'}</div></div><aside class="practice-aside"><section class="ai-coach-card"><div class="ai-coach-head"><span class="ai-coach-avatar">✳</span><span><b>豆芽AI</b><small>你的音乐创造伙伴</small></span><i class="ai-status-dot"></i></div><div class="ai-safety-chip">循序引导 · 保留你的创作选择</div><div id="coach-messages" class="coach-messages">${state.chat.map((message) => `<div class="coach-message ${message.role === 'user' ? 'from-student' : 'from-ai'}"><span>${message.role === 'user' ? '我' : '芽'}</span><p>${escapeHTML(message.content)}</p></div>`).join('') || '<div class="coach-message from-ai"><span>芽</span><p>嗨，我是豆芽AI。你想让这段音乐像什么？可以从一个画面、心情或刚才听到的声音开始。我们一步一步把想法变成旋律。</p></div>'}</div><div class="coach-suggestions"><button data-action="chat-suggestion" data-message="我不知道怎么开始，可以给我一个小提示吗？">我不知道怎么开始</button><button data-action="chat-suggestion" data-message="怎样用几个音表现一种心情？">给我旋律灵感</button></div><form class="coach-form" data-form="chat"><textarea name="message" rows="2" maxlength="700" placeholder="说说你的想法，不必担心对错…" required></textarea><button aria-label="发送给豆芽AI">↑</button></form><small class="coach-model-hint">${escapeHTML(state.aiSource)} · 对话默认不保存</small></section><section class="practice-save-card"><span>✧</span><b>灵感值得留下</b><p>完成任务会同步到课堂。自由创作可保存到个人作品集。</p><button class="text-action" data-view="portfolio">查看我的作品 →</button></section></aside></div>`;
}

document.addEventListener('submit', (event) => {
  if (event.target.id === 'auth-form') return handleAuth(event);
  return handlePortalSubmit(event);
});

document.addEventListener('click', async (event) => {
  const moduleButton = event.target.closest('[data-module]');
  if (moduleButton && moduleButton.closest('#portal-content')) { setModule(moduleButton.dataset.module); return; }
  const viewButton = event.target.closest('[data-view]');
  if (viewButton) { await navigate(viewButton.dataset.view); return; }
  await handleAction(event);
});

document.addEventListener('change', async (event) => {
  if (event.target.matches('[data-action="read-knowledge-file"]')) {
    const file = event.target.files?.[0];
    if (!file) return;
    if (file.size > 2_000_000) return showToast('文本文件请小于 2MB。');
    if (!/\.(txt|md|csv|json)$/i.test(file.name)) return showToast('目前支持 TXT、Markdown、CSV 和 JSON 文本。');
    const content = await file.text();
    $('#knowledge-content').value = content;
    const title = $('[name="title"]', $('#knowledge-import'));
    if (title && !title.value) title.value = file.name.replace(/\.[^.]+$/, '');
    event.target.closest('form').elements.sourceName = file.name;
    showToast('教材文本已读取到表单，检查标签后保存。');
  }
  if (event.target.id === 'composer-tempo') $('#tempo-value').textContent = event.target.value;
});

socket.on('connect', () => {
  const sessionId = sessionStorage.getItem('douyai-session');
  if (sessionId && state.user) socket.emit('session:join', { sessionId }, (result) => {
    if (result?.ok) { state.live = result.state; if (state.view === 'classroom') renderPortal(); }
    else sessionStorage.removeItem('douyai-session');
  });
});
socket.on('connect_error', () => { if (state.user) showToast('实时连接暂不可用，请刷新后重试。'); });
socket.on('session:update', (session) => {
  if (state.live?.id !== session.id) return;
  state.live = session;
  if (state.view === 'classroom') {
    const scrollTop = $('#portal-content')?.scrollTop ?? 0;
    renderPortal();
    if ($('#portal-content')) $('#portal-content').scrollTop = scrollTop;
  }
});
socket.on('session:ended', () => { state.live = null; sessionStorage.removeItem('douyai-session'); showToast('本节课堂已结束。'); if (state.view === 'classroom') navigate('classroom'); });

$('.role-picker').addEventListener('click', (event) => {
  const button = event.target.closest('[data-role]'); if (button) setEntryRole(button.dataset.role);
});
$('#auth-mode-toggle').addEventListener('click', () => { state.mode = state.mode === 'login' ? 'register' : 'login'; updateAuthForm(); });
$('#password-form').addEventListener('submit', (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const values = Object.fromEntries(new FormData(form));
  api('/api/password', { method: 'POST', body: values }).then(() => { $('#password-dialog').close(); form.reset(); showToast('登录密码已更新。'); }).catch((error) => { $('#password-error').textContent = error.message; });
});

loadPublicClasses();
updateAuthForm();
api('/api/me').then(() => enterPlatform()).catch(() => {});
