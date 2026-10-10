import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { createServer } from 'node:http';
import { Server } from 'socket.io';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT) || 3000;
const DATA_FILE = process.env.CLASSROOM_DATA_FILE || path.join(ROOT, 'data', 'classrooms.json');
const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, { maxHttpBufferSize: 32_000 });
const rooms = new Map();

app.disable('x-powered-by');
app.use(express.static(path.join(ROOT, 'public'), { extensions: ['html'] }));
app.get('/health', (_req, res) => res.json({ ok: true, classrooms: rooms.size }));

function cleanText(value, maxLength = 500) {
  return typeof value === 'string' ? value.trim().replace(/\s+/g, ' ').slice(0, maxLength) : '';
}

function makeCode() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code;
  do {
    code = Array.from(crypto.randomBytes(6), (byte) => alphabet[byte % alphabet.length]).join('');
  } while (rooms.has(code));
  return code;
}

function publicRoom(room) {
  const online = [...room.members.values()].filter((member) => member.sockets.size > 0);
  return {
    code: room.code,
    title: room.title,
    teacherName: room.teacherName,
    assignments: room.assignments,
    submissions: room.submissions,
    participants: online.map(({ id, name, role }) => ({ id, name, role })),
    hands: [...room.hands].map((id) => room.members.get(id)?.name).filter(Boolean),
    onlineCount: online.length,
  };
}

function persistRooms() {
  const directory = path.dirname(DATA_FILE);
  fs.mkdirSync(directory, { recursive: true });
  const tempFile = `${DATA_FILE}.${process.pid}.tmp`;
  fs.writeFileSync(tempFile, JSON.stringify([...rooms.values()].map(({ members, hands, ...room }) => room), null, 2), { mode: 0o600 });
  fs.renameSync(tempFile, DATA_FILE);
}

function restoreRooms() {
  try {
    const stored = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
    for (const saved of stored) {
      if (saved?.code && saved.teacherToken && Array.isArray(saved.assignments) && Array.isArray(saved.submissions)) {
        rooms.set(saved.code, { ...saved, members: new Map(), hands: new Set() });
      }
    }
  } catch (error) {
    if (error.code !== 'ENOENT') console.error('Unable to load classroom data:', error.message);
  }
}

function snapshot(code) {
  const room = rooms.get(code);
  if (!room) return;
  io.to(code).emit('classroom:update', publicRoom(room));
}

function joinRoom(socket, room, participantId, name, role) {
  const previousCode = socket.data.roomCode;
  if (previousCode && previousCode !== room.code) {
    const previousRoom = rooms.get(previousCode);
    const previousMember = previousRoom?.members.get(socket.data.participantId);
    previousMember?.sockets.delete(socket.id);
    if (previousMember?.sockets.size === 0) {
      previousRoom.members.delete(previousMember.id);
      previousRoom.hands.delete(previousMember.id);
    }
    socket.leave(previousCode);
    snapshot(previousCode);
  }
  socket.join(room.code);
  socket.data.roomCode = room.code;
  socket.data.participantId = participantId;
  socket.data.role = role;
  const member = room.members.get(participantId) ?? { id: participantId, name, role, sockets: new Set() };
  member.name = name;
  member.role = role;
  member.sockets.add(socket.id);
  room.members.set(participantId, member);
  snapshot(room.code);
  return { ok: true, room: publicRoom(room), role };
}

function ack(callback, result) {
  if (typeof callback === 'function') callback(result);
}

const noteSets = [
  { name: 'C 大调', notes: ['C4', 'D4', 'E4', 'G4', 'A4'] },
  { name: 'G 大调', notes: ['G3', 'A3', 'B3', 'D4', 'E4'] },
  { name: 'A 小调', notes: ['A3', 'C4', 'D4', 'E4', 'G4'] },
];
const rhythmIdeas = ['♪ ♪ ♩ | ♩ ♪ ♩', '♩ ♪ ♪ | ♩ ♩', '♪ ♩ ♪ | ♪ ♩'];

function coachReply(input) {
  const text = cleanText(input, 300);
  if (!text) return '先告诉我你想写什么样的旋律吧：比如“像下课铃一样轻快”或“我不知道怎么开始”。';
  const mood = /开心|快乐|活泼|轻快|阳光|热闹|兴奋/.test(text) ? '轻快' : /难过|安静|温柔|思念|孤独|夜晚|平静/.test(text) ? '安静' : '有故事感';
  const set = noteSets[crypto.randomInt(noteSets.length)];
  const rhythm = rhythmIdeas[crypto.randomInt(rhythmIdeas.length)];

  if (/不会|没想法|没灵感|不知道|怎么开始|卡住/.test(text)) {
    return `没关系，我们把创作拆成很小的一步。先想一个画面，再给它选声音。\n\n试试这个 ${mood} 的起点：\n音高：${set.notes.join(' → ')}\n节奏：${rhythm}\n\n先哼一遍，挑一个你最喜欢的音，把它换高一点或低一点。你想让这段旋律听起来像什么场景？`;
  }
  if (/节奏|拍子|快慢|速度/.test(text)) {
    return `节奏会改变同一组音符的性格。可以先用“拍手 + 念节奏”的方式试试：\n\n${rhythm}\n\n把它分别用快一点和慢一点拍两次，再把你最喜欢的节奏配上 ${set.name} 的几个音。哪一种更接近你想表达的感觉？`;
  }
  if (/音符|音高|音阶|旋律|编曲|写歌/.test(text)) {
    return `我们来给你的想法一个可以马上哼唱的起点。用 ${set.name} 里的音试试：\n\n${set.notes.join(' → ')}\n\n让旋律先向上走两步，再往回走一步；节奏可以试“${rhythm}”。不用照抄，换掉其中一个音，让它更像你自己的作品。你想把哪个音改掉？`;
  }
  return `我听到你在想：“${text}”。先把它变成一个声音线索：如果它是 ${mood} 的，可以从 ${set.name} 的 ${set.notes.slice(0, 3).join('、')} 开始哼；再用“${rhythm}”试试节奏。\n\n音乐没有唯一答案。你更想先改变音高、节奏，还是旋律的情绪？`;
}

