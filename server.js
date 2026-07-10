// Load .env if present (shell-exported vars always win)
try {
  require('fs').readFileSync(require('path').join(__dirname, '.env'), 'utf8')
    .split('\n').forEach(function(line) {
      var m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
      if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
    });
} catch (e) {}

const express = require('express');
const helmet = require('helmet');
const crypto = require('crypto');
const rateLimit = require('express-rate-limit');
const path = require('path');
const db = require('./db');

const app = express();
const PORT = process.env.PORT || 3000;
const ADMIN_KEY = process.env.ADMIN_KEY;

if (!ADMIN_KEY) {
  console.error('FATAL: ADMIN_KEY environment variable not set.');
  console.error('Run: export ADMIN_KEY="$(openssl rand -hex 32)"');
  process.exit(1);
}

const ADMIN_KEY_HASH = crypto.createHash('sha256').update(ADMIN_KEY).digest('hex');

app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'"],
      styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
      fontSrc: ["'self'", "https://fonts.gstatic.com"],
      imgSrc: ["'self'", "data:"],
      mediaSrc: ["'self'"],
      connectSrc: ["'self'"],
    }
  },
  crossOriginEmbedderPolicy: false
}));
app.use(express.json({ limit: '16kb' }));

app.use(function(req, res, next) {
  if (req.method === 'GET' || req.method === 'HEAD') return next();
  var origin = req.headers.origin;
  if (origin && !origin.includes(req.headers.host)) {
    return res.status(403).json({ error: 'Forbidden.' });
  }
  next();
});

var BLOCKED_PATHS = new Set([
  '/server.js', '/db.js', '/package.json', '/package-lock.json',
  '/data.db', '/build-zips.sh', '/map.txt', '/drain demo.txt',
  '/admin.html', '/.env'
]);
app.use(function(req, res, next) {
  var p = decodeURIComponent(req.path);
  if (BLOCKED_PATHS.has(p) || p.startsWith('/node_modules/')) {
    return res.status(404).end();
  }
  next();
});

app.use(express.static(__dirname, {
  index: 'index.html',
  maxAge: '1h',
  setHeaders: function(res, filePath) {
    var ext = path.extname(filePath).toLowerCase();
    if (ext === '.mp3' || ext === '.mp4' || ext === '.zip') {
      res.setHeader('Cache-Control', 'public, max-age=604800');
    } else if (ext === '.png' || ext === '.jpg' || ext === '.webp') {
      res.setHeader('Cache-Control', 'public, max-age=86400');
    } else if (ext === '.woff2' || ext === '.woff' || ext === '.ttf') {
      res.setHeader('Cache-Control', 'public, max-age=2592000');
    }
  }
}));

var contactLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  message: { error: 'Too many submissions. Try again in 15 minutes.' },
  standardHeaders: true,
  legacyHeaders: false
});

var adminLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  message: { error: 'Too many requests.' },
  standardHeaders: true,
  legacyHeaders: false
});

