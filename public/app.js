const generateForm = document.getElementById('generateForm');
const walletCountInput = document.getElementById('walletCount');
const savePathInput = document.getElementById('savePathInput');
const browseFolderBtn = document.getElementById('browseFolderBtn');
const walletLabelInput = document.getElementById('walletLabel');
const saveModeSelect = document.getElementById('saveMode');
const generateBtn = document.getElementById('generateBtn');
const generateBtnText = document.getElementById('generateBtnText');
const quickGenerateBtn = document.getElementById('quickGenerateBtn');
const walletsContainer = document.getElementById('walletsContainer');
const resultCountEl = document.getElementById('resultCount');
const resultCountNavEl = document.getElementById('resultCountNav');
const filesCountNavEl = document.getElementById('filesCountNav');
const filesListEl = document.getElementById('filesList');
const refreshFilesBtn = document.getElementById('refreshFilesBtn');
const activeFolderDisplay = document.getElementById('activeFolderDisplay');
const saveStatusText = document.getElementById('saveStatusText');
const toggleSecretsBtn = document.getElementById('toggleSecretsBtn');
const networkSelect = document.getElementById('networkSelect');
const checkAllBalancesBtn = document.getElementById('checkAllBalancesBtn');

// Modal elements
const fileModal = document.getElementById('fileModal');
const modalFilename = document.getElementById('modalFilename');
const modalFilepath = document.getElementById('modalFilepath');
const modalFileContent = document.getElementById('modalFileContent');
const modalBalancesBox = document.getElementById('modalBalancesBox');
const checkModalBalanceBtn = document.getElementById('checkModalBalanceBtn');
const closeModalBtn = document.getElementById('closeModalBtn');
const copyModalContentBtn = document.getElementById('copyModalContentBtn');
const toastEl = document.getElementById('toast');

const STORAGE_DIR_KEY = 'solgen_save_dir';
let secretsVisible = false;
let currentWallets = [];
let modalAddresses = [];

async function parseJsonSafe(res) {
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(
      res.status === 404
        ? 'ไม่พบ API นี้บนเซิร์ฟเวอร์ (กรุณารีสตาร์ทเซิร์ฟเวอร์ด้วยคำสั่ง npm start ใหม่)'
        : `Server ตอบกลับไม่ถูกต้อง (${res.status}): ${text.slice(0, 80)}`
    );
  }
}

// Restore saved folder path if any
const savedDirPref = localStorage.getItem(STORAGE_DIR_KEY);
if (savedDirPref) {
  savePathInput.value = savedDirPref;
}

function getActiveSaveDir() {
  return savePathInput.value.trim();
}

function showToast(msg = 'คัดลอกลงคลิปบอร์ดแล้ว') {
  toastEl.textContent = msg;
  toastEl.classList.remove('hidden');
  clearTimeout(window.__toastTimer);
  window.__toastTimer = setTimeout(() => {
    toastEl.classList.add('hidden');
  }, 2200);
}

async function copyText(text, label = '') {
  try {
    await navigator.clipboard.writeText(text);
    showToast(label ? `คัดลอก ${label} แล้ว` : 'คัดลอกลงคลิปบอร์ดแล้ว');
  } catch {
    const textarea = document.createElement('textarea');
    textarea.value = text;
    document.body.appendChild(textarea);
    textarea.select();
    document.execCommand('copy');
    document.body.removeChild(textarea);
    showToast(label ? `คัดลอก ${label} แล้ว` : 'คัดลอกลงคลิปบอร์ดแล้ว');
  }
}

// Quick count chips
document.querySelectorAll('.chip').forEach((btn) => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.chip').forEach((b) => b.classList.remove('active'));
    btn.classList.add('active');
    walletCountInput.value = btn.dataset.count;
  });
});

walletCountInput.addEventListener('input', () => {
  document.querySelectorAll('.chip').forEach((b) => {
    b.classList.toggle('active', b.dataset.count === walletCountInput.value);
  });
});

// Word count toggle (12 / 24)
document.querySelectorAll('.word-toggle input[name="wordCount"]').forEach((radio) => {
  radio.addEventListener('change', () => {
    document.querySelectorAll('.word-toggle .word-option').forEach((opt) => {
      opt.classList.remove('active');
    });
    radio.closest('.word-option').classList.add('active');
  });
});

// Toggle Private Key visibility
toggleSecretsBtn.addEventListener('click', () => {
  secretsVisible = !secretsVisible;
  document.querySelectorAll('.secret-box').forEach((el) => {
    el.classList.toggle('masked', !secretsVisible);
  });
  toggleSecretsBtn.textContent = secretsVisible ? 'Hide Private Keys' : 'Show Private Keys';
});

