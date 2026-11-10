const crypto = require('crypto');
const WORDLIST = require('./wordlist');

const BASE58_ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
const HARDENED_OFFSET = 0x80000000;

/**
 * Encode Buffer/Uint8Array into Base58 string (standard Bitcoin/Solana alphabet)
 */
function encodeBase58(buffer) {
  const bytes = Buffer.from(buffer);
  if (bytes.length === 0) return '';

  const digits = [0];
  for (let i = 0; i < bytes.length; i++) {
    let carry = bytes[i];
    for (let j = 0; j < digits.length; j++) {
      carry += digits[j] << 8;
      digits[j] = carry % 58;
      carry = (carry / 58) | 0;
    }
    while (carry > 0) {
      digits.push(carry % 58);
      carry = (carry / 58) | 0;
    }
  }

  let result = '';
  for (let i = 0; i < bytes.length && bytes[i] === 0; i++) {
    result += BASE58_ALPHABET[0];
  }
  for (let i = digits.length - 1; i >= 0; i--) {
    result += BASE58_ALPHABET[digits[i]];
  }
  return result;
}

/**
 * Convert buffer to binary string
 */
function bytesToBinary(buffer) {
  return Array.from(buffer)
    .map((b) => b.toString(2).padStart(8, '0'))
    .join('');
}

/**
 * Generate a BIP39 Mnemonic (12 or 24 words)
 * @param {number} wordCount 12 (128 bits entropy) or 24 (256 bits entropy)
 */
function generateMnemonic(wordCount = 12) {
  const strength = wordCount === 24 ? 256 : 128;
  const entropy = crypto.randomBytes(strength / 8);
  const hash = crypto.createHash('sha256').update(entropy).digest();

  const entropyBits = bytesToBinary(entropy);
  const checksumBits = bytesToBinary(hash).slice(0, strength / 32);
  const bits = entropyBits + checksumBits;

  const chunks = bits.match(/(.{1,11})/g);
  const words = chunks.map((binary) => {
    const index = parseInt(binary, 2);
    return WORDLIST[index];
  });

  return words.join(' ');
}

/**
 * Convert BIP39 Mnemonic to 64-byte Seed using PBKDF2-HMAC-SHA512
 */
function mnemonicToSeedSync(mnemonic, passphrase = '') {
  const mnemonicBuffer = Buffer.from(mnemonic.normalize('NFKD'), 'utf8');
  const saltBuffer = Buffer.from('mnemonic' + passphrase.normalize('NFKD'), 'utf8');
  return crypto.pbkdf2Sync(mnemonicBuffer, saltBuffer, 2048, 64, 'sha512');
}

/**
 * SLIP-0010 Ed25519 HD Key Derivation (Standard for Solana: m/44'/501'/0'/0')
 */
function getMasterKeyFromSeed(seed) {
  const hmac = crypto.createHmac('sha512', Buffer.from('ed25519 seed', 'utf8'));
  const I = hmac.update(seed).digest();
  return {
    key: I.subarray(0, 32),
    chainCode: I.subarray(32),
  };
}

function CKDPriv({ key, chainCode }, index) {
  const indexBuffer = Buffer.allocUnsafe(4);
  indexBuffer.writeUInt32BE(index, 0);

  const data = Buffer.concat([Buffer.alloc(1, 0), key, indexBuffer]);
  const I = crypto.createHmac('sha512', chainCode).update(data).digest();
  return {
    key: I.subarray(0, 32),
    chainCode: I.subarray(32),
  };
}

function derivePath(path, seed) {
  const master = getMasterKeyFromSeed(seed);
  const segments = path
    .split('/')
    .slice(1)
    .map((val) => parseInt(val.replace("'", ''), 10) + HARDENED_OFFSET);

  return segments.reduce((parentKeys, segment) => CKDPriv(parentKeys, segment), master);
}

/**
 * Create Ed25519 Keypair (32-byte Public Key, 64-byte Solana Secret Key) from 32-byte private seed
 */
function keypairFromSeed(seed32) {
  // PKCS#8 DER prefix for a 32-byte Ed25519 private key seed
  const pkcs8Prefix = Buffer.from('302e020100300506032b657004220420', 'hex');
  const privateKeyDer = Buffer.concat([pkcs8Prefix, seed32]);

  const privateKeyObj = crypto.createPrivateKey({
    key: privateKeyDer,
    format: 'der',
    type: 'pkcs8',
  });

  const publicKeyObj = crypto.createPublicKey(privateKeyObj);
  // SPKI DER for Ed25519 has a 12-byte header followed by the 32-byte raw public key
  const publicKeyDer = publicKeyObj.export({ format: 'der', type: 'spki' });
  const publicKeyBytes = publicKeyDer.subarray(12);

  // Solana secret key is 64 bytes: [32-byte private seed || 32-byte public key]
  const secretKeyBytes = Buffer.concat([seed32, publicKeyBytes]);

  return {
    publicKey: encodeBase58(publicKeyBytes),
    privateKeyBase58: encodeBase58(secretKeyBytes),
    secretKeyArray: Array.from(secretKeyBytes),
  };
}

/**
 * Generate a full Solana Wallet with BIP39 Seed Phrase and standard derivation path
 */
function generateSolanaWallet({ wordCount = 12, accountIndex = 0 } = {}) {
  const mnemonic = generateMnemonic(wordCount);
  const seed = mnemonicToSeedSync(mnemonic);
  const derivationPath = `m/44'/501'/${accountIndex}'/0'`;
  const { key } = derivePath(derivationPath, seed);
  const keypair = keypairFromSeed(key);

  return {
    mnemonic,
    wordCount: wordCount === 24 ? 24 : 12,
    derivationPath,
    publicKey: keypair.publicKey,
    privateKeyBase58: keypair.privateKeyBase58,
    secretKeyArray: keypair.secretKeyArray,
    createdAt: new Date().toISOString(),
  };
}

module.exports = {
  generateSolanaWallet,
  encodeBase58,
};

