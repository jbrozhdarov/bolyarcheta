const express = require("express");
const session = require("express-session");
const multer = require("multer");
const path = require("path");
const fs = require("fs");
const bcrypt = require("bcryptjs");
const crypto = require("crypto");
const { CloudinaryStorage } = require("multer-storage-cloudinary");
const cloudinary = require("cloudinary").v2;

const app = express();

cloudinary.config({
  cloud_name: process.env.CLOUD_NAME,
  api_key: process.env.API_KEY,
  api_secret: process.env.API_SECRET
});

const PORT = process.env.PORT || 3000;
const DATA_FILE = path.join(__dirname, "data", "db.json");
const UPLOAD_DIR = path.join(__dirname, "public", "uploads");

if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, "public")));
app.use(session({
  secret: "bolyarcheta-local-secret-v3",
  resave: false,
  saveUninitialized: false
}));


const storage = new CloudinaryStorage({
  cloudinary,
  params: {
    folder: "bolyarcheta",
    resource_type: "video"
  }
});
const upload = multer({ storage, limits: { fileSize: 100 * 1024 * 1024 } });


function readDb() {
  if (!fs.existsSync(DATA_FILE)) seedDb();
  return JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));
}
function writeDb(db) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(db, null, 2), "utf8");
}
function nextId(arr) {
  return arr.length ? Math.max(...arr.map(x => x.id)) + 1 : 1;
}
function hashPassword(pw) {
  return bcrypt.hashSync(pw, 10);
}
function verifyPassword(pw, hash) {
  return bcrypt.compareSync(pw, hash);
}
function isoPlusHours(h) {
  return new Date(Date.now() + h * 3600 * 1000).toISOString();
}
function startOfNextDay() {
  const d = new Date();
  d.setHours(24, 0, 0, 0);
  return d.toISOString();
}
function currentMonthKey() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}
function seedDb() {
  const users = [
    { id: 1, name: "Треньор Мартин", email: "coach@bolyarcheta.bg", passwordHash: hashPassword("coach123"), role: "coach", createdAt: new Date().toISOString() },
    { id: 2, name: "Треньор Иван", email: "assistant@bolyarcheta.bg", passwordHash: hashPassword("coach123"), role: "coach", createdAt: new Date().toISOString() },
    { id: 3, name: "Иван", email: "ivan@bolyarcheta.bg", passwordHash: hashPassword("player123"), role: "player", createdAt: new Date().toISOString() },
    { id: 4, name: "Георги", email: "georgi@bolyarcheta.bg", passwordHash: hashPassword("player123"), role: "player", createdAt: new Date().toISOString() },
    { id: 5, name: "Ники", email: "niki@bolyarcheta.bg", passwordHash: hashPassword("player123"), role: "player", createdAt: new Date().toISOString() },
    { id: 6, name: "Петър", email: "petar@bolyarcheta.bg", passwordHash: hashPassword("player123"), role: "player", createdAt: new Date().toISOString() },
    { id: 7, name: "Мартин", email: "martin@bolyarcheta.bg", passwordHash: hashPassword("player123"), role: "player", createdAt: new Date().toISOString() },
    { id: 8, name: "Алекс", email: "alex@bolyarcheta.bg", passwordHash: hashPassword("player123"), role: "player", createdAt: new Date().toISOString() }
  ];
  const teams = [
    {
      id: 1,
      name: 'СК "Болярчета" U10',
      coachId: 1,
      invitedCoachEmails: ["assistant@bolyarcheta.bg"],
      assistantCoachIds: [2],
      invitedEmails: ["ivan@bolyarcheta.bg", "georgi@bolyarcheta.bg", "niki@bolyarcheta.bg"],
      playerIds: [3, 4, 5],
      nominationDeadlineAt: startOfNextDay(),
      createdAt: new Date().toISOString()
    },
    {
      id: 2,
      name: 'СК "Болярчета" U12',
      coachId: 1,
      invitedCoachEmails: [],
      assistantCoachIds: [],
      invitedEmails: ["petar@bolyarcheta.bg", "martin@bolyarcheta.bg", "alex@bolyarcheta.bg"],
      playerIds: [6, 7, 8],
      nominationDeadlineAt: startOfNextDay(),
      createdAt: new Date().toISOString()
    }
  ];
  const challenges = [];
  writeDb({ users, teams, challenges, settings: { monthKey: currentMonthKey() } });
}
function ensureMonthReset(db) {
  const key = currentMonthKey();
  if (db.settings.monthKey !== key) {
    db.settings.monthKey = key;
    db.challenges = [];
    db.teams = db.teams.map(t => ({ ...t, nominationDeadlineAt: startOfNextDay() }));
    writeDb(db);
  }
}
function authUser(req, db) {
  return db.users.find(u => u.id === req.session.userId);
}
function requireAuth(req, res, next) {
  const db = readDb();
  ensureMonthReset(db);
  syncInvites(db);
  const user = authUser(req, db);
  if (!user) return res.redirect("/login");
  req.db = db;
  req.user = user;
  next();
}
function requireCoach(req, res, next) {
  if (req.user.role !== "coach") return res.redirect("/dashboard");
  next();
}
function isOwnerCoach(team, user) {
  return user.role === "coach" && team.coachId === user.id;
}
function isAssistantCoach(team, user) {
  return user.role === "coach" && Array.isArray(team.assistantCoachIds) && team.assistantCoachIds.includes(user.id);
}
function canSeeTeam(team, user) {
  if (user.role === "player") return team.playerIds.includes(user.id);
  return isOwnerCoach(team, user) || isAssistantCoach(team, user);
}
function enrichTeam(db, team, user) {
  const coach = db.users.find(u => u.id === team.coachId);
  const players = db.users.filter(u => team.playerIds.includes(u.id));
  const assistantCoaches = db.users.filter(u => (team.assistantCoachIds || []).includes(u.id));
  const challenge = db.challenges.filter(c => c.teamId === team.id).sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))[0] || null;
  return {
    ...team,
    coach,
    players,
    assistantCoaches,
    activeChallenge: challenge,
    canManage: !!user && isOwnerCoach(team, user),
    canViewOnly: !!user && isAssistantCoach(team, user)
  };
}
function visibleTeamsForUser(db, user) {
  return db.teams.filter(t => canSeeTeam(t, user)).map(t => enrichTeam(db, t, user));
}
function avg(arr) {
  return arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0;
}
function getChallengeStats(challenge) {
  const mainCoach = challenge.coachRatings.filter(r => r.targetType === "main").map(r => r.value);
  const mainPeer = challenge.peerRatings.filter(r => r.targetType === "main").map(r => r.value);
  return {
    mainCoachScore: avg(mainCoach),
    mainPeerScore: avg(mainPeer),
    mainTotalScore: avg(mainCoach) + avg(mainPeer),
    responseStats: challenge.responses.map(resp => {
      const coachVals = challenge.coachRatings.filter(r => r.targetType === "response" && r.targetId === resp.id).map(r => r.value);
      const peerVals = challenge.peerRatings.filter(r => r.targetType === "response" && r.targetId === resp.id).map(r => r.value);
      return {
        ...resp,
        coachScore: avg(coachVals),
        peerScore: avg(peerVals),
        totalScore: avg(coachVals) + avg(peerVals)
      };
    })
  };
}
function buildRanking(db, teamId = null) {
  const scopedChallenges = db.challenges.filter(c => !teamId || c.teamId === teamId);
  const playerMap = new Map();
  db.users.filter(u => u.role === "player").forEach(u => {
    playerMap.set(u.id, { user: u, points: 0, contributions: 0 });
  });
  for (const ch of scopedChallenges) {
    const mainCoach = avg(ch.coachRatings.filter(r => r.targetType === "main").map(r => r.value));
    const mainPeer = avg(ch.peerRatings.filter(r => r.targetType === "main").map(r => r.value));
    const assigned = playerMap.get(ch.assignedPlayerId);
    if (assigned) {
      assigned.points += mainCoach + mainPeer;
      assigned.contributions += 1;
    }
    for (const resp of ch.responses) {
      const coachScore = avg(ch.coachRatings.filter(r => r.targetType === "response" && r.targetId === resp.id).map(r => r.value));
      const peerScore = avg(ch.peerRatings.filter(r => r.targetType === "response" && r.targetId === resp.id).map(r => r.value));
      const item = playerMap.get(resp.playerId);
      if (item) {
        item.points += coachScore + peerScore;
        item.contributions += 1;
      }
    }
  }
  return Array.from(playerMap.values()).filter(x => x.points > 0 || x.contributions > 0).sort((a, b) => b.points - a.points);
}
function syncInvites(db) {
  db.teams = db.teams.map(team => {
    const invitedPlayerIds = db.users
      .filter(u => u.role === "player" && (team.invitedEmails || []).map(x => x.toLowerCase()).includes(u.email.toLowerCase()))
      .map(u => u.id);
    const invitedCoachIds = db.users
      .filter(u => u.role === "coach" && (team.invitedCoachEmails || []).map(x => x.toLowerCase()).includes(u.email.toLowerCase()) && u.id !== team.coachId)
      .map(u => u.id);
    return {
      ...team,
      playerIds: Array.from(new Set([...(team.playerIds || []), ...invitedPlayerIds])),
      assistantCoachIds: Array.from(new Set([...(team.assistantCoachIds || []), ...invitedCoachIds]))
    };
  });
}
function canRateTarget(user, team, targetPlayerId) {
  if (user.role !== "player") return false;
  if (!team.playerIds.includes(user.id)) return false;
  if (user.id === targetPlayerId) return false;
  return true;
}
function setFlash(req, message, type = "success") {
  req.session.flash = { message, type };
}
function pullFlash(req) {
  const f = req.session.flash || null;
  delete req.session.flash;
  return f;
}

