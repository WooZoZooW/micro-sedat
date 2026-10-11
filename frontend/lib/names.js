export function sanitizeFilename(input, fallback = 'файл') {
  let name = typeof input === 'string' ? input : '';
  name = name
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .replace(/[\\/]+/g, '-')
    .replace(/\s+/g, ' ')
    .trim();
  name = name.replace(/^[.\s]+/, '');
  name = name.replace(/[.]{2,}/g, '.');
  if (name.length > 120) {
    const dot = name.lastIndexOf('.');
    const extension = dot > 0 && name.length - dot <= 12 ? name.slice(dot) : '';
    name = name.slice(0, 120 - extension.length) + extension;
  }
  return name.length > 0 ? name : fallback;
}

export function uniqueName(input, existingNames = []) {
  const used = new Set(
    (Array.isArray(existingNames) ? existingNames : [])
      .filter((name) => typeof name === 'string')
      .map((name) => name.toLowerCase()),
  );
  const clean = sanitizeFilename(input);
  if (!used.has(clean.toLowerCase())) return clean;

  const dot = clean.lastIndexOf('.');
  const base = dot > 0 ? clean.slice(0, dot) : clean;
  const extension = dot > 0 ? clean.slice(dot) : '';
  for (let i = 2; i < 1000; i += 1) {
    const candidate = `${base} (${i})${extension}`;
    if (!used.has(candidate.toLowerCase())) return candidate;
  }
  return `${base}-${Date.now()}${extension}`;
}

export function isImageFile(file) {
  return Boolean(file && typeof file.type === 'string' && file.type.startsWith('image/'));
}

export function fileExtensionLabel(name) {
  const value = typeof name === 'string' ? name : '';
  const dot = value.lastIndexOf('.');
  if (dot <= 0 || dot === value.length - 1) return 'ФАЙЛ';
  return value.slice(dot + 1).toUpperCase().slice(0, 5);
}