io.on('connection', (socket) => {
  socket.on('classroom:create', (payload = {}, callback) => {
    const teacherName = cleanText(payload.name, 20);
    if (!teacherName) return ack(callback, { ok: false, error: '请先填写老师称呼。' });
    const code = makeCode();
    const teacherToken = crypto.randomBytes(24).toString('base64url');
    const participantId = cleanText(payload.participantId, 80) || crypto.randomUUID();
    const room = {
      code,
      title: cleanText(payload.title, 40) || '旋律创作实验室',
      teacherName,
      teacherId: participantId,
      teacherToken,
      createdAt: new Date().toISOString(),
      assignments: [],
      submissions: [],
      members: new Map(),
      hands: new Set(),
    };
    rooms.set(code, room);
    persistRooms();
    const result = joinRoom(socket, room, participantId, teacherName, 'teacher');
    ack(callback, { ...result, teacherToken });
  });

  socket.on('classroom:join', (payload = {}, callback) => {
    const code = cleanText(payload.code, 6).toUpperCase();
    const name = cleanText(payload.name, 20);
    const participantId = cleanText(payload.participantId, 80) || crypto.randomUUID();
    const room = rooms.get(code);
    if (!room) return ack(callback, { ok: false, error: '没有找到这个班级码，请检查后再试。' });
    if (!name) return ack(callback, { ok: false, error: '请先填写你的名字或昵称。' });
    const isTeacher = participantId === room.teacherId && payload.teacherToken === room.teacherToken;
    if (participantId === room.teacherId && !isTeacher) return ack(callback, { ok: false, error: '老师凭据无效，请从原来的浏览器重新进入。' });
    ack(callback, joinRoom(socket, room, participantId, name, isTeacher ? 'teacher' : 'student'));
  });

  socket.on('assignment:create', (payload = {}, callback) => {
    const room = rooms.get(socket.data.roomCode);
    if (!room || socket.data.role !== 'teacher') return ack(callback, { ok: false, error: '只有老师可以发布任务。' });
    const title = cleanText(payload.title, 80);
    const description = cleanText(payload.description, 500);
    if (!title || !description) return ack(callback, { ok: false, error: '请填写任务标题和创作提示。' });
    room.assignments.unshift({ id: crypto.randomUUID(), title, description, createdAt: new Date().toISOString(), createdBy: room.teacherName });
    room.assignments = room.assignments.slice(0, 50);
    persistRooms();
    snapshot(room.code);
    ack(callback, { ok: true });
  });

  socket.on('submission:create', (payload = {}, callback) => {
    const room = rooms.get(socket.data.roomCode);
    if (!room || socket.data.role !== 'student') return ack(callback, { ok: false, error: '请以学生身份进入课堂后再提交。' });
    const assignment = room.assignments.find((item) => item.id === payload.assignmentId);
    const content = cleanText(payload.content, 1000);
    const member = room.members.get(socket.data.participantId);
    if (!assignment) return ack(callback, { ok: false, error: '这个任务已不存在，请刷新课堂。' });
    if (!content) return ack(callback, { ok: false, error: '先写下你的旋律构想再提交吧。' });
    const existing = room.submissions.find((item) => item.assignmentId === assignment.id && item.studentId === member.id);
    if (existing) {
      existing.content = content;
      existing.updatedAt = new Date().toISOString();
    } else {
      room.submissions.unshift({ id: crypto.randomUUID(), assignmentId: assignment.id, studentId: member.id, studentName: member.name, content, createdAt: new Date().toISOString() });
    }
    persistRooms();
    snapshot(room.code);
    ack(callback, { ok: true });
  });

  socket.on('hand:toggle', (_payload, callback) => {
    const room = rooms.get(socket.data.roomCode);
    if (!room || socket.data.role !== 'student') return ack(callback, { ok: false, error: '请以学生身份进入课堂后举手。' });
    const participantId = socket.data.participantId;
    if (room.hands.has(participantId)) room.hands.delete(participantId);
    else room.hands.add(participantId);
    snapshot(room.code);
    ack(callback, { ok: true, raised: room.hands.has(participantId) });
  });

  socket.on('assistant:ask', (payload = {}, callback) => {
    ack(callback, { ok: true, reply: coachReply(payload.message) });
  });

  socket.on('disconnect', () => {
    const room = rooms.get(socket.data.roomCode);
    const member = room?.members.get(socket.data.participantId);
    if (!room || !member) return;
    member.sockets.delete(socket.id);
    if (member.sockets.size === 0) {
      room.members.delete(member.id);
      room.hands.delete(member.id);
    }
    snapshot(room.code);
  });
});

restoreRooms();
httpServer.listen(PORT, '0.0.0.0', () => console.log(`Music classroom listening on http://localhost:${PORT}`));