// Navbar Quick Generate button triggers form submit
quickGenerateBtn.addEventListener('click', () => {
  generateForm.requestSubmit();
});

// Browse native folder dialog
browseFolderBtn.addEventListener('click', async () => {
  browseFolderBtn.disabled = true;
  const oldText = browseFolderBtn.textContent;
  browseFolderBtn.textContent = 'กำลังเปิด...';
  try {
    const res = await fetch('/api/pick-folder', { method: 'POST' });
    const data = await parseJsonSafe(res);
    if (!res.ok) {
      throw new Error(data.error || 'ไม่สามารถเปิดหน้าต่างเลือกโฟลเดอร์ได้');
    }
    if (!data.cancelled && data.path) {
      savePathInput.value = data.path;
      localStorage.setItem(STORAGE_DIR_KEY, data.path);
      showToast('เลือกโฟลเดอร์ปลายทางแล้ว');
      await loadSavedFiles();
    }
  } catch (err) {
    alert(err.message);
  } finally {
    browseFolderBtn.disabled = false;
    browseFolderBtn.textContent = oldText;
  }
});

// Save custom path on blur/change
savePathInput.addEventListener('change', () => {
  const dir = getActiveSaveDir();
  if (dir) {
    localStorage.setItem(STORAGE_DIR_KEY, dir);
  } else {
    localStorage.removeItem(STORAGE_DIR_KEY);
  }
  loadSavedFiles();
});

// Render generated wallets
function renderWallets(wallets, batchFilename) {
  currentWallets = wallets;
  resultCountEl.textContent = wallets.length;
  if (resultCountNavEl) resultCountNavEl.textContent = wallets.length;
  walletsContainer.innerHTML = '';

  wallets.forEach((w, idx) => {
    const words = w.mnemonic.split(' ');
    const card = document.createElement('div');
    card.className = 'wallet-card';

    const targetFile = w.savedFilename || batchFilename;

    const seedWordsHtml = words
      .map(
        (word, i) => `
        <div class="seed-word">
          <span class="idx">${i + 1}.</span>
          <span>${word}</span>
        </div>`
      )
      .join('');

    card.innerHTML = `
      <div class="wallet-card-top">
        <div class="wallet-badge">
          Wallet #${idx + 1} (${w.wordCount} Words)
        </div>
        <div class="wallet-card-right">
          <span class="balance-pill" data-balance-for="${w.publicKey}">— SOL</span>
          <button type="button" class="btn-check-bal" data-check-balance="${w.publicKey}">เช็คยอด</button>
          ${
            targetFile
              ? `<button type="button" class="saved-file-pill" data-open-file="${targetFile}" title="คลิกเพื่อเปิดดูไฟล์ .txt">
                  ${targetFile}
                </button>`
              : ''
          }
        </div>
      </div>

      <div class="field-block">
        <div class="field-label-row">
          <span class="field-label">Public Address</span>
          <button type="button" class="copy-btn" data-copy="${w.publicKey}" data-label="Public Address">Copy</button>
        </div>
        <div class="mono-box">${w.publicKey}</div>
        <div class="token-tags hidden" data-tokens-for="${w.publicKey}"></div>
      </div>

      <div class="field-block">
        <div class="field-label-row">
          <span class="field-label">Seed Phrase (${w.wordCount} Words)</span>
          <button type="button" class="copy-btn" data-copy="${w.mnemonic}" data-label="Seed Phrase">Copy</button>
        </div>
        <div class="seed-grid">${seedWordsHtml}</div>
      </div>

      <div class="field-block">
        <div class="field-label-row">
          <span class="field-label">Private Key (Base58)</span>
          <button type="button" class="copy-btn" data-copy="${w.privateKeyBase58}" data-label="Private Key">Copy</button>
        </div>
        <div class="mono-box secret-box ${secretsVisible ? '' : 'masked'}" title="ชี้เมาส์เพื่อดู">${w.privateKeyBase58}</div>
      </div>
    `;

    walletsContainer.appendChild(card);
  });

  walletsContainer.querySelectorAll('[data-copy]').forEach((btn) => {
    btn.addEventListener('click', () => {
      copyText(btn.getAttribute('data-copy'), btn.getAttribute('data-label'));
    });
  });

  walletsContainer.querySelectorAll('[data-open-file]').forEach((btn) => {
    btn.addEventListener('click', () => {
      openFileModal(btn.getAttribute('data-open-file'));
    });
  });

  walletsContainer.querySelectorAll('[data-check-balance]').forEach((btn) => {
    btn.addEventListener('click', () => {
      checkSingleWalletBalance(btn.getAttribute('data-check-balance'), btn);
    });
  });
}

