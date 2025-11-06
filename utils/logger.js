const crypto = require('crypto');

const maskSensitive = (text) => {
  if (!text || typeof text !== 'string') return '*'.repeat(11);
  
  // Hide everything as asterisks
  return '*'.repeat(Math.max(text.length, 11));
};

const encryptForLog = (text, key = process.env.ENCRYPTION_KEY) => {
  if (!text) return '';
  
  try {
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv('aes-256-cbc', Buffer.from(key || 'default-key', 'hex'), iv);
    
    let encrypted = cipher.update(text, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    
    return `[ENC:${iv.toString('hex').substring(0, 8)}...${encrypted.substring(0, 8)}...]`;
  } catch (err) {
    return '[ENCRYPTED]';
  }
};

module.exports = { maskSensitive, encryptForLog };
