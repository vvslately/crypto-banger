const http = require('http');
const fs = require('fs');
const path = require('path');
const { generateSolanaWallet } = require('./solana-crypto');

const DEFAULT_PORT = parseInt(process.env.PORT, 10) || 4500;
const WALLETS_DIR = path.join(__dirname, 'wallets');
const PUBLIC_DIR = path.join(__dirname, 'public');

// Ensure wallets directory exists
if (!fs.existsSync(WALLETS_DIR)) {
  fs.mkdirSync(WALLETS_DIR, { recursive: true });
}

/**
 * Format wallet details into a clean .txt string
 */
function formatWalletText(wallet, index = null, label = '') {
  const headerTitle = index !== null ? `SOLANA WALLET #${index}` : 'SOLANA WALLET';
  const lines = [
    '====================================================================',
    `  ${headerTitle}${label ? ` (${label})` : ''}`,
    '====================================================================',
    `Created At      : ${wallet.createdAt}`,
    `Public Address  : ${wallet.publicKey}`,
    `Derivation Path : ${wallet.derivationPath}`,
    `Word Count      : ${wallet.wordCount} Words`,
    '--------------------------------------------------------------------',
    'SEED PHRASE (MNEMONIC):',
    `${wallet.mnemonic}`,
    '--------------------------------------------------------------------',
    'PRIVATE KEY (BASE58 - For Phantom / Solflare / Backpack Import):',
    `${wallet.privateKeyBase58}`,
    '--------------------------------------------------------------------',
    'SECRET KEY ARRAY (JSON Bytes - For Solana CLI):',
    `[${wallet.secretKeyArray.join(',')}]`,
    '====================================================================',
    '',
  ];
  return lines.join('\n');
}

/**
 * Create a safe filename timestamp
 */
function getTimestampForFile() {
  const now = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return (
    `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}_` +
    `${pad(now.getHours())}-${pad(now.getMinutes())}-${pad(now.getSeconds())}`
  );
}

/**
 * Sanitize custom prefix/label for filenames
 */
function sanitizePrefix(str) {
  if (!str) return 'wallet';
  const cleaned = String(str).trim().replace(/[^a-zA-Z0-9_-]/g, '_');
  return cleaned || 'wallet';
}

/**
 * Generate wallets and write .txt files to WALLETS_DIR
 */
function generateAndSaveWallets(payload = {}) {
  const count = Math.min(Math.max(parseInt(payload.count, 10) || 1, 1), 100);
  const wordCount = parseInt(payload.wordCount, 10) === 24 ? 24 : 12;
  const label = (payload.label || '').trim();
  const prefix = sanitizePrefix(label);
  const timestamp = getTimestampForFile();

  if (!fs.existsSync(WALLETS_DIR)) {
    fs.mkdirSync(WALLETS_DIR, { recursive: true });
  }

  const generatedWallets = [];
  const savedFiles = [];

  for (let i = 0; i < count; i++) {
    const wallet = generateSolanaWallet({ wordCount, accountIndex: 0 });
    const shortAddress = `${wallet.publicKey.slice(0, 6)}...${wallet.publicKey.slice(-6)}`;
    let individualFilename = null;

    if (count === 1 || payload.saveMode !== 'combined') {
      individualFilename = `${prefix}_${timestamp}_${wallet.publicKey.slice(0, 8)}.txt`;
      const filePath = path.join(WALLETS_DIR, individualFilename);
      const fileContent = formatWalletText(wallet, count > 1 ? i + 1 : null, label);
      fs.writeFileSync(filePath, fileContent, 'utf8');
      savedFiles.push({
        filename: individualFilename,
        fullPath: filePath,
      });
    }

    generatedWallets.push({
      ...wallet,
      shortAddress,
      savedFilename: individualFilename,
    });
  }

  let batchFilename = null;
  if (count > 1) {
    batchFilename = `batch_${prefix}_${count}wallets_${timestamp}.txt`;
    const batchFilePath = path.join(WALLETS_DIR, batchFilename);
    const batchHeader = [
      '####################################################################',
      `  SOLANA BULK WALLET GENERATION (${count} WALLETS)`,
      `  Generated At : ${new Date().toISOString()}`,
      `  Word Count   : ${wordCount} Words`,
      label ? `  Batch Label  : ${label}` : null,
      '####################################################################',
      '',
    ]
      .filter(Boolean)
      .join('\n');

    const batchBody = generatedWallets
      .map((w, idx) => formatWalletText(w, idx + 1, label))
      .join('\n');

    fs.writeFileSync(batchFilePath, batchHeader + '\n' + batchBody, 'utf8');
    savedFiles.unshift({
      filename: batchFilename,
      fullPath: batchFilePath,
    });
  }

  return {
    success: true,
    walletsDir: WALLETS_DIR,
    count,
    wordCount,
    wallets: generatedWallets,
    savedFiles,
    batchFilename,
  };
}
/**
 * List all saved .txt wallet files in ./wallets
 */