app.get("/", (req, res) => {
  const db = readDb();
  ensureMonthReset(db);
  const user = authUser(req, db);
  if (user) return res.redirect("/dashboard");
  res.redirect("/login");
});

app.get("/login", (req, res) => {
  const db = readDb();
  ensureMonthReset(db);
  res.render("login", { currentUser: null, flash: pullFlash(req) });
});

app.post("/login", (req, res) => {
  const db = readDb();
  ensureMonthReset(db);
  const { email, password } = req.body;
  const user = db.users.find(u => u.email.toLowerCase() === String(email || "").toLowerCase());
  if (!user || !verifyPassword(password || "", user.passwordHash)) {
    setFlash(req, "Невалиден имейл или парола.", "error");
    return res.redirect("/login");
  }
  req.session.userId = user.id;
  setFlash(req, `Добре дошъл, ${user.name}!`);
  res.redirect("/dashboard");
});

app.get("/register", (_req, res) => {
  res.render("register", { currentUser: null, flash: null });
});

app.post("/register", (req, res) => {
  const db = readDb();
  ensureMonthReset(db);
  const { name, email, password, role } = req.body;
  if (!name || !email || !password || !["coach", "player"].includes(role)) {
    setFlash(req, "Попълни всички полета коректно.", "error");
    return res.redirect("/register");
  }
  if (db.users.some(u => u.email.toLowerCase() === String(email).toLowerCase())) {
    setFlash(req, "Вече има потребител с този имейл.", "error");
    return res.redirect("/register");
  }
  const user = { id: nextId(db.users), name, email, passwordHash: hashPassword(password), role, createdAt: new Date().toISOString() };
  db.users.push(user);
  syncInvites(db);
  writeDb(db);
  req.session.userId = user.id;
  setFlash(req, "Регистрацията е успешна.");
  res.redirect("/dashboard");
});