var stmtInsertSub = db.prepare(
  'INSERT OR IGNORE INTO subscribers (email, name) VALUES (?, ?)'
);
var stmtInsertMsg = db.prepare(
  'INSERT INTO messages (name, email, message, subscribe) VALUES (?, ?, ?, ?)'
);
var stmtGetSubs = db.prepare(
  'SELECT id, email, name, subscribed_at FROM subscribers WHERE active = 1 ORDER BY subscribed_at DESC'
);
var stmtGetMsgs = db.prepare(
  'SELECT id, name, email, message, subscribe, created_at, read FROM messages ORDER BY created_at DESC LIMIT ? OFFSET ?'
);
var stmtMsgCount = db.prepare(
  'SELECT COUNT(*) as total, SUM(CASE WHEN read = 0 THEN 1 ELSE 0 END) as unread FROM messages'
);
var stmtMarkRead = db.prepare(
  'UPDATE messages SET read = 1 WHERE id = ?'
);
var stmtDeleteMsg = db.prepare(
  'DELETE FROM messages WHERE id = ?'
);
var stmtUnsubscribe = db.prepare(
  'UPDATE subscribers SET active = 0 WHERE email = ?'
);
var stmtDeleteSub = db.prepare(
  'DELETE FROM subscribers WHERE email = ?'
);
var stmtDeleteMsgsByEmail = db.prepare(
  'DELETE FROM messages WHERE email = ?'
);
var stmtSearchMsgs = db.prepare(
  'SELECT id, name, email, message, subscribe, created_at, read FROM messages WHERE name LIKE ? OR email LIKE ? OR message LIKE ? ORDER BY created_at DESC LIMIT ? OFFSET ?'
);
var stmtSearchMsgCount = db.prepare(
  "SELECT COUNT(*) as total, SUM(CASE WHEN read = 0 THEN 1 ELSE 0 END) as unread FROM messages WHERE name LIKE ? OR email LIKE ? OR message LIKE ?"
);
var stmtSearchSubs = db.prepare(
  'SELECT id, email, name, subscribed_at FROM subscribers WHERE active = 1 AND (email LIKE ? OR name LIKE ?) ORDER BY subscribed_at DESC'
);
var stmtAdminLog = db.prepare(
  'INSERT INTO admin_log (action, ip) VALUES (?, ?)'
);
var stmtCleanup = db.prepare(
  "DELETE FROM messages WHERE created_at < datetime('now', '-90 days')"
);
var stmtInsertShow = db.prepare(
  'INSERT INTO shows (date, venue, city, ticket_url, details) VALUES (?, ?, ?, ?, ?)'
);
var stmtUpcomingShows = db.prepare(
  "SELECT id, date, venue, city, ticket_url, details FROM shows WHERE date >= date('now') ORDER BY date ASC"
);
var stmtAllShows = db.prepare(
  'SELECT id, date, venue, city, ticket_url, details, created_at FROM shows ORDER BY date DESC'
);
var stmtDeleteShow = db.prepare(
  'DELETE FROM shows WHERE id = ?'
);

function validateEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email);
}

function sanitize(str, maxLen) {
  if (typeof str !== 'string') return '';
  return str.trim().slice(0, maxLen);
}

function getIP(req) {
  return req.headers['x-forwarded-for'] || req.socket.remoteAddress || '';
}

// Send an email to every active subscriber via Resend's batch endpoint.
// Each subscriber gets their own individual email (addresses stay private).
// done(err, { sent, failed })
function sendToSubscribers(subject, textBody, done) {
  var RESEND_KEY = process.env.RESEND_API_KEY;
  if (!RESEND_KEY) {
    return done(new Error('RESEND_API_KEY not configured. Sign up at resend.com and set the env var.'));
  }
  var subs;
  try { subs = stmtGetSubs.all(); } catch (err) { return done(err); }
  if (!subs.length) return done(null, { sent: 0, failed: 0 });

  var html = textBody.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\n/g, '<br/>') +
    '<br/><br/><span style="font-size:12px;color:#888">You are receiving this because you subscribed at autumnchild.band. Reply with &quot;unsubscribe&quot; to be removed.</span>';
  var messages = subs.map(function(s) {
    return { from: 'Autumn Child <noreply@autumnchild.band>', to: [s.email], subject: subject, html: html };
  });

  var https = require('https');
  var BATCH_SIZE = 100; // Resend /emails/batch limit
  var batches = [];
  for (var i = 0; i < messages.length; i += BATCH_SIZE) {
    batches.push(messages.slice(i, i + BATCH_SIZE));
  }
  var sentCount = 0;
  var failedCount = 0;
  function sendBatch(idx) {
    if (idx >= batches.length) {
      return done(null, { sent: sentCount, failed: failedCount });
    }
    var payload = JSON.stringify(batches[idx]);
    var opts = {
      hostname: 'api.resend.com',
      path: '/emails/batch',
      method: 'POST',
      headers: {
        'Authorization': 'Bearer ' + RESEND_KEY,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload)
      }
    };
    var apiReq = https.request(opts, function(apiRes) {
      var chunks = [];
      apiRes.on('data', function(c) { chunks.push(c); });
      apiRes.on('end', function() {
        if (apiRes.statusCode >= 200 && apiRes.statusCode < 300) {
          sentCount += batches[idx].length;
        } else {
          failedCount += batches[idx].length;
          console.error('[mailer] batch ' + idx + ':', apiRes.statusCode, Buffer.concat(chunks).toString());
        }
        sendBatch(idx + 1);
      });
    });
    apiReq.on('error', function(err) {
      failedCount += batches[idx].length;
      console.error('[mailer] batch ' + idx + ':', err.message);
      sendBatch(idx + 1);
    });
    apiReq.write(payload);
    apiReq.end();
  }
  sendBatch(0);
}