function listSavedFiles() {
  if (!fs.existsSync(WALLETS_DIR)) return [];
  const files = fs.readdirSync(WALLETS_DIR).filter((f) => f.endsWith('.txt'));
  return files
    .map((filename) => {
      const fullPath = path.join(WALLETS_DIR, filename);
      const stat = fs.statSync(fullPath);
      return {
        filename,
        fullPath,
        size: stat.size,
        createdAt: stat.birthtime || stat.mtime,
      };
    })
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
}

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
};

const server = http.createServer((req, res) => {
  const parsedUrl = new URL(req.url, `http://${req.headers.host}`);
  const pathname = parsedUrl.pathname;

  // API: Get saved files & folder info
  if (req.method === 'GET' && pathname === '/api/files') {
    const files = listSavedFiles();
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    return res.end(
      JSON.stringify({
        walletsDir: WALLETS_DIR,
        files,
      })
    );
  }

  // API: Read a specific saved .txt file
  if (req.method === 'GET' && pathname.startsWith('/api/files/')) {
    const rawName = decodeURIComponent(pathname.replace('/api/files/', ''));
    const safeName = path.basename(rawName);
    const targetPath = path.join(WALLETS_DIR, safeName);

    if (!fs.existsSync(targetPath) || !safeName.endsWith('.txt')) {
      res.writeHead(404, { 'Content-Type': 'application/json; charset=utf-8' });
      return res.end(JSON.stringify({ error: 'File not found' }));
    }

    const content = fs.readFileSync(targetPath, 'utf8');
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    return res.end(
      JSON.stringify({
        filename: safeName,
        fullPath: targetPath,
        content,
      })
    );
  }

  // API: Generate wallets and save .txt to folder
  if (req.method === 'POST' && pathname === '/api/generate') {
    let body = '';
    req.on('data', (chunk) => {
      body += chunk;
      if (body.length > 1e6) req.socket.destroy();
    });

    req.on('end', () => {
      try {
        const payload = body ? JSON.parse(body) : {};
        const result = generateAndSaveWallets(payload);
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
        return res.end(JSON.stringify(result));
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
        return res.end(JSON.stringify({ error: err.message || 'Failed to generate wallets' }));
      }
    });
    return;
  }

  // Serve static files from ./public
  let safeUrlPath = pathname === '/' ? '/index.html' : pathname;
  const filePath = path.join(PUBLIC_DIR, path.normalize(safeUrlPath));

  if (!filePath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403);
    return res.end('Forbidden');
  }

  fs.readFile(filePath, (err, content) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      return res.end('404 Not Found');
    }
    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, { 'Content-Type': MIME_TYPES[ext] || 'application/octet-stream' });
    res.end(content);
  });
});

function startServer(port = DEFAULT_PORT) {
  server.listen(port, () => {
    console.log('==========================================================');
    console.log(`🚀 Solana Wallet Generator Server is running!`);
    console.log(`🌐 Web UI      : http://localhost:${port}`);
    console.log(`📁 Wallets Dir : ${WALLETS_DIR}`);
    console.log('==========================================================');
  });

  server.on('error', (err) => {
    if (err.code === 'EADDRINUSE' || err.code === 'EACCES') {
      console.log(`⚠️ Port ${port} unavailable (${err.code}), trying port ${port + 1}...`);
      startServer(port + 1);
    } else {
      throw err;
    }
  });
}

if (require.main === module) {
  startServer();
}

module.exports = {
  generateAndSaveWallets,
  listSavedFiles,
};


