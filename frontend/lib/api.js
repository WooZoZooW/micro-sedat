export function createClientError(code, details) {
  const error = new Error(code);
  error.code = code;
  if (details !== undefined) error.details = details;
  return error;
}

export function submitSubmission({
  apiBaseUrl = '',
  accessCode = '',
  formData,
  onProgress,
  xhrFactory,
  timeoutMs = 180000,
} = {}) {
  return new Promise((resolve, reject) => {
    const xhr = typeof xhrFactory === 'function' ? xhrFactory() : new XMLHttpRequest();
    const url = `${apiBaseUrl || ''}/api/submissions`;

    try {
      xhr.open('POST', url);
    } catch {
      reject(createClientError('NETWORK_ERROR'));
      return;
    }

    xhr.timeout = timeoutMs;
    try {
      xhr.setRequestHeader('Accept', 'application/json');
      if (accessCode) xhr.setRequestHeader('X-Access-Code', accessCode);
    } catch {
      // Some test doubles do not implement setRequestHeader; ignore.
    }

    if (xhr.upload) {
      xhr.upload.onprogress = (event) => {
        if (event && event.lengthComputable && typeof onProgress === 'function') {
          const percent = Math.max(0, Math.min(99, Math.round((event.loaded / event.total) * 100)));
          onProgress(percent);
        }
      };
    }

    xhr.onload = () => {
      let payload = null;
      try {
        payload = JSON.parse(xhr.responseText);
      } catch {
        payload = null;
      }
      if (xhr.status >= 200 && xhr.status < 300 && payload && payload.ok) {
        if (typeof onProgress === 'function') onProgress(100);
        resolve(payload);
        return;
      }
      const code = payload?.error?.code || `HTTP_${xhr.status}`;
      reject(createClientError(code, payload?.error?.message));
    };
    xhr.onerror = () => reject(createClientError('NETWORK_ERROR'));
    xhr.ontimeout = () => reject(createClientError('TIMEOUT'));
    xhr.onabort = () => reject(createClientError('ABORTED'));

    try {
      xhr.send(formData);
    } catch {
      reject(createClientError('NETWORK_ERROR'));
    }
  });
}

export function fetchHealth({ apiBaseUrl = '', fetchImpl } = {}) {
  const doFetch = fetchImpl || fetch;
  return doFetch(`${apiBaseUrl || ''}/api/health`, { headers: { Accept: 'application/json' } })
    .then((response) => (response.ok ? response.json() : null))
    .catch(() => null);
}
