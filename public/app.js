const generateForm = document.getElementById('generateForm');
const walletCountInput = document.getElementById('walletCount');
const walletLabelInput = document.getElementById('walletLabel');
const saveModeSelect = document.getElementById('saveMode');
const generateBtn = document.getElementById('generateBtn');
const generateBtnText = document.getElementById('generateBtnText');
const walletsContainer = document.getElementById('walletsContainer');
const resultCountEl = document.getElementById('resultCount');
const filesListEl = document.getElementById('filesList');
const refreshFilesBtn = document.getElementById('refreshFilesBtn');
const folderPathText = document.getElementById('folderPathText');
const saveAlert = document.getElementById('saveAlert');
const saveAlertTitle = document.getElementById('saveAlertTitle');
const saveAlertDesc = document.getElementById('saveAlertDesc');
const toggleSecretsBtn = document.getElementById('toggleSecretsBtn');

// Modal elements
const fileModal = document.getElementById('fileModal');
const modalFilename = document.getElementById('modalFilename');
const modalFilepath = document.getElementById('modalFilepath');
const modalFileContent = document.getElementById('modalFileContent');
const closeModalBtn = document.getElementById('closeModalBtn');
const copyModalContentBtn = document.getElementById('copyModalContentBtn');
const toastEl = document.getElementById('toast');

let secretsVisible = false;

function showToast(msg = 'คัดลอกลงคลิปบอร์ดแล้ว!') {
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
    showToast(label ? `คัดลอก ${label} แล้ว!` : 'คัดลอกลงคลิปบอร์ดแล้ว!');
  } catch {
    const textarea = document.createElement('textarea');
    textarea.value = text;
    document.body.appendChild(textarea);
    textarea.select();
    document.execCommand('copy');
    document.body.removeChild(textarea);
    showToast(label ? `คัดลอก ${label} แล้ว!` : 'คัดลอกลงคลิปบอร์ดแล้ว!');
  }
}

// Quick count chips
document.querySelectorAll('.chip-btn').forEach((btn) => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.chip-btn').forEach((b) => b.classList.remove('active'));
    btn.classList.add('active');
    walletCountInput.value = btn.dataset.count;
  });
});

walletCountInput.addEventListener('input', () => {
  document.querySelectorAll('.chip-btn').forEach((b) => {
    b.classList.toggle('active', b.dataset.count === walletCountInput.value);
  });
});

// Word count segmented radio
document.querySelectorAll('.segmented-control input[name="wordCount"]').forEach((radio) => {
  radio.addEventListener('change', () => {
    document.querySelectorAll('.segmented-control .segment').forEach((seg) => {
      seg.classList.remove('active');
    });
    radio.closest('.segment').classList.add('active');
  });
});

// Toggle Private Key visibility
toggleSecretsBtn.addEventListener('click', () => {
  secretsVisible = !secretsVisible;
  document.querySelectorAll('.secret-box').forEach((el) => {
    el.classList.toggle('masked', !secretsVisible);
  });
  toggleSecretsBtn.textContent = secretsVisible ? '🙈 ซ่อน Private Key' : '👁️ แสดง/ซ่อน Private Key';
});