function fmtShowDate(iso) {
  var d = new Date(iso + 'T12:00:00');
  if (isNaN(d)) return iso;
  return d.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
}

app.post('/api/contact', contactLimiter, function(req, res) {
  var name = sanitize(req.body.name, 200);
  var email = sanitize(req.body.email, 320);
  var message = sanitize(req.body.message, 5000);
  var subscribe = !!req.body.subscribe;

  if (!validateEmail(email)) {
    return res.status(400).json({ error: 'Invalid email address.' });
  }
  if (message && !name) {
    return res.status(400).json({ error: 'Please include your name with your message.' });
  }
  if (!message && !subscribe) {
    return res.status(400).json({ error: 'Please write a message or check "Subscribe to updates".' });
  }

  try {
    if (message) {
      stmtInsertMsg.run(name, email, message, subscribe ? 1 : 0);
    }
    if (subscribe) {
      stmtInsertSub.run(email, name);
    }
    res.json({ ok: true });
  } catch (err) {
    console.error('[contact]', err.message);
    res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
});

app.post('/api/subscribe', contactLimiter, function(req, res) {
  var email = sanitize(req.body.email, 320);
  var name = sanitize(req.body.name, 200);

  if (!validateEmail(email)) {
    return res.status(400).json({ error: 'Invalid email address.' });
  }

  try {
    stmtInsertSub.run(email, name);
    res.json({ ok: true });
  } catch (err) {
    console.error('[subscribe]', err.message);
    res.status(500).json({ error: 'Something went wrong.' });
  }
});

app.post('/api/unsubscribe', function(req, res) {
  var email = sanitize(req.body.email, 320);
  if (!validateEmail(email)) {
    return res.status(400).json({ error: 'Invalid email.' });
  }
  try {
    stmtUnsubscribe.run(email);
    res.json({ ok: true });
  } catch (err) {
    console.error('[unsubscribe]', err.message);
    res.status(500).json({ error: 'Something went wrong.' });
  }
});

app.post('/api/delete-my-data', contactLimiter, function(req, res) {
  var email = sanitize(req.body.email, 320);
  if (!validateEmail(email)) {
    return res.status(400).json({ error: 'Invalid email.' });
  }
  try {
    stmtDeleteSub.run(email);
    stmtDeleteMsgsByEmail.run(email);
    res.json({ ok: true, message: 'All data associated with ' + email + ' has been deleted.' });
  } catch (err) {
    console.error('[delete-data]', err.message);
    res.status(500).json({ error: 'Something went wrong.' });
  }
});

function adminAuth(req, res, next) {
  var key = req.headers['x-admin-key'];
  if (!key) {
    return res.status(401).json({ error: 'Missing authentication.' });
  }
  var keyHash = crypto.createHash('sha256').update(key).digest('hex');
  if (!crypto.timingSafeEqual(Buffer.from(keyHash), Buffer.from(ADMIN_KEY_HASH))) {
    stmtAdminLog.run('auth_failure', getIP(req));
    return res.status(401).json({ error: 'Invalid key.' });
  }
  stmtAdminLog.run(req.method + ' ' + req.path, getIP(req));
  next();
}

app.get('/api/admin/subscribers', adminLimiter, adminAuth, function(req, res) {
  var search = req.query.search ? '%' + req.query.search + '%' : null;
  try {
    var subs;
    if (search) {
      subs = stmtSearchSubs.all(search, search);
    } else {
      subs = stmtGetSubs.all();
    }
    res.json({ count: subs.length, subscribers: subs });
  } catch (err) {
    console.error('[admin/subs]', err.message);
    res.status(500).json({ error: 'Failed to fetch subscribers: ' + err.message });
  }
});

app.get('/api/admin/messages', adminLimiter, adminAuth, function(req, res) {
  var limit = Math.min(parseInt(req.query.limit) || 50, 200);
  var offset = parseInt(req.query.offset) || 0;
  var search = req.query.search ? '%' + req.query.search + '%' : null;
  try {
    var msgs, counts;
    if (search) {
      msgs = stmtSearchMsgs.all(search, search, search, limit, offset);
      counts = stmtSearchMsgCount.get(search, search, search);
    } else {
      msgs = stmtGetMsgs.all(limit, offset);
      counts = stmtMsgCount.get();
    }
    res.json({ total: counts.total || 0, unread: counts.unread || 0, messages: msgs });
  } catch (err) {
    console.error('[admin/msgs]', err.message);
    res.status(500).json({ error: 'Failed to fetch messages: ' + err.message });
  }
});

app.post('/api/admin/messages/:id/read', adminLimiter, adminAuth, function(req, res) {
  try {
    var result = stmtMarkRead.run(req.params.id);
    res.json({ ok: true, changed: result.changes });
  } catch (err) {
    console.error('[admin/read]', err.message);
    res.status(500).json({ error: 'Failed to mark read: ' + err.message });
  }
});

app.delete('/api/admin/messages/:id', adminLimiter, adminAuth, function(req, res) {
  try {
    var result = stmtDeleteMsg.run(req.params.id);
    res.json({ ok: true, deleted: result.changes });
  } catch (err) {
    console.error('[admin/delete]', err.message);
    res.status(500).json({ error: 'Failed to delete: ' + err.message });
  }
});

app.post('/api/admin/newsletter', adminLimiter, adminAuth, function(req, res) {
  var subject = (req.body.subject || '').trim();
  var body = (req.body.body || '').trim();
  if (!subject || !body) {
    return res.status(400).json({ error: 'Subject and body are required.' });
  }
  sendToSubscribers(subject, body, function(err, result) {
    if (err) {
      console.error('[newsletter]', err.message);
      return res.status(500).json({ error: err.message });
    }
    stmtAdminLog.run('newsletter_sent:' + result.sent, getIP(req));
    if (result.failed) {
      return res.status(207).json({ ok: true, sent: result.sent, failed: result.failed });
    }
    res.json({ ok: true, sent: result.sent });
  });
});

// ── SHOWS ──────────────────────────────────────────────────
// Public: upcoming shows for the website.
app.get('/api/shows', function(req, res) {
  try {
    res.json({ shows: stmtUpcomingShows.all() });
  } catch (err) {
    console.error('[shows]', err.message);
    res.status(500).json({ error: 'Failed to fetch shows.' });
  }
});

app.get('/api/admin/shows', adminLimiter, adminAuth, function(req, res) {
  try {
    res.json({ shows: stmtAllShows.all() });
  } catch (err) {
    res.status(500).json({ error: 'Failed: ' + err.message });
  }
});

// Add a show. If notify is true (default), automatically email every
// active subscriber announcing it.
app.post('/api/admin/shows', adminLimiter, adminAuth, function(req, res) {
  var date = sanitize(req.body.date, 10);
  var venue = sanitize(req.body.venue, 200);
  var city = sanitize(req.body.city, 200);
  var ticketUrl = sanitize(req.body.ticket_url, 500);
  var details = sanitize(req.body.details, 2000);
  var notify = req.body.notify !== false;

  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return res.status(400).json({ error: 'Date must be YYYY-MM-DD.' });
  }
  if (!venue || !city) {
    return res.status(400).json({ error: 'Venue and city are required.' });
  }
  if (ticketUrl && !/^https?:\/\//.test(ticketUrl)) {
    return res.status(400).json({ error: 'Ticket URL must start with http(s)://.' });
  }

  var result;
  try {
    result = stmtInsertShow.run(date, venue, city, ticketUrl, details);
    stmtAdminLog.run('show_added:' + result.lastInsertRowid, getIP(req));
  } catch (err) {
    console.error('[shows/add]', err.message);
    return res.status(500).json({ error: 'Failed to save show.' });
  }

  if (!notify) {
    return res.json({ ok: true, id: result.lastInsertRowid, sent: 0, notified: false });
  }

  var subject = 'Autumn Child live — ' + venue + ', ' + city + ' · ' + fmtShowDate(date);
  var body = 'We just announced a show.\n\n' +
    fmtShowDate(date) + '\n' +
    venue + ' — ' + city + '\n' +
    (details ? '\n' + details + '\n' : '') +
    (ticketUrl ? '\nTickets: ' + ticketUrl + '\n' : '') +
    '\nSee you there.\n— Autumn Child';

  sendToSubscribers(subject, body, function(err, mailResult) {
    if (err) {
      console.error('[shows/notify]', err.message);
      // Show is saved either way — report the email failure honestly.
      return res.status(207).json({ ok: true, id: result.lastInsertRowid, sent: 0, notified: false, error: 'Show saved, but email failed: ' + err.message });
    }
    stmtAdminLog.run('show_notify_sent:' + mailResult.sent, getIP(req));
    res.json({ ok: true, id: result.lastInsertRowid, sent: mailResult.sent, failed: mailResult.failed, notified: true });
  });
});