app.get("/logout", (req, res) => {
  req.session.destroy(() => res.redirect("/login"));
});

app.get("/dashboard", requireAuth, (req, res) => {
  writeDb(req.db);
  const teams = visibleTeamsForUser(req.db, req.user);
  const currentTeamId = Number(req.query.team) || (teams[0] ? teams[0].id : null);
  const team = teams.find(t => t.id === currentTeamId) || teams[0] || null;
  const ranking = buildRanking(req.db, team ? team.id : null);
  const challengeStats = team && team.activeChallenge ? getChallengeStats(team.activeChallenge) : null;
  res.render("dashboard", {
    currentUser: req.user,
    flash: pullFlash(req),
    teams,
    team,
    ranking,
    challengeStats,
    users: req.db.users
  });
});

app.post("/teams", requireAuth, requireCoach, (req, res) => {
  const { name } = req.body;
  if (!name) {
    setFlash(req, "Името на канала е задължително.", "error");
    return res.redirect("/dashboard");
  }
  req.db.teams.push({
    id: nextId(req.db.teams),
    name,
    coachId: req.user.id,
    invitedCoachEmails: [],
    assistantCoachIds: [],
    invitedEmails: [],
    playerIds: [],
    nominationDeadlineAt: startOfNextDay(),
    createdAt: new Date().toISOString()
  });
  writeDb(req.db);
  setFlash(req, "Новият канал е създаден.");
  res.redirect("/dashboard");
});

app.post("/teams/:id/invite-player", requireAuth, requireCoach, (req, res) => {
  const team = req.db.teams.find(t => t.id === Number(req.params.id) && t.coachId === req.user.id);
  if (!team) return res.redirect("/dashboard");
  const email = String(req.body.email || "").trim().toLowerCase();
  if (!email) {
    setFlash(req, "Въведи имейл на дете.", "error");
    return res.redirect(`/dashboard?team=${team.id}`);
  }
  team.invitedEmails = Array.from(new Set([...(team.invitedEmails || []), email]));
  const player = req.db.users.find(u => u.role === "player" && u.email.toLowerCase() === email);
  if (player) team.playerIds = Array.from(new Set([...(team.playerIds || []), player.id]));
  writeDb(req.db);
  setFlash(req, "Детето е поканено в канала.");
  res.redirect(`/dashboard?team=${team.id}`);
});