// Render generated wallets
function renderWallets(wallets, batchFilename) {
  resultCountEl.textContent = wallets.length;
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
          <span>#${idx + 1}</span>
          <span>Solana Wallet (${w.wordCount} Words)</span>
        </div>
        ${
          targetFile
            ? `<button type="button" class="saved-file-pill" data-open-file="${targetFile}" title="คลิกเพื่อดูไฟล์ .txt ที่บันทึกไว้">
                📄 ${targetFile}
              </button>`
            : ''
        }
      </div>

      <div class="field-block">
        <div class="field-label-row">
          <span class="field-label">Public Address (Solana)</span>
          <button type="button" class="copy-btn" data-copy="${w.publicKey}" data-label="Public Address">📋 คัดลอก Address</button>
        </div>
        <div class="mono-box address-box">${w.publicKey}</div>
      </div>

      <div class="field-block">
        <div class="field-label-row">
          <span class="field-label">Seed Phrase / Mnemonic (${w.wordCount} คำ)</span>
          <button type="button" class="copy-btn" data-copy="${w.mnemonic}" data-label="Seed Phrase">📋 คัดลอก Seed Phrase</button>
        </div>
        <div class="seed-grid">${seedWordsHtml}</div>
      </div>

      <div class="field-block">
        <div class="field-label-row">
          <span class="field-label">Private Key (Base58 - สำหรับ Import เข้า Phantom / Solflare)</span>
          <button type="button" class="copy-btn" data-copy="${w.privateKeyBase58}" data-label="Private Key">📋 คัดลอก Private Key</button>
        </div>
        <div class="mono-box secret-box ${secretsVisible ? '' : 'masked'}" title="ชี้เมาส์หรือกดปุ่มด้านบนเพื่อดู">${w.privateKeyBase58}</div>
      </div>
    `;

    walletsContainer.appendChild(card);
  });

  // Bind copy buttons
  walletsContainer.querySelectorAll('[data-copy]').forEach((btn) => {
    btn.addEventListener('click', () => {
      copyText(btn.getAttribute('data-copy'), btn.getAttribute('data-label'));
    });
  });

  // Bind open file pill buttons
  walletsContainer.querySelectorAll('[data-open-file]').forEach((btn) => {
    btn.addEventListener('click', () => {
      openFileModal(btn.getAttribute('data-open-file'));
    });
  });
}

// Fetch & render saved files in ./wallets/
async function loadSavedFiles() {
  try {
    const res = await fetch('/api/files');
    const data = await res.json();

    if (data.walletsDir) {
      folderPathText.textContent = data.walletsDir;
    }

    if (!data.files || data.files.length === 0) {
      filesListEl.innerHTML = `<div class="empty-files">ยังไม่มีไฟล์ .txt ในโฟลเดอร์ <code>wallets/</code></div>`;
      return;
    }

    filesListEl.innerHTML = '';
    data.files.forEach((file) => {
      const item = document.createElement('div');
      item.className = 'file-item';
      const dateStr = new Date(file.createdAt).toLocaleString('th-TH');
      const sizeKb = (file.size / 1024).toFixed(1);

      item.innerHTML = `
        <div class="file-item-info">
          <div class="file-item-name">📄 ${file.filename}</div>
          <div class="file-item-meta">${dateStr} • ${sizeKb} KB</div>
        </div>
        <span class="file-item-action">เปิดดู →</span>
      `;

      item.addEventListener('click', () => openFileModal(file.filename));
      filesListEl.appendChild(item);
    });
  } catch (err) {
    console.error('Failed to load files:', err);
  }
}

// Open modal to inspect saved .txt file
async function openFileModal(filename) {
  try {
    const res = await fetch(`/api/files/${encodeURIComponent(filename)}`);
    if (!res.ok) throw new Error('File not found');
    const data = await res.json();

    modalFilename.textContent = data.filename;
    modalFilepath.textContent = data.fullPath;
    modalFileContent.textContent = data.content;
    fileModal.classList.remove('hidden');
  } catch (err) {
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

refreshFilesBtn.addEventListener('click', loadSavedFiles);

// Handle Form Submit -> Generate Wallets & Save .txt to Folder
generateForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const count = parseInt(walletCountInput.value, 10) || 1;
  const wordCountRadio = document.querySelector('input[name="wordCount"]:checked');
  const wordCount = wordCountRadio ? parseInt(wordCountRadio.value, 10) : 12;
  const label = walletLabelInput.value.trim();
  const saveMode = saveModeSelect.value;

  generateBtn.disabled = true;
  generateBtnText.textContent = 'กำลังสร้างกระเป๋าและบันทึกไฟล์...';

  try {
    const res = await fetch('/api/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ count, wordCount, label, saveMode }),
    });

    const data = await res.json();
    if (!res.ok || !data.success) {
      throw new Error(data.error || 'เกิดข้อผิดพลาดในการสร้างกระเป๋า');
    }

    renderWallets(data.wallets, data.batchFilename);

    // Show confirmation alert with saved file location
    saveAlert.classList.remove('hidden');
    saveAlertTitle.textContent = `สร้างกระเป๋า Solana จำนวน ${data.count} ใบ และบันทึกไฟล์ .txt สำเร็จ!`;
    const fileNamesSummary = data.savedFiles.map((f) => f.filename).slice(0, 3).join(', ');
    const moreCount = data.savedFiles.length > 3 ? ` และอีก ${data.savedFiles.length - 3} ไฟล์` : '';
    saveAlertDesc.innerHTML = `บันทึกไว้ในโฟลเดอร์: <code>${data.walletsDir}</code> (${fileNamesSummary}${moreCount})`;

    await loadSavedFiles();
  } catch (err) {
    alert(err.message);
  } finally {
    generateBtn.disabled = false;
    generateBtnText.textContent = 'Generate & บันทึกไฟล์ .txt ลงโฟลเดอร์';
  }
});

// Initial load
loadSavedFiles();