// Announce a release — emails every active subscriber. The release
// itself lives in the site's RELEASE_LIST; nothing is stored here.
app.post('/api/admin/announce-release', adminLimiter, adminAuth, function(req, res) {
  var name = sanitize(req.body.name, 200);
  var type = sanitize(req.body.type, 40) || 'Release';
  var link = sanitize(req.body.link, 500);
  var notes = sanitize(req.body.notes, 2000);

  if (!name) {
    return res.status(400).json({ error: 'Release name is required.' });
  }
  if (link && !/^https?:\/\//.test(link)) {
    return res.status(400).json({ error: 'Link must start with http(s)://.' });
  }

  var subject = 'New ' + type.toLowerCase() + ' from Autumn Child — ' + name;
  var body = 'We just put out something new.\n\n' +
    name + ' (' + type + ')\n' +
    (notes ? '\n' + notes + '\n' : '') +
    '\nListen: ' + (link || 'https://autumnchild.band') + '\n' +
    '\n— Autumn Child';

  sendToSubscribers(subject, body, function(err, result) {
    if (err) {
      console.error('[announce-release]', err.message);
      return res.status(500).json({ error: err.message });
    }
    stmtAdminLog.run('release_announce_sent:' + result.sent, getIP(req));
    if (result.failed) {
      return res.status(207).json({ ok: true, sent: result.sent, failed: result.failed });
    }
    res.json({ ok: true, sent: result.sent });
  });
});

app.delete('/api/admin/shows/:id', adminLimiter, adminAuth, function(req, res) {
  try {
    var result = stmtDeleteShow.run(req.params.id);
    res.json({ ok: true, deleted: result.changes });
  } catch (err) {
    res.status(500).json({ error: 'Failed: ' + err.message });
  }
});

app.get('/admin', adminLimiter, function(req, res) {
  res.sendFile(path.join(__dirname, 'admin.html'));
});

app.all('/api/*', function(req, res) {
  res.status(404).json({ error: 'Not found.' });
});

app.get('*', function(req, res) {
  res.sendFile(path.join(__dirname, 'index.html'));
});

setInterval(function() {
  try {
    var result = stmtCleanup.run();
    if (result.changes > 0) console.log('[cleanup] Deleted ' + result.changes + ' old messages');
  } catch (err) {
    console.error('[cleanup]', err.message);
  }
}, 24 * 60 * 60 * 1000);

app.listen(PORT, function() {
  console.log('autumnchild.band running on http://localhost:' + PORT);
});