app.post("/teams/:id/invite-coach", requireAuth, requireCoach, (req, res) => {
  const team = req.db.teams.find(t => t.id === Number(req.params.id) && t.coachId === req.user.id);
  if (!team) return res.redirect("/dashboard");
  const email = String(req.body.email || "").trim().toLowerCase();
  if (!email) {
    setFlash(req, "Въведи имейл на треньор.", "error");
    return res.redirect(`/dashboard?team=${team.id}`);
  }
  team.invitedCoachEmails = Array.from(new Set([...(team.invitedCoachEmails || []), email]));
  const coach = req.db.users.find(u => u.role === "coach" && u.email.toLowerCase() === email && u.id !== req.user.id);
  if (coach) team.assistantCoachIds = Array.from(new Set([...(team.assistantCoachIds || []), coach.id]));
  writeDb(req.db);
  setFlash(req, "Треньорът е поканен като наблюдаващ в този канал.");
  res.redirect(`/dashboard?team=${team.id}`);
});

app.post("/teams/:id/nominate", requireAuth, requireCoach, (req, res) => {
  const team = req.db.teams.find(t => t.id === Number(req.params.id) && t.coachId === req.user.id);
  if (!team) {
    setFlash(req, "Само създателят на канала може да дава предизвикателства тук.", "error");
    return res.redirect("/dashboard");
  }
  const { assignedPlayerId, title, description } = req.body;
  const pid = Number(assignedPlayerId);
  if (!team.playerIds.includes(pid) || !title) {
    setFlash(req, "Избери дете от този канал и заглавие.", "error");
    return res.redirect(`/dashboard?team=${team.id}`);
  }
  const existing = req.db.challenges.filter(c => c.teamId === team.id).sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))[0];
  if (existing && existing.responsesDueAt && new Date(existing.responsesDueAt).getTime() > Date.now()) {
    setFlash(req, "Текущото предизвикателство още не е приключило.", "error");
    return res.redirect(`/dashboard?team=${team.id}`);
  }
  req.db.challenges.push({
    id: nextId(req.db.challenges),
    teamId: team.id,
    monthKey: currentMonthKey(),
    title,
    description: description || "",
    assignedPlayerId: pid,
    mainVideoPath: null,
    mainVideoOriginalName: null,
    mainUploadedAt: null,
    responsesDueAt: null,
    createdAt: new Date().toISOString(),
    coachRatings: [],
    peerRatings: [],
    responses: []
  });
  team.nominationDeadlineAt = startOfNextDay();
  writeDb(req.db);
  setFlash(req, "Новото предизвикателство е създадено.");
  res.redirect(`/dashboard?team=${team.id}`);
});

app.post("/challenges/:id/main-upload", requireAuth, upload.single("video"), (req, res) => {
  const challenge = req.db.challenges.find(c => c.id === Number(req.params.id));
  if (!challenge) return res.redirect("/dashboard");
  const team = req.db.teams.find(t => t.id === challenge.teamId);
  if (!team || !team.playerIds.includes(req.user.id)) return res.redirect("/dashboard");
  if (req.user.id !== challenge.assignedPlayerId) {
    setFlash(req, "Само избраното дете може да качи основното видео.", "error");
    return res.redirect(`/dashboard?team=${team.id}`);
  }
  if (!req.file) {
    setFlash(req, "Избери видео файл.", "error");
    return res.redirect(`/dashboard?team=${team.id}`);
  }
  challenge.mainVideoPath = req.file.path;
  challenge.mainVideoOriginalName = req.file.originalname;
  challenge.mainUploadedAt = new Date().toISOString();
  challenge.responsesDueAt = isoPlusHours(24);
  writeDb(req.db);
  setFlash(req, "Основното видео е качено.");
  res.redirect(`/dashboard?team=${team.id}`);
});

