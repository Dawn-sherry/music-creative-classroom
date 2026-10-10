import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { createServer } from 'node:http';
import { Server } from 'socket.io';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT) || 3000;
const DATA_FILE = process.env.DOUYAI_DATA_FILE || path.join(ROOT, 'data', 'douyai.json');
const COOKIE_NAME = 'douyai_session';
const SESSION_MS = 1000 * 60 * 60 * 24 * 14;
const scrypt = promisify(crypto.scrypt);
const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, { maxHttpBufferSize: 128_000 });
const socketsBySession = new Map();
const stateChatLimits = new Map();
let store;

const seedKnowledge = [
  {
    id: 'seed-listen', title: '聆听一段音乐：先听见，再想象', stage: '小学 · 初中', grade: '小学高年级—初中', textbook: '豆芽 AI 创作基础知识', unit: '创造性聆听',
    objectives: ['辨认音高、节奏、力度、音色和乐句变化', '用语言、动作或图像表达聆听感受', '从声音线索提出可以继续探索的问题'],
    elements: ['音高', '节奏', '力度', '音色', '乐句'], content: '创造性聆听不是猜出唯一答案。先观察声音的高低、长短、强弱和音色，再想象它像什么、带来怎样的情绪，最后用动作、语言或自己的声音回应。可尝试“听—想—说—再听”四步：第一次捕捉整体感受，第二次找一处具体变化，第三次说明依据，第四次换一种方式表达。', sourceName: '豆芽 AI 创作基础知识', createdBy: '豆芽 AI', createdAt: new Date().toISOString(),
  },
  {
    id: 'seed-melody', title: '旋律动机与乐句：让小想法长成旋律', stage: '小学 · 初中', grade: '小学高年级—初中', textbook: '豆芽 AI 创作基础知识', unit: '旋律编创',
    objectives: ['用少量音符构成可辨认的动机', '通过重复、模进、改变节奏发展动机', '感受乐句的呼吸、停顿和收束'],
    elements: ['音阶', '动机', '重复', '模进', '乐句'], content: '旋律动机是短小、容易记住的声音想法。创作时可以先用三到五个音做一个动机，再选择一种变化：整体升高或降低形成模进，改变节奏，移动起始音，或保留开头并改变结尾。把两个有呼吸感的乐句连起来，留意乐句之间的相似和不同。先哼唱，再尝试记谱或用音块排列。', sourceName: '豆芽 AI 创作基础知识', createdBy: '豆芽 AI', createdAt: new Date().toISOString(),
  },
  {
    id: 'seed-improv', title: '即兴的脚手架：限制带来更多选择', stage: '小学 · 初中', grade: '小学高年级—初中', textbook: '豆芽 AI 创作基础知识', unit: '即兴编创',
    objectives: ['在给定节拍或音组中即兴回应', '尝试节奏、音区与力度的对比', '倾听伙伴并用重复或变化继续音乐'],
    elements: ['节拍', '节奏型', '问答', '音区', '力度'], content: '即兴不等于毫无准备。先设定一个小限制，例如只用五个音、四拍节奏或一种情绪，再用“问句—答句”创造音乐对话。可以重复一个节奏作为共同线索，再改变音高、音区或力度。完成后回听：哪里最有特点？下一次想保留什么、改变什么？', sourceName: '豆芽 AI 创作基础知识', createdBy: '豆芽 AI', createdAt: new Date().toISOString(),
  },
];

function initialStore() {
  return { users: [], classes: [], lessons: [], knowledge: seedKnowledge, liveSessions: [], submissions: [], portfolios: [], practiceLogs: [] };
}

function persist() {
  fs.mkdirSync(path.dirname(DATA_FILE), { recursive: true });
  const tempFile = `${DATA_FILE}.${process.pid}.tmp`;
  fs.writeFileSync(tempFile, JSON.stringify(store, null, 2), { mode: 0o600 });
  fs.renameSync(tempFile, DATA_FILE);
}

function loadStore() {
  try {
    const loaded = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
    const blank = initialStore();
    store = { ...blank, ...loaded };
    let changed = false;
    for (const session of store.liveSessions) {
      if (session.status === 'active') {
        session.status = 'ended';
        session.endedAt = new Date().toISOString();
        changed = true;
      }
    }
    if (changed) persist();
  } catch (error) {
    if (error.code !== 'ENOENT') console.error('Unable to read platform data:', error.message);
    store = initialStore();
  }
}

function text(value, maxLength = 500) {
  return typeof value === 'string' ? value.trim().replace(/\s+/g, ' ').slice(0, maxLength) : '';
}

function codeExists(code) {
  return store.classes.some((item) => item.code === code) || store.liveSessions.some((item) => item.code === code);
}

function uniqueCode() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code;
  do { code = Array.from(crypto.randomBytes(6), (byte) => alphabet[byte % alphabet.length]).join(''); }
  while (codeExists(code));
  return code;
}