function updateBalanceUI(address, sol, tokens = []) {
  const pill = document.querySelector(`[data-balance-for="${address}"]`);
  if (pill) {
    pill.textContent = `${Number(sol).toFixed(4)} SOL`;
    pill.classList.toggle('has-balance', sol > 0);
  }
  const tokenBox = document.querySelector(`[data-tokens-for="${address}"]`);
  if (tokenBox) {
    if (tokens && tokens.length > 0) {
      tokenBox.innerHTML = tokens
        .map((t) => `<span class="token-tag">${t.uiAmountString} (${t.mint.slice(0, 4)}...${t.mint.slice(-4)})</span>`)
        .join('');
      tokenBox.classList.remove('hidden');
    } else {
      tokenBox.classList.add('hidden');
    }
  }
}

async function checkSingleWalletBalance(address, btnEl) {
  const network = networkSelect ? networkSelect.value : 'mainnet';
  const oldText = btnEl.textContent;
  btnEl.disabled = true;
  btnEl.textContent = 'กำลังเช็ค...';
  try {
    const res = await fetch(
      `/api/balance?address=${encodeURIComponent(address)}&network=${encodeURIComponent(network)}`
    );
    const data = await parseJsonSafe(res);
    if (!res.ok) throw new Error(data.error || 'เช็คยอดเงินไม่สำเร็จ');
    updateBalanceUI(address, data.sol, data.tokens || []);
  } catch (err) {
    showToast(err.message);
  } finally {
    btnEl.disabled = false;
    btnEl.textContent = oldText;
  }
}

if (checkAllBalancesBtn) {
  checkAllBalancesBtn.addEventListener('click', async () => {
    if (!currentWallets || currentWallets.length === 0) {
      showToast('ยังไม่มีกระเป๋าให้เช็คยอดเงิน');
      return;
    }
    const network = networkSelect ? networkSelect.value : 'mainnet';
    const addresses = currentWallets.map((w) => w.publicKey);
    const oldText = checkAllBalancesBtn.textContent;
    checkAllBalancesBtn.disabled = true;
    checkAllBalancesBtn.textContent = 'กำลังเช็ค...';

    try {
      const res = await fetch('/api/balances', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ addresses, network }),
      });
      const data = await parseJsonSafe(res);
      if (!res.ok) throw new Error(data.error || 'เช็คยอดเงินไม่สำเร็จ');
      (data.balances || []).forEach((b) => updateBalanceUI(b.address, b.sol));
      showToast(`เช็คยอดเงิน ${data.balances.length} กระเป๋า (${network}) แล้ว`);
    } catch (err) {
      showToast(err.message);
    } finally {
      checkAllBalancesBtn.disabled = false;
      checkAllBalancesBtn.textContent = oldText;
    }
  });
}

// Fetch & render saved files in active directory
async function loadSavedFiles() {
  try {
    const dir = getActiveSaveDir();
    const query = dir ? `?dir=${encodeURIComponent(dir)}` : '';
    const res = await fetch(`/api/files${query}`);
    const data = await parseJsonSafe(res);

    if (!res.ok) {
      throw new Error(data.error || 'ไม่สามารถอ่านโฟลเดอร์ได้');
    }

    if (data.walletsDir && activeFolderDisplay) {
      activeFolderDisplay.textContent = data.walletsDir;
      activeFolderDisplay.title = data.walletsDir;
    }

    const files = data.files || [];
    if (filesCountNavEl) filesCountNavEl.textContent = files.length;

    if (files.length === 0) {
      filesListEl.innerHTML = `<div class="empty-minimal">ยังไม่มีไฟล์ .txt ในโฟลเดอร์นี้</div>`;
      return;
    }

    filesListEl.innerHTML = '';
    files.forEach((file) => {
      const item = document.createElement('div');
      item.className = 'file-item';
      const dateStr = new Date(file.createdAt).toLocaleString('th-TH');
      const sizeKb = (file.size / 1024).toFixed(1);

      item.innerHTML = `
        <div class="file-item-info">
          <div class="file-item-name">${file.filename}</div>
          <div class="file-item-meta">${dateStr} • ${sizeKb} KB</div>
        </div>
        <span class="file-item-action">View</span>
      `;

      item.addEventListener('click', () => openFileModal(file.filename));
      filesListEl.appendChild(item);
    });
  } catch (err) {
    filesListEl.innerHTML = `<div class="empty-minimal">${err.message}</div>`;
  }
}

