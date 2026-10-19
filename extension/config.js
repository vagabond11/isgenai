// The isGenAI origin the extension talks to. For local development, point it at your own
// server (and add that origin to host_permissions in manifest.json); never ship that change.
// Shared with service-worker.js (importScripts) and side-panel.js (script tag) as a global.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const ISGENAI_ORIGIN = "https://isgenai.com";