function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
  return scrypt(password, salt, 64).then((hash) => ({ salt, hash: hash.toString('hex') }));
}

function cookieSecret() {
  const secretPath = `${DATA_FILE}.cookie-secret`;
  try { return fs.readFileSync(secretPath); }
  catch (error) {
    if (error.code !== 'ENOENT') throw error;
    fs.mkdirSync(path.dirname(secretPath), { recursive: true });
    const secret = crypto.randomBytes(48);
    fs.writeFileSync(secretPath, secret, { mode: 0o600, flag: 'wx' });
    return secret;
  }
}

const secret = cookieSecret();

function sign(payload) {
  const encoded = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const signature = crypto.createHmac('sha256', secret).update(encoded).digest('base64url');
  return `${encoded}.${signature}`;
}

function readCookies(header = '') {
  return Object.fromEntries(header.split(';').map((part) => {
    const separator = part.indexOf('=');
    return separator < 0 ? ['', ''] : [part.slice(0, separator).trim(), decodeURIComponent(part.slice(separator + 1).trim())];
  }).filter(([key]) => key));
}

function verifyToken(token) {
  if (!token) return null;
  const [encoded, signature] = token.split('.');
  if (!encoded || !signature) return null;
  const expected = crypto.createHmac('sha256', secret).update(encoded).digest();
  let provided;
  try { provided = Buffer.from(signature, 'base64url'); } catch { return null; }
  if (provided.length !== expected.length || !crypto.timingSafeEqual(provided, expected)) return null;
  try {
    const payload = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8'));
    if (payload.exp < Date.now()) return null;
    return store.users.find((user) => user.id === payload.uid) ?? null;
  } catch { return null; }
}

function getUser(req) {
  return verifyToken(readCookies(req.headers.cookie)[COOKIE_NAME]);
}

function sendSessionCookie(res, user) {
  const value = sign({ uid: user.id, exp: Date.now() + SESSION_MS });
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
  res.setHeader('Set-Cookie', `${COOKIE_NAME}=${encodeURIComponent(value)}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${Math.floor(SESSION_MS / 1000)}${secure}`);
}

function userView(user) {
  return { id: user.id, name: user.name, username: user.username, role: user.role, classIds: user.classIds ?? [], activeClassId: user.activeClassId ?? user.classIds?.[0] ?? null };
}

function publicClass(classroom) {
  return { id: classroom.id, name: classroom.name, grade: classroom.grade, teacherName: store.users.find((user) => user.id === classroom.teacherId)?.name ?? '授课教师', code: classroom.code };
}

function requireUser(req, res, next) {
  const user = getUser(req);
  if (!user) return res.status(401).json({ error: '请先登录后继续。' });
  req.user = user;
  next();
}

function requireRole(...roles) {
  return (req, res, next) => {
    if (!roles.includes(req.user.role)) return res.status(403).json({ error: '当前账号没有此操作权限。' });
    next();
  };
}

function classOwnedBy(user, classId) {
  return store.classes.find((item) => item.id === classId && item.teacherId === user.id);
}

function classJoinedBy(user, classId) {
  return user.role === 'student' && (user.classIds ?? []).includes(classId);
}

function lessonView(lesson) {
  return { ...lesson, knowledge: lesson.knowledgeIds.map((id) => store.knowledge.find((item) => item.id === id)).filter(Boolean).map(({ id, title, elements }) => ({ id, title, elements })) };
}

function safeKnowledge(item) {
  return { ...item, content: item.content.slice(0, 6000) };
}

function localCoach(message, knowledge = []) {
  const prompt = text(message, 700);
  const mood = /开心|快乐|活泼|轻快|阳光|兴奋/.test(prompt) ? '轻快' : /安静|难过|温柔|夜晚|平静|思念/.test(prompt) ? '安静' : '有故事感';
  const scale = /小调|神秘|夜晚/.test(prompt) ? ['A3', 'C4', 'D4', 'E4', 'G4'] : ['C4', 'D4', 'E4', 'G4', 'A4'];
  const reference = knowledge.find((item) => /旋律|动机|即兴/.test(`${item.title} ${item.unit}`));
  const learned = reference ? `\n\n可以试试知识库里的“${reference.title}”：先从一个短动机开始，再改变节奏或结尾。` : '';
  if (/不会|没想法|没灵感|不知道|怎么开始|卡住/.test(prompt)) {
    return `我们从一个小问题开始：你想让听众听到什么画面？\n\n如果先试一个 ${mood} 的声音，可以用 ${scale.join('—')} 哼出四拍，再把最后一个音换掉，听听情绪有什么变化。先选你喜欢的版本，不必追求标准答案。${learned}\n\n你愿意描述一个画面或心情吗？`;
  }
  if (/节奏|拍子|速度/.test(prompt)) {
    return `我们先用身体找到节奏：试着拍“♩ ♪ ♪ | ♩ ♩”，然后把速度放慢、再加快各一次。保持节奏不变时，你觉得音高该往上还是往下，才能表达“${prompt.slice(0, 45)}”？${learned}`;
  }
  return `我听到你想探索“${prompt.slice(0, 90)}”。试着用 ${scale.join('、')} 做一个短动机，先向上走两步，再回到开头附近；可以加上“♪ ♩ ♪”的节奏，看看是否有 ${mood} 的感觉。\n\n接下来做一个自己的改动：改变一个音、一个节奏或最后的停顿。你最想先尝试哪一种？${learned}`;
}