// Open modal to inspect saved .txt file
async function openFileModal(filename) {
  try {
    const dir = getActiveSaveDir();
    const query = dir ? `?dir=${encodeURIComponent(dir)}` : '';
    const res = await fetch(`/api/files/${encodeURIComponent(filename)}${query}`);
    const data = await parseJsonSafe(res);
    if (!res.ok) throw new Error(data.error || 'File not found');

    modalFilename.textContent = data.filename;
    modalFilepath.textContent = data.fullPath;
    modalFileContent.textContent = data.content;

    // Extract Solana Public Addresses from .txt file
    const matches = [...data.content.matchAll(/Public Address\s*:\s*([1-9A-HJ-NP-Za-km-z]{32,44})/g)];
    modalAddresses = [...new Set(matches.map((m) => m[1]))];
    modalBalancesBox.classList.add('hidden');
    modalBalancesBox.innerHTML = '';

    if (checkModalBalanceBtn) {
      checkModalBalanceBtn.classList.toggle('hidden', modalAddresses.length === 0);
    }

    fileModal.classList.remove('hidden');
  } catch {
    showToast('ไม่สามารถเปิดอ่านไฟล์ได้');
  }
}

closeModalBtn.addEventListener('click', () => {
  fileModal.classList.add('hidden');
});

fileModal.addEventListener('click', (e) => {
  if (e.target === fileModal) {
    fileModal.classList.add('hidden');
  }
});

copyModalContentBtn.addEventListener('click', () => {
  copyText(modalFileContent.textContent, 'เนื้อหาไฟล์ .txt');
});

if (checkModalBalanceBtn) {
  checkModalBalanceBtn.addEventListener('click', async () => {
    if (modalAddresses.length === 0) return;
    const network = networkSelect ? networkSelect.value : 'mainnet';
    const oldText = checkModalBalanceBtn.textContent;
    checkModalBalanceBtn.disabled = true;
    checkModalBalanceBtn.textContent = 'กำลังเช็ค...';
    try {
      const res = await fetch('/api/balances', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ addresses: modalAddresses, network }),
      });
      const data = await parseJsonSafe(res);
      if (!res.ok) throw new Error(data.error || 'เช็คยอดเงินไม่สำเร็จ');

      modalBalancesBox.innerHTML = (data.balances || [])
        .map(
          (b) => `
          <div class="modal-bal-row">
            <span>${b.address}</span>
            <strong>${Number(b.sol).toFixed(4)} SOL (${b.network})</strong>
          </div>`
        )
        .join('');
      modalBalancesBox.classList.remove('hidden');
    } catch (err) {
      showToast(err.message);
    } finally {
      checkModalBalanceBtn.disabled = false;
      checkModalBalanceBtn.textContent = oldText;
    }
  });
}

refreshFilesBtn.addEventListener('click', loadSavedFiles);

// Handle Form Submit -> Generate Wallets & Save .txt to chosen folder
generateForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const count = parseInt(walletCountInput.value, 10) || 1;
  const wordCountRadio = document.querySelector('input[name="wordCount"]:checked');
  const wordCount = wordCountRadio ? parseInt(wordCountRadio.value, 10) : 12;
  const label = walletLabelInput.value.trim();
  const saveMode = saveModeSelect.value;
  const saveDir = getActiveSaveDir();

  generateBtn.disabled = true;
  generateBtnText.textContent = 'Generating...';

  try {
    const res = await fetch('/api/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ count, wordCount, label, saveMode, saveDir }),
    });

    const data = await parseJsonSafe(res);
    if (!res.ok || !data.success) {
      throw new Error(data.error || 'เกิดข้อผิดพลาดในการสร้างกระเป๋า');
    }

    renderWallets(data.wallets, data.batchFilename);

    const latestFile = data.savedFiles[0]?.filename || '';
    saveStatusText.textContent = `บันทึกแล้ว: ${latestFile} (${data.savedFiles.length} ไฟล์) ที่ ${data.walletsDir}`;
    showToast(`สร้าง ${data.count} กระเป๋าและบันทึกไฟล์ .txt แล้ว`);

    await loadSavedFiles();
  } catch (err) {
    alert(err.message);
  } finally {
    generateBtn.disabled = false;
    generateBtnText.textContent = 'Generate & Save .txt';
  }
});

// Initial load
loadSavedFiles();
