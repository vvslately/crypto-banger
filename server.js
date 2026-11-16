const http = require('http');
const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');
const { generateSolanaWallet } = require('./solana-crypto');

const DEFAULT_PORT = parseInt(process.env.PORT, 10) || 4500;
const WALLETS_DIR = path.join(__dirname, 'wallets');
const PUBLIC_DIR = path.join(__dirname, 'public');

const SOLANA_RPC_URLS = {
  mainnet: 'https://api.mainnet-beta.solana.com',
  devnet: 'https://api.devnet.solana.com',
};
const LAMPORTS_PER_SOL = 1_000_000_000;
const SPL_TOKEN_PROGRAM_ID = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';

/**
 * Call Solana JSON-RPC endpoint
 */
async function callSolanaRpc(network, method, params) {
  const rpcUrl = SOLANA_RPC_URLS[network] || SOLANA_RPC_URLS.mainnet;
  const response = await fetch(rpcUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method,
      params,
    }),
  });

  if (!response.ok) {
    throw new Error(`Solana RPC HTTP ${response.status}`);
  }

  const json = await response.json();
  if (json.error) {
    throw new Error(json.error.message || 'Solana RPC Error');
  }
  return json.result;
}

/**
 * Fetch SOL & SPL Token balances for a single address
 */
async function getWalletBalance(address, network = 'mainnet') {
  const balanceResult = await callSolanaRpc(network, 'getBalance', [
    address,
    { commitment: 'confirmed' },
  ]);
  const lamports = balanceResult?.value ?? 0;
  const sol = lamports / LAMPORTS_PER_SOL;

  let tokens = [];
  try {
    const tokenResult = await callSolanaRpc(network, 'getTokenAccountsByOwner', [
      address,
      { programId: SPL_TOKEN_PROGRAM_ID },
      { encoding: 'jsonParsed', commitment: 'confirmed' },
    ]);
    tokens = (tokenResult?.value || [])
      .map((item) => {
        const info = item?.account?.data?.parsed?.info;
        const amount = info?.tokenAmount?.uiAmount || 0;
        return {
          mint: info?.mint || '',
          amount,
          uiAmountString: info?.tokenAmount?.uiAmountString || '0',
          decimals: info?.tokenAmount?.decimals || 0,
        };
      })
      .filter((t) => t.amount > 0);
  } catch {
    // Ignore token fetch errors if RPC rate-limits secondary call
  }

  return {
    address,
    network,
    lamports,
    sol,
    tokens,
  };
}

/**
 * Batch fetch SOL balances for multiple addresses using getMultipleAccounts
 */
async function getMultipleWalletBalances(addresses = [], network = 'mainnet') {
  const cleanAddresses = addresses.filter(Boolean).slice(0, 100);
  if (cleanAddresses.length === 0) return [];

  const result = await callSolanaRpc(network, 'getMultipleAccounts', [
    cleanAddresses,
    { encoding: 'base64', commitment: 'confirmed' },
  ]);

  const accounts = result?.value || [];
  return cleanAddresses.map((address, idx) => {
    const lamports = accounts[idx]?.lamports ?? 0;
    return {
      address,
      network,
      lamports,
      sol: lamports / LAMPORTS_PER_SOL,
    };
  });
}

/**
 * Resolve and validate a custom save directory safely
 */
function resolveSafeSaveDir(customPath, createIfMissing = false) {
  if (!customPath || !String(customPath).trim()) {
    if (createIfMissing && !fs.existsSync(WALLETS_DIR)) {
      fs.mkdirSync(WALLETS_DIR, { recursive: true });
    }
    return WALLETS_DIR;
  }

  const raw = String(customPath).trim();
  if (raw.includes('\0')) {
    throw new Error('Invalid folder path');
  }

  const resolved = path.isAbsolute(raw) ? path.resolve(raw) : path.resolve(__dirname, raw);

  if (fs.existsSync(resolved)) {
    const stat = fs.statSync(resolved);
    if (!stat.isDirectory()) {
      throw new Error('Selected path is a file, not a folder');
    }
  } else if (createIfMissing) {
    fs.mkdirSync(resolved, { recursive: true });
  }

  return resolved;
}

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
  const targetDir = resolveSafeSaveDir(payload.saveDir, true);

  const generatedWallets = [];
  const savedFiles = [];

  for (let i = 0; i < count; i++) {
    const wallet = generateSolanaWallet({ wordCount, accountIndex: 0 });
    const shortAddress = `${wallet.publicKey.slice(0, 6)}...${wallet.publicKey.slice(-6)}`;
    let individualFilename = null;

    if (count === 1 || payload.saveMode !== 'combined') {
      individualFilename = `${prefix}_${timestamp}_${wallet.publicKey.slice(0, 8)}.txt`;
      const filePath = path.join(targetDir, individualFilename);
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
    const batchFilePath = path.join(targetDir, batchFilename);
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
    walletsDir: targetDir,
    count,
    wordCount,
    wallets: generatedWallets,
    savedFiles,
    batchFilename,
  };
}
/**
 * List all saved .txt wallet files in target directory
 */
