function normalizePhone(raw) {
  const digits = String(raw || '').replace(/\D/g, '');
  if (!digits) return null;
  if (digits.length === 9) return `+998${digits}`;
  if (digits.length === 12 && digits.startsWith('998')) return `+${digits}`;
  if (digits.length >= 10 && digits.length <= 15) return `+${digits}`;
  return null;
}

function maskPhone(phone) {
  const normalized = normalizePhone(phone);
  if (!normalized) return 'телефон не указан';
  return `${normalized.slice(0, 7)} *** ** ${normalized.slice(-2)}`;
}

module.exports = { normalizePhone, maskPhone };