app.post("/challenges/:id/respond", requireAuth, upload.single("video"), (req, res) => {
  const challenge = req.db.challenges.find(c => c.id === Number(req.params.id));
  if (!challenge) return res.redirect("/dashboard");
  const team = req.db.teams.find(t => t.id === challenge.teamId);
  if (!team || !team.playerIds.includes(req.user.id)) return res.redirect("/dashboard");
  if (req.user.id === challenge.assignedPlayerId) {
    setFlash(req, "Избраното дете качва основното видео, не отговор.", "error");
    return res.redirect(`/dashboard?team=${team.id}`);
  }
  if (!challenge.mainUploadedAt) {
    setFlash(req, "Още няма основно видео.", "error");
    return res.redirect(`/dashboard?team=${team.id}`);
  }
  if (new Date(challenge.responsesDueAt).getTime() <= Date.now()) {
    setFlash(req, "Срокът за отговор е изтекъл.", "error");
    return res.redirect(`/dashboard?team=${team.id}`);
  }
  if (challenge.responses.some(r => r.playerId === req.user.id)) {
    setFlash(req, "Вече си качил видео отговор.", "error");
    return res.redirect(`/dashboard?team=${team.id}`);
  }
  if (!req.file) {
    setFlash(req, "Избери видео файл.", "error");
    return res.redirect(`/dashboard?team=${team.id}`);
  }
  challenge.responses.push({
    id: nextId(challenge.responses),
    playerId: req.user.id,
    videoPath: req.file.path,
    originalName: req.file.originalname,
    uploadedAt: new Date().toISOString()
  });
  writeDb(req.db);
  setFlash(req, "Видео отговорът е качен.");
  res.redirect(`/dashboard?team=${team.id}`);
});

app.post("/challenges/:id/coach-rate", requireAuth, requireCoach, (req, res) => {
  const challenge = req.db.challenges.find(c => c.id === Number(req.params.id));
  if (!challenge) return res.redirect("/dashboard");
  const team = req.db.teams.find(t => t.id === challenge.teamId && t.coachId === req.user.id);
  if (!team) {
    setFlash(req, "Само създателят на канала може да оценява като треньор.", "error");
    return res.redirect("/dashboard");
  }
  const targetType = String(req.body.targetType || "");
  const targetId = Number(req.body.targetId);
  const value = Number(req.body.value);
  if (![1,2,3,4,5,6,7,8,9,10].includes(value)) {
    setFlash(req, "Оценката трябва да е от 1 до 10.", "error");
    return res.redirect(`/dashboard?team=${team.id}`);
  }
  const existing = challenge.coachRatings.find(r => r.targetType === targetType && r.targetId === targetId && r.raterUserId === req.user.id);
  if (existing) existing.value = value;
  else challenge.coachRatings.push({ id: nextId(challenge.coachRatings), targetType, targetId, raterUserId: req.user.id, value, createdAt: new Date().toISOString() });
  writeDb(req.db);
  setFlash(req, "Треньорската оценка е записана.");
  res.redirect(`/dashboard?team=${team.id}`);
});

app.post("/challenges/:id/peer-rate", requireAuth, (req, res) => {
  const challenge = req.db.challenges.find(c => c.id === Number(req.params.id));
  if (!challenge) return res.redirect("/dashboard");
  const team = req.db.teams.find(t => t.id === challenge.teamId);
  if (!team) return res.redirect("/dashboard");
  const targetType = String(req.body.targetType || "");
  const targetId = Number(req.body.targetId);
  const targetPlayerId = Number(req.body.targetPlayerId);
  const value = Number(req.body.value);
  if (!canRateTarget(req.user, team, targetPlayerId)) {
    setFlash(req, "Нямаш право да оцениш този запис.", "error");
    return res.redirect(`/dashboard?team=${team.id}`);
  }
  if (![1,2,3,4,5,6,7,8,9,10].includes(value)) {
    setFlash(req, "Оценката трябва да е от 1 до 10.", "error");
    return res.redirect(`/dashboard?team=${team.id}`);
  }
  const existing = challenge.peerRatings.find(r => r.targetType === targetType && r.targetId === targetId && r.raterUserId === req.user.id);
  if (existing) existing.value = value;
  else challenge.peerRatings.push({ id: nextId(challenge.peerRatings), targetType, targetId, raterUserId: req.user.id, value, createdAt: new Date().toISOString() });
  writeDb(req.db);
  setFlash(req, "Твоята анонимна оценка е записана.");
  res.redirect(`/dashboard?team=${team.id}`);
});

app.post("/ranking/reset", requireAuth, requireCoach, (req, res) => {
  req.db.challenges = req.db.challenges.filter(c => {
    const team = req.db.teams.find(t => t.id === c.teamId);
    return team && team.coachId !== req.user.id;
  });
  req.db.teams = req.db.teams.map(t => t.coachId === req.user.id ? { ...t, nominationDeadlineAt: startOfNextDay() } : t);
  writeDb(req.db);
  setFlash(req, "Месечните данни за твоите канали са занулени.");
  res.redirect("/dashboard");
});

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