function lessonKnowledgeContext(ids = []) {
  const selected = new Set(ids.filter((id) => store.knowledge.some((item) => item.id === id)));
  const items = selected.size
    ? store.knowledge.filter((item) => selected.has(item.id))
    : [...store.knowledge.slice().reverse().slice(0, 5), ...store.knowledge.filter((item) => item.id.startsWith('seed-'))];
  return [...new Map(items.map((item) => [item.id, item])).values()].slice(0, 8).map((item) => `${item.title}（${item.unit}）：${item.content.slice(0, 900)}`).join('\n\n');
}

function sessionByCodeOrId(key) {
  return store.liveSessions.find((item) => item.code === text(key, 12).toUpperCase() || item.id === key);
}

function isSessionMember(user, session) {
  const classroom = store.classes.find((item) => item.id === session.classId);
  return classroom && (classroom.teacherId === user.id || classJoinedBy(user, classroom.id));
}

function liveView(session, viewerId) {
  const sockets = [...(socketsBySession.get(session.id) ?? new Map()).entries()];
  const people = new Map();
  const hands = new Set();
  for (const [socketId, user] of sockets) {
    people.set(user.id, { id: user.id, name: user.name, role: user.role });
    const socket = io.sockets.sockets.get(socketId);
    if (socket?.data.raisedHand) hands.add(user.id);
  }
  const viewerIsTeacher = store.classes.find((item) => item.id === session.classId)?.teacherId === viewerId;
  const submissions = store.submissions.filter((item) => item.sessionId === session.id && (viewerIsTeacher || item.studentId === viewerId));
  const classroom = store.classes.find((item) => item.id === session.classId);
  return {
    id: session.id, code: session.code, title: session.title, status: session.status,
    classId: session.classId, className: classroom?.name ?? '', teacherName: store.users.find((user) => user.id === session.teacherId)?.name ?? '',
    lessonId: session.lessonId, knowledgeIds: store.lessons.find((lesson) => lesson.id === session.lessonId)?.knowledgeIds ?? [],
    assignments: session.assignments, submissions, participants: [...people.values()], hands: [...hands].map((id) => people.get(id)?.name).filter(Boolean),
    onlineCount: people.size, viewerIsTeacher,
  };
}

function emitSession(session) {
  for (const [socketId, user] of socketsBySession.get(session.id) ?? []) {
    const socket = io.sockets.sockets.get(socketId);
    if (socket) socket.emit('session:update', liveView(session, user.id));
  }
}

const loginAttempts = new Map();
function loginRateLimit(req, res, next) {
  const ip = req.ip ?? 'unknown';
  const now = Date.now();
  const recent = (loginAttempts.get(ip) ?? []).filter((time) => now - time < 60_000);
  if (recent.length >= 12) return res.status(429).json({ error: '尝试次数较多，请稍后再试。' });
  recent.push(now);
  loginAttempts.set(ip, recent);
  next();
}

app.disable('x-powered-by');
app.use(express.json({ limit: '4mb' }));
app.use((req, res, next) => {
  if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method) && req.headers['sec-fetch-site'] === 'cross-site') {
    return res.status(403).json({ error: '跨站请求已被拦截。' });
  }
  next();
});
app.get('/health', (_req, res) => res.json({ ok: true, classes: store.classes.length, knowledgeItems: store.knowledge.length }));
app.get('/api/classes', (_req, res) => res.json(store.classes.map(({ id, name, grade, teacherId }) => ({ id, name, grade, teacherName: store.users.find((user) => user.id === teacherId)?.name ?? '授课教师' }))));

app.post('/api/register', async (req, res) => {
  const role = text(req.body.role, 30);
  const name = text(req.body.name, 40);
  const username = text(req.body.username, 120).toLowerCase();
  const password = typeof req.body.password === 'string' ? req.body.password : '';
  if (!['teacher', 'student', 'preservice'].includes(role)) return res.status(400).json({ error: '请选择教师、学生或职前教师身份。' });
  if (name.length < 2 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(username)) return res.status(400).json({ error: '请填写有效姓名和邮箱。' });
  if (password.length < 10) return res.status(400).json({ error: '密码至少需要 10 个字符。' });
  if (store.users.some((user) => user.username === username)) return res.status(409).json({ error: '这个邮箱已注册，请直接登录。' });
  let classIds = [];
  if (role === 'student') {
    const classroom = store.classes.find((item) => item.id === req.body.classId);
    if (!classroom || classroom.code !== text(req.body.classCode, 10).toUpperCase()) return res.status(400).json({ error: '请选择班级，并核对老师提供的班级专属码。' });
    classIds = [classroom.id];
  }
  const credentials = await hashPassword(password);
  const user = { id: crypto.randomUUID(), role, name, username, ...credentials, classIds, createdAt: new Date().toISOString() };
  store.users.push(user);
  persist();
  sendSessionCookie(res, user);
  res.status(201).json({ user: userView(user) });
});

