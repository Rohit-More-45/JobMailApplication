/**
 * JobMail - ChatGPT Support Script
 *
 * Minimal script for ChatGPT webview:
 * Ensures smooth normal browsing without interfering with user interaction.
 */

export const CHATGPT_INJECTION_SCRIPT = `
(function() {
  window.__JOBMAIL_CHATGPT_READY__ = true;
})();
true;
`;