function listSavedFiles(customDir = '') {
  const targetDir = resolveSafeSaveDir(customDir, false);
  if (!fs.existsSync(targetDir)) return { targetDir, files: [] };
  const files = fs.readdirSync(targetDir).filter((f) => f.endsWith('.txt'));
  const mapped = files
    .map((filename) => {
      const fullPath = path.join(targetDir, filename);
      const stat = fs.statSync(fullPath);
      return {
        filename,
        fullPath,
        size: stat.size,
        createdAt: stat.birthtime || stat.mtime,
      };
    })
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

  return { targetDir, files: mapped };
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
    try {
      const dirParam = parsedUrl.searchParams.get('dir') || '';
      const { targetDir, files } = listSavedFiles(dirParam);
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      return res.end(
        JSON.stringify({
          walletsDir: targetDir,
          defaultDir: WALLETS_DIR,
          files,
        })
      );
    } catch (err) {
      res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
      return res.end(JSON.stringify({ error: err.message }));
    }
  }

  // API: Open native Windows folder picker dialog
  if (req.method === 'POST' && pathname === '/api/pick-folder') {
    if (process.platform !== 'win32') {
      res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
      return res.end(JSON.stringify({ error: 'Native folder picker is only supported on Windows' }));
    }

    const psScript = [
      'Add-Type -AssemblyName System.Windows.Forms',
      '$dialog = New-Object System.Windows.Forms.FolderBrowserDialog',
      '$dialog.Description = "เลือกโฟลเดอร์สำหรับบันทึกไฟล์ Seed Phrase (.txt)"',
      '$dialog.ShowNewFolderButton = $true',
      'if ($dialog.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) { Write-Output $dialog.SelectedPath }',
    ].join('; ');

    execFile('powershell', ['-NoProfile', '-STA', '-Command', psScript], (err, stdout) => {
      if (err) {
        res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
        return res.end(JSON.stringify({ error: 'Failed to open folder dialog' }));
      }
      const selectedPath = (stdout || '').trim();
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      return res.end(
        JSON.stringify({
          cancelled: !selectedPath,
          path: selectedPath || null,
        })
      );
    });
    return;
  }

  // API: Check single wallet SOL & SPL token balance
  if (req.method === 'GET' && pathname === '/api/balance') {
    const address = (parsedUrl.searchParams.get('address') || '').trim();
    const network = parsedUrl.searchParams.get('network') === 'devnet' ? 'devnet' : 'mainnet';
    if (!address) {
      res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
      return res.end(JSON.stringify({ error: 'Missing wallet address' }));
    }

    getWalletBalance(address, network)
      .then((result) => {
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify(result));
      })
      .catch((err) => {
        res.writeHead(502, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ error: err.message || 'Failed to fetch balance' }));
      });
    return;
  }

  // API: Batch check SOL balances for multiple wallets
  if (req.method === 'POST' && pathname === '/api/balances') {
    let body = '';
    req.on('data', (chunk) => {
      body += chunk;
      if (body.length > 1e6) req.socket.destroy();
    });

    req.on('end', () => {
      try {
        const payload = body ? JSON.parse(body) : {};
        const addresses = Array.isArray(payload.addresses) ? payload.addresses : [];
        const network = payload.network === 'devnet' ? 'devnet' : 'mainnet';

        getMultipleWalletBalances(addresses, network)
          .then((balances) => {
            res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
            res.end(JSON.stringify({ network, balances }));
          })
          .catch((err) => {
            res.writeHead(502, { 'Content-Type': 'application/json; charset=utf-8' });
            res.end(JSON.stringify({ error: err.message || 'Failed to fetch balances' }));
          });
      } catch (err) {
        res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ error: 'Invalid JSON payload' }));
      }
    });
    return;
  }

  // API: Read a specific saved .txt file
  if (req.method === 'GET' && pathname.startsWith('/api/files/')) {
    try {
      const rawName = decodeURIComponent(pathname.replace('/api/files/', ''));
      const safeName = path.basename(rawName);
      const dirParam = parsedUrl.searchParams.get('dir') || '';
      const targetDir = resolveSafeSaveDir(dirParam, false);
      const targetPath = path.join(targetDir, safeName);

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
    } catch (err) {
      res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
      return res.end(JSON.stringify({ error: err.message }));
    }
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