app.post('/api/login', loginRateLimit, async (req, res) => {
  const username = text(req.body.username, 120).toLowerCase();
  const user = store.users.find((item) => item.username === username && item.role === text(req.body.role, 30));
  if (!user) return res.status(401).json({ error: '账号、密码或身份不匹配。' });
  const supplied = await scrypt(typeof req.body.password === 'string' ? req.body.password : '', user.salt, 64);
  if (!crypto.timingSafeEqual(supplied, Buffer.from(user.hash, 'hex'))) return res.status(401).json({ error: '账号、密码或身份不匹配。' });
  if (user.role === 'student') {
    const classId = text(req.body.classId, 80);
    if (!user.classIds.includes(classId)) return res.status(403).json({ error: '这个账号没有加入所选班级，请选择注册时加入的班级。' });
    user.activeClassId = classId;
  }
  sendSessionCookie(res, user);
  persist();
  res.json({ user: userView(user) });
});

app.post('/api/logout', (_req, res) => {
  res.setHeader('Set-Cookie', `${COOKIE_NAME}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0`);
  res.json({ ok: true });
});

app.get('/api/me', requireUser, (req, res) => {
  const classes = req.user.role === 'student'
    ? store.classes.filter((item) => req.user.classIds.includes(item.id))
    : store.classes.filter((item) => item.teacherId === req.user.id);
  res.json({ user: userView(req.user), classes: classes.map(publicClass) });
});

app.post('/api/password', requireUser, async (req, res) => {
  const current = typeof req.body.currentPassword === 'string' ? req.body.currentPassword : '';
  const next = typeof req.body.newPassword === 'string' ? req.body.newPassword : '';
  const supplied = await scrypt(current, req.user.salt, 64);
  if (!crypto.timingSafeEqual(supplied, Buffer.from(req.user.hash, 'hex'))) return res.status(400).json({ error: '当前密码不正确。' });
  if (next.length < 10) return res.status(400).json({ error: '新密码至少需要 10 个字符。' });
  Object.assign(req.user, await hashPassword(next));
  persist();
  res.json({ ok: true });
});

app.get('/api/overview', requireUser, (req, res) => {
  const user = req.user;
  const classes = user.role === 'student' ? store.classes.filter((item) => user.classIds.includes(item.id)) : store.classes.filter((item) => item.teacherId === user.id);
  const classIds = classes.map((item) => item.id);
  const sessions = store.liveSessions.filter((item) => classIds.includes(item.classId));
  const submissions = store.submissions.filter((item) => classIds.includes(item.classId) && (user.role !== 'student' || item.studentId === user.id));
  const knowledge = store.knowledge.map(({ id, title, grade, unit, elements }) => ({ id, title, grade, unit, elements }));
  return res.json({ classes: classes.map(publicClass), lessons: store.lessons.filter((item) => item.ownerId === user.id), sessions: sessions.slice(-12).reverse(), submissions: submissions.slice(-30).reverse(), knowledge, students: classIds.flatMap((id) => store.users.filter((item) => item.role === 'student' && item.classIds.includes(id)).map(userView)) });
});

app.post('/api/classes', requireUser, requireRole('teacher', 'preservice'), (req, res) => {
  const name = text(req.body.name, 50);
  const grade = text(req.body.grade, 30);
  if (!name || !grade) return res.status(400).json({ error: '请填写班级名称和年级。' });
  const classroom = { id: crypto.randomUUID(), name, grade, teacherId: req.user.id, code: uniqueCode(), createdAt: new Date().toISOString() };
  store.classes.push(classroom);
  persist();
  res.status(201).json({ classroom: publicClass(classroom) });
});

app.post('/api/classes/join', requireUser, requireRole('student'), (req, res) => {
  const classroom = store.classes.find((item) => item.id === req.body.classId && item.code === text(req.body.classCode, 10).toUpperCase());
  if (!classroom) return res.status(400).json({ error: '班级专属码不匹配，请向老师核对。' });
  req.user.classIds ??= [];
  if (!req.user.classIds.includes(classroom.id)) req.user.classIds.push(classroom.id);
  req.user.activeClassId = classroom.id;
  persist();
  res.json({ classroom: publicClass(classroom), user: userView(req.user) });
});

app.get('/api/knowledge', requireUser, (_req, res) => res.json(store.knowledge.slice().reverse().map(safeKnowledge)));

