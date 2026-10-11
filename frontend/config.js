window.MICRO_SEDAT_CONFIG = {
  // Leave empty when the site is served by the same Cloudflare Worker as the API.
  // Set to the Worker URL (for example "https://micro-sedat.example.workers.dev")
  // only when the frontend is hosted separately, such as on GitHub Pages.
  apiBaseUrl: '',
  // Optional: pre-fill the shared access code. Prefer entering it in the UI,
  // which stores it in localStorage instead of a public configuration file.
  accessCode: ''
};
