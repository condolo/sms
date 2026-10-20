/**
 * Local development SMTP sink.
 *
 * Accepts any message on 127.0.0.1:1025 (no real authentication), writes each
 * one to `.mail/` as an .eml file and logs a one-line summary. Lets you
 * exercise every email flow (password reset, invites, receipts, digests)
 * without a real mail provider.
 *
 * Usage:  node scripts/dev-mail.js
 * Then set in .env:
 *   SMTP_HOST=127.0.0.1
 *   SMTP_PORT=1025
 *   SMTP_USER=dev@msingi.local
 *   SMTP_PASS=dev
 *
 * Captures are capped at DEV_MAIL_KEEP (default 500) files; the oldest are
 * deleted first so `.mail/` can't grow without bound.
 */
const net = require('net');
const fs = require('fs');
const path = require('path');

const PORT = Number(process.env.DEV_MAIL_PORT) || 1025;
const MAX_FILES = Number(process.env.DEV_MAIL_KEEP) || 500;
const OUT_DIR = path.join(__dirname, '..', '.mail');
fs.mkdirSync(OUT_DIR, { recursive: true });

let seq = 0;

/* Keep the newest MAX_FILES captures. Filenames start with an ISO timestamp,
   so a plain lexicographic sort is chronological. */
function pruneOldCaptures() {
  try {
    const files = fs.readdirSync(OUT_DIR).filter((f) => f.endsWith('.eml')).sort();
    const excess = files.length - MAX_FILES;
    for (let i = 0; i < excess; i += 1) fs.unlinkSync(path.join(OUT_DIR, files[i]));
    if (excess > 0) console.log(`[dev-mail] Pruned ${excess} old message(s) (keeping ${MAX_FILES}).`);
  } catch (err) {
    console.error('[dev-mail] Prune failed:', err.message);
  }
}

if (fs.readdirSync(OUT_DIR).filter((f) => f.endsWith('.eml')).length > MAX_FILES) {
  pruneOldCaptures();
}

function decodeQ(data) {
  const s = data.replace(/_/g, ' ');
  const bytes = [];
  for (let i = 0; i < s.length; i += 1) {
    if (s[i] === '=' && /^[0-9A-Fa-f]{2}$/.test(s.slice(i + 1, i + 3))) {
      bytes.push(parseInt(s.slice(i + 1, i + 3), 16));
      i += 2;
    } else {
      bytes.push(s.charCodeAt(i) & 0xff);
    }
  }
  return Buffer.from(bytes).toString('utf8');
}

function decodeHeader(value) {
  // RFC 2047: whitespace between adjacent encoded words is not part of the text.
  const joined = value.replace(/(\?=)\s+(=\?)/g, '$1$2');
  return joined.replace(/=\?([^?]+)\?([BQ])\?([^?]*)\?=/gi, (m, charset, enc, data) => {
    try {
      if (enc.toUpperCase() === 'B') return Buffer.from(data, 'base64').toString('utf8');
      return decodeQ(data);
    } catch {
      return m;
    }
  });
}

function summarise(raw) {
  const headerEnd = raw.indexOf('\r\n\r\n');
  const headers = headerEnd === -1 ? raw : raw.slice(0, headerEnd);
  const get = (name) => {
    const m = headers.match(new RegExp(`^${name}:\\s*(.*(?:\\r\\n[ \\t].*)*)`, 'im'));
    return m ? decodeHeader(m[1].replace(/\r\n[ \t]+/g, ' ').trim()) : '';
  };
  return { to: get('To'), from: get('From'), subject: get('Subject') };
}

function save(raw) {
  seq += 1;
  /* SMTP dot-stuffing: the sender doubles any body line starting with '.',
     so undo it here or a saved .eml shows one extra dot per such line. */
  const unstuffed = raw.split('\r\n').map((l) => (l.startsWith('..') ? l.slice(1) : l)).join('\r\n');
  const { to, from, subject } = summarise(unstuffed);
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const slug = (subject || 'no-subject').replace(/[^\w\- ]+/g, '').trim().slice(0, 60) || 'message';
  const file = path.join(OUT_DIR, `${stamp}_${slug}.eml`);
  fs.writeFileSync(file, unstuffed, 'utf8');
  console.log(`[dev-mail] ${seq}. ${subject || '(no subject)'}`);
  console.log(`           from: ${from || '?'}`);
  console.log(`           to:   ${to || '?'}`);
  console.log(`           saved: ${file}`);
  pruneOldCaptures();
}

const server = net.createServer((socket) => {
  socket.setEncoding('utf8');
  let buffer = '';
  let inData = false;
  let authStep = 0;

  const send = (line) => socket.write(line + '\r\n');

  send('220 localhost Msingi dev mail sink');

  socket.on('data', (chunk) => {
    buffer += chunk;

    // DATA mode: consume until the lone "." line
    if (inData) {
      const end = buffer.indexOf('\r\n.\r\n');
      if (end === -1) return;
      const raw = buffer.slice(0, end) + '\r\n';
      buffer = buffer.slice(end + 5);
      inData = false;
      try {
        save(raw);
        send('250 2.0.0 Message accepted');
      } catch (err) {
        console.error('[dev-mail] Could not write message:', err.message);
        send('451 4.3.0 Local error writing message');
      }
    }

    let idx;
    while (!inData && (idx = buffer.indexOf('\r\n')) !== -1) {
      const line = buffer.slice(0, idx);
      buffer = buffer.slice(idx + 2);
      const upper = line.toUpperCase();

      if (authStep === 1) {
        // AUTH LOGIN: client sends base64 username
        authStep = 2;
        send('334 UGFzc3dvcmQ6');
        continue;
      }
      if (authStep === 2) {
        authStep = 0;
        send('235 2.7.0 Authentication successful');
        continue;
      }

      if (upper.startsWith('EHLO') || upper.startsWith('HELO')) {
        send('250-localhost');
        send('250-AUTH PLAIN LOGIN');
        send('250-8BITMIME');
        send('250 SIZE 52428800');
      } else if (upper.startsWith('AUTH LOGIN')) {
        // RFC 4954 allows the username as an initial response on the same
        // line; nodemailer doesn't use it, but other clients (and curl) do.
        const initial = line.slice('AUTH LOGIN'.length).trim();
        if (initial) {
          authStep = 2;
          send('334 UGFzc3dvcmQ6');
        } else {
          authStep = 1;
          send('334 VXNlcm5hbWU6');
        }
      } else if (upper.startsWith('AUTH PLAIN')) {
        send('235 2.7.0 Authentication successful');
      } else if (upper.startsWith('AUTH')) {
        send('235 2.7.0 Authentication successful');
      } else if (upper.startsWith('MAIL FROM')) {
        send('250 2.1.0 Sender OK');
      } else if (upper.startsWith('RCPT TO')) {
        send('250 2.1.5 Recipient OK');
      } else if (upper === 'DATA') {
        inData = true;
        send('354 End data with <CR><LF>.<CR><LF>');
      } else if (upper === 'RSET' || upper === 'NOOP') {
        send('250 2.0.0 OK');
      } else if (upper === 'QUIT') {
        send('221 2.0.0 Bye');
        socket.end();
      } else {
        send('250 2.0.0 OK');
      }
    }
  });

  socket.on('error', () => {});
});

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`[dev-mail] Port ${PORT} is already in use — is another mail sink running?`);
  } else {
    console.error('[dev-mail] Server error:', err.message);
  }
  process.exit(1);
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`[dev-mail] SMTP sink listening on 127.0.0.1:${PORT}`);
  console.log(`[dev-mail] Captured mail is written to ${OUT_DIR}`);
});