app.post('/api/knowledge', requireUser, requireRole('teacher', 'preservice'), (req, res) => {
  const title = text(req.body.title, 120);
  const content = typeof req.body.content === 'string' ? req.body.content.trim().slice(0, 200_000) : '';
  if (!title || content.length < 20) return res.status(400).json({ error: '请填写标题并导入至少 20 个字符的教材或教学文本。' });
  const parsedLines = content.split(/\r?\n/).map((line) => line.replace(/^\s{0,3}(?:#{1,6}|[-*•])\s*/, '').trim()).filter(Boolean);
  const objectives = Array.isArray(req.body.objectives) ? req.body.objectives.map((item) => text(item, 200)).filter(Boolean).slice(0, 12) : [];
  if (!objectives.length) objectives.push(...parsedLines.filter((line) => /^(学习目标|教学目标|目标|学生能够|能够|理解|掌握|感受)/.test(line)).slice(0, 8));
  const elements = Array.isArray(req.body.elements) ? req.body.elements.map((item) => text(item, 50)).filter(Boolean).slice(0, 20) : [];
  if (!elements.length) elements.push(...['音高', '节奏', '旋律', '节拍', '力度', '音色', '乐句', '和声', '速度', '调式', '结构', '曲式', '动机'].filter((element) => content.includes(element)));
  const inferredUnit = parsedLines.find((line) => /单元|第[一二三四五六七八九十0-9]+课|第[一二三四五六七八九十0-9]+单元/.test(line));
  const item = {
    id: crypto.randomUUID(), title, grade: text(req.body.grade, 40) || '未标注年级', stage: text(req.body.stage, 40) || '中小学',
    textbook: text(req.body.textbook, 120) || '教师上传资料', unit: text(req.body.unit, 100) || text(inferredUnit, 100) || '教学资源', sourceName: text(req.body.sourceName, 120) || '教师录入',
    objectives, elements, content, createdBy: req.user.id, createdAt: new Date().toISOString(),
  };
  store.knowledge.push(item);
  persist();
  res.status(201).json({ item: safeKnowledge(item) });
});

app.delete('/api/knowledge/:id', requireUser, requireRole('teacher', 'preservice'), (req, res) => {
  const item = store.knowledge.find((entry) => entry.id === req.params.id);
  if (!item) return res.status(404).json({ error: '没有找到这条资料。' });
  if (item.createdBy !== req.user.id) return res.status(403).json({ error: '只能删除自己上传的资料。' });
  store.knowledge = store.knowledge.filter((entry) => entry.id !== item.id);
  persist();
  res.json({ ok: true });
});

app.get('/api/lessons', requireUser, (req, res) => res.json(store.lessons.filter((item) => item.ownerId === req.user.id).map(lessonView).reverse()));

app.post('/api/lessons', requireUser, requireRole('teacher', 'preservice'), (req, res) => {
  const title = text(req.body.title, 100);
  const objective = text(req.body.objective, 600);
  if (!title || !objective) return res.status(400).json({ error: '请填写课程主题和教学目标。' });
  const knowledgeIds = Array.isArray(req.body.knowledgeIds) ? [...new Set(req.body.knowledgeIds.filter((id) => store.knowledge.some((item) => item.id === id)))] : [];
  const lesson = { id: crypto.randomUUID(), title, grade: text(req.body.grade, 40), objective, activityModes: ['listening', 'performance', 'improv', 'composition'], knowledgeIds, steps: req.body.steps ?? {}, ownerId: req.user.id, createdAt: new Date().toISOString() };
  store.lessons.push(lesson);
  persist();
  res.status(201).json({ lesson: lessonView(lesson) });
});

app.post('/api/sessions', requireUser, requireRole('teacher', 'preservice'), (req, res) => {
  const classroom = classOwnedBy(req.user, text(req.body.classId, 80));
  if (!classroom) return res.status(403).json({ error: '请先创建或选择自己管理的班级。' });
  const title = text(req.body.title, 100);
  if (!title) return res.status(400).json({ error: '请填写本次课堂主题。' });
  const lesson = store.lessons.find((item) => item.id === req.body.lessonId && item.ownerId === req.user.id);
  const session = { id: crypto.randomUUID(), code: uniqueCode(), title, classId: classroom.id, teacherId: req.user.id, lessonId: lesson?.id ?? null, assignments: [], status: 'active', createdAt: new Date().toISOString() };
  store.liveSessions.push(session);
  socketsBySession.set(session.id, new Map());
  persist();
  res.status(201).json({ session });
});

app.post('/api/sessions/:id/end', requireUser, requireRole('teacher', 'preservice'), (req, res) => {
  const session = store.liveSessions.find((item) => item.id === req.params.id && item.teacherId === req.user.id);
  if (!session) return res.status(404).json({ error: '没有找到这间课堂。' });
  session.status = 'ended';
  session.endedAt = new Date().toISOString();
  persist();
  io.to(session.id).emit('session:ended', { id: session.id });
  res.json({ ok: true });
});

app.post('/api/assignments', requireUser, requireRole('teacher', 'preservice'), (req, res) => {
  const session = store.liveSessions.find((item) => item.id === req.body.sessionId && item.teacherId === req.user.id && item.status === 'active');
  if (!session) return res.status(404).json({ error: '请选择一间进行中的课堂。' });
  const title = text(req.body.title, 100);
  const description = text(req.body.description, 1000);
  const module = ['listening', 'performance', 'improv', 'composition'].includes(req.body.module) ? req.body.module : 'improv';
  if (!title || !description) return res.status(400).json({ error: '请填写任务标题和创作引导。' });
  const assignment = { id: crypto.randomUUID(), title, description, module, level: text(req.body.level, 30) || '适中', createdAt: new Date().toISOString() };
  session.assignments.unshift(assignment);
  persist();
  emitSession(session);
  res.status(201).json({ assignment });
});

app.get('/api/insights', requireUser, requireRole('teacher', 'preservice'), (req, res) => {
  const classes = store.classes.filter((item) => item.teacherId === req.user.id);
  const students = classes.flatMap((classroom) => store.users.filter((user) => user.role === 'student' && user.classIds.includes(classroom.id)).map((student) => {
    const submissions = store.submissions.filter((entry) => entry.studentId === student.id && entry.classId === classroom.id);
    const logs = store.practiceLogs.filter((entry) => entry.studentId === student.id && entry.classId === classroom.id);
    const types = new Set([...submissions.map((entry) => entry.module), ...logs.map((entry) => entry.module)]);
    const distinctIdeas = new Set([...submissions.map((entry) => entry.content.toLowerCase()), ...store.portfolios.filter((entry) => entry.studentId === student.id).map((entry) => JSON.stringify(entry.payload))]);
    const refined = submissions.filter((entry) => entry.revisionCount > 0).length;
    const total = Math.max(1, submissions.length);
    return {
      id: student.id, name: student.name, classId: classroom.id, className: classroom.name,
      submissions: submissions.length, fluency: Math.min(100, distinctIdeas.size * 15), flexibility: Math.round(types.size / 4 * 100),
      originality: Math.min(100, (distinctIdeas.size >= 3 ? 75 : distinctIdeas.size * 24) + Math.min(25, logs.length * 3)),
      refinement: Math.round(refined / total * 100), logs: logs.length,
      nextStep: logs.length + submissions.length < 3 ? '先从聆听一个具体声音线索开始，再尝试用三到五个音回应。' : types.size < 3 ? '尝试把已有动机分别变成节奏、表演和旋律，体验不同表达方式。' : '为熟悉的动机加一个新限制，例如改变音区、节拍或音乐情绪。',
    };
  }));
  const activeSessions = store.liveSessions.filter((session) => session.teacherId === req.user.id && session.status === 'active');
  res.json({ classes: classes.map(publicClass), students, activeSessions: activeSessions.map((session) => ({ ...session, onlineCount: (socketsBySession.get(session.id)?.size ?? 0) })) });
});

app.get('/api/report', requireUser, (req, res) => {
  if (req.user.role !== 'student') return res.status(403).json({ error: '成长报告目前面向学生账号。' });
  const entries = store.submissions.filter((item) => item.studentId === req.user.id);
  const logs = store.practiceLogs.filter((item) => item.studentId === req.user.id);
  const modules = new Set([...entries.map((item) => item.module), ...logs.map((item) => item.module)]);
  const variety = new Set(entries.map((entry) => entry.content.toLowerCase())).size;
  res.json({
    indicators: [
      { key: 'fluency', label: '创意流畅性', value: Math.min(100, Math.max(variety, logs.length) * 15), note: `已留下 ${entries.length + logs.length} 条创作过程记录` },
      { key: 'flexibility', label: '表达变通性', value: Math.round(modules.size / 4 * 100), note: `已探索 ${modules.size} 种实践方式` },
      { key: 'originality', label: '想法独特性', value: Math.min(100, variety * 24 + Math.min(25, logs.length * 3)), note: '以个人版本差异作为探索线索' },
      { key: 'refinement', label: '作品精进度', value: Math.round(entries.filter((item) => item.revisionCount > 0).length / Math.max(1, entries.length) * 100), note: '观察保存、修改和完善的过程' },
    ],
    advice: entries.length + logs.length < 3 ? '先给自己一个小目标：聆听一段声音，选出最喜欢的元素，再用自己的方式回应。' : modules.size < 3 ? '你已经形成了一些音乐想法。试着用另一种方式表达同一个想法，例如从节奏换到旋律。' : '你尝试了多种表达方式。挑一段熟悉的作品，改变它的音区或节奏，让它长出新的样子。',
    records: entries.slice(-12).reverse().map((entry) => ({ title: entry.title, module: entry.module, createdAt: entry.createdAt, revisionCount: entry.revisionCount })),
  });
});

app.post('/api/practice-log', requireUser, requireRole('student'), (req, res) => {
  const module = ['listening', 'performance', 'improv', 'composition'].includes(req.body.module) ? req.body.module : null;
  if (!module) return res.status(400).json({ error: '无效的活动类型。' });
  const classId = (req.user.classIds ?? []).includes(req.body.classId) ? req.body.classId : req.user.classIds?.[0] ?? null;
  store.practiceLogs.push({ id: crypto.randomUUID(), studentId: req.user.id, classId, module, action: text(req.body.action, 60) || 'explore', createdAt: new Date().toISOString() });
  persist();
  res.json({ ok: true });
});

app.post('/api/portfolio', requireUser, requireRole('student'), (req, res) => {
  const title = text(req.body.title, 100) || '我的音乐小样';
  const module = ['listening', 'performance', 'improv', 'composition'].includes(req.body.module) ? req.body.module : 'composition';
  const payload = req.body.payload && typeof req.body.payload === 'object' ? req.body.payload : {};
  const item = { id: crypto.randomUUID(), studentId: req.user.id, classId: req.user.activeClassId ?? req.user.classIds?.[0] ?? null, title, module, payload, createdAt: new Date().toISOString() };
  store.portfolios.push(item);
  persist();
  res.status(201).json({ item });
});

app.post('/api/submissions', requireUser, requireRole('student'), (req, res) => {
  const session = store.liveSessions.find((item) => item.id === req.body.sessionId && classJoinedBy(req.user, item.classId));
  if (!session) return res.status(403).json({ error: '请先选择你已加入班级中的课程。' });
  const assignment = session.assignments.find((item) => item.id === req.body.assignmentId);
  const content = text(req.body.content, 4000);
  if (!content) return res.status(400).json({ error: '请先完成一点自己的音乐尝试。' });
  const existing = store.submissions.find((item) => item.sessionId === session.id && item.assignmentId === assignment?.id && item.studentId === req.user.id);
  const module = assignment?.module ?? (['listening', 'performance', 'improv', 'composition'].includes(req.body.module) ? req.body.module : 'composition');
  if (existing) {
    existing.content = content;
    existing.revisionCount += 1;
    existing.updatedAt = new Date().toISOString();
  } else {
    store.submissions.unshift({ id: crypto.randomUUID(), sessionId: session.id, assignmentId: assignment?.id ?? null, classId: session.classId, studentId: req.user.id, studentName: req.user.name, title: assignment?.title ?? session.title, module, content, payload: req.body.payload ?? null, revisionCount: 0, createdAt: new Date().toISOString() });
  }
  store.practiceLogs.push({ id: crypto.randomUUID(), studentId: req.user.id, classId: session.classId, module, action: 'submit', createdAt: new Date().toISOString() });
  persist();
  emitSession(session);
  res.status(201).json({ ok: true });
});

app.get('/api/portfolio', requireUser, (req, res) => {
  const classIds = req.user.role === 'teacher' ? store.classes.filter((item) => item.teacherId === req.user.id).map((item) => item.id) : req.user.classIds ?? [];
  const items = req.user.role === 'student'
    ? store.portfolios.filter((item) => item.studentId === req.user.id)
    : store.portfolios.filter((item) => classIds.includes(item.classId) && req.user.role === 'teacher');
  res.json(items.slice().reverse());
});

app.post('/api/assistant/chat', requireUser, async (req, res) => {
  const question = text(req.body.message, 700);
  const history = Array.isArray(req.body.history) ? req.body.history.slice(-8).flatMap((item) => {
    if (!['user', 'assistant'].includes(item?.role)) return [];
    const content = text(item.content, 700);
    return content ? [{ role: item.role, content }] : [];
  }) : [];
  if (!question) return res.status(400).json({ error: '请写下你的音乐问题或灵感。' });
  const key = process.env.MUSIC_AI_API_KEY;
  const recent = stateChatLimits.get(req.user.id) ?? [];
  const recentRequests = recent.filter((createdAt) => Date.now() - createdAt < 60_000);
  if (recentRequests.length >= 25) return res.status(429).json({ error: '今天的音乐探索先停一下，稍后再和豆芽AI继续聊。' });
  recentRequests.push(Date.now());
  stateChatLimits.set(req.user.id, recentRequests);
  if (key) {
    const system = `你是“豆芽AI”，一位温和、有创造力的中小学音乐创作伙伴。用适合 8—18 岁学生的中文对话。以提问、比较、聆听和小实验来搭脚手架；不要直接替学生完成作业，不评判“好坏”，尊重多元文化与不同能力。不要收集学生姓名、学校等个人信息；不要回答与学习无关的私人请求。回答约 80—180 字，循序渐进，鼓励学生做自己的选择。所有教材事实优先依据以下平台教材知识库，超出知识库时明确说这是建议而非教材结论。\n\n知识库：\n${lessonKnowledgeContext(req.body.knowledgeIds)}`;
    try {
      const response = await fetch('https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions', {
        method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
        body: JSON.stringify({ model: process.env.MUSIC_AI_MODEL || 'qwen-plus', temperature: 0.75, max_tokens: 350, messages: [{ role: 'system', content: system }, ...history, { role: 'user', content: question }] }),
        signal: AbortSignal.timeout(18_000),
      });
      if (!response.ok) throw new Error(`model returned ${response.status}`);
      const data = await response.json();
      const reply = text(data.choices?.[0]?.message?.content, 1600);
      if (reply) return res.json({ reply, model: process.env.MUSIC_AI_MODEL || 'qwen-plus', source: 'qwen' });
      throw new Error('empty model response');
    } catch (error) {
      console.error('Music guide model request failed:', error.message);
    }
  }
  const references = store.knowledge.slice().sort((a, b) => Number(`${a.title} ${a.unit}`.includes('旋律')) - Number(`${b.title} ${b.unit}`.includes('旋律'))).slice(0, 5);
  res.json({ reply: localCoach(question, references), model: '本地音乐创作引导', source: 'local' });
});

app.use(express.static(path.join(ROOT, 'public'), { extensions: ['html'] }));

io.use((socket, next) => {
  const user = verifyToken(readCookies(socket.handshake.headers.cookie)[COOKIE_NAME]);
  if (!user) return next(new Error('请先登录'));
  socket.data.user = user;
  next();
});

io.on('connection', (socket) => {
  const user = socket.data.user;

  socket.on('session:join', (payload = {}, callback) => {
    const session = sessionByCodeOrId(payload.code ?? payload.sessionId);
    if (!session || session.status !== 'active') return callback?.({ ok: false, error: '没有找到进行中的课堂，请确认临时课堂码。' });
    if (!isSessionMember(user, session)) return callback?.({ ok: false, error: '你还没有加入这间课堂所属的班级。' });
    const classroom = store.classes.find((item) => item.id === session.classId);
    const isTeacher = classroom.teacherId === user.id;
    if (user.role !== 'student' && !isTeacher) return callback?.({ ok: false, error: '当前账号不能进入该课堂。' });
    socket.join(session.id);
    socket.data.sessionId = session.id;
    socket.data.raisedHand = false;
    if (!socketsBySession.has(session.id)) socketsBySession.set(session.id, new Map());
    socketsBySession.get(session.id).set(socket.id, user);
    const state = liveView(session, user.id);
    emitSession(session);
    callback?.({ ok: true, state });
  });

  socket.on('session:leave', (callback) => {
    const session = store.liveSessions.find((item) => item.id === socket.data.sessionId);
    const members = socketsBySession.get(socket.data.sessionId);
    members?.delete(socket.id);
    socket.leave(socket.data.sessionId);
    socket.data.sessionId = null;
    socket.data.raisedHand = false;
    if (session) emitSession(session);
    callback?.({ ok: true });
  });

  socket.on('session:hand', (_payload, callback) => {
    const session = store.liveSessions.find((item) => item.id === socket.data.sessionId);
    if (!session || user.role !== 'student') return callback?.({ ok: false, error: '进入课堂后，学生可以举手发言。' });
    socket.data.raisedHand = !socket.data.raisedHand;
    emitSession(session);
    callback?.({ ok: true, raised: socket.data.raisedHand });
  });

  socket.on('session:submit', (payload = {}, callback) => {
    const session = store.liveSessions.find((item) => item.id === socket.data.sessionId && item.status === 'active');
    if (!session || user.role !== 'student') return callback?.({ ok: false, error: '请先进入进行中的课堂。' });
    const assignment = session.assignments.find((item) => item.id === payload.assignmentId);
    const content = text(payload.content, 4000);
    if (!content) return callback?.({ ok: false, error: '请先完成一点自己的音乐尝试。' });
    const existing = store.submissions.find((item) => item.sessionId === session.id && item.assignmentId === assignment?.id && item.studentId === user.id);
    if (existing) {
      existing.content = content;
      existing.revisionCount += 1;
      existing.updatedAt = new Date().toISOString();
    } else {
      store.submissions.unshift({ id: crypto.randomUUID(), sessionId: session.id, assignmentId: assignment?.id ?? null, classId: session.classId, studentId: user.id, studentName: user.name, title: assignment?.title ?? session.title, module: assignment?.module || text(payload.module, 40) || 'composition', content, payload: payload.payload ?? null, revisionCount: 0, createdAt: new Date().toISOString() });
    }
    store.practiceLogs.push({ id: crypto.randomUUID(), studentId: user.id, classId: session.classId, module: assignment?.module || text(payload.module, 40) || 'composition', action: 'submit', createdAt: new Date().toISOString() });
    persist();
    emitSession(session);
    callback?.({ ok: true });
  });

  socket.on('disconnect', () => {
    const sessionId = socket.data.sessionId;
    const session = store.liveSessions.find((item) => item.id === sessionId);
    socketsBySession.get(sessionId)?.delete(socket.id);
    if (session) emitSession(session);
  });
});

loadStore();
httpServer.listen(PORT, '0.0.0.0', () => console.log(`Douya AI classroom listening on http://localhost:${PORT}`));
