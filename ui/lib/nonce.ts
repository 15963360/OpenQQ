// The server's CSP only allows <style> elements carrying this per-request nonce (see src/webui.mjs).
export const styleNonce = document.querySelector<HTMLMetaElement>('meta[name="style-nonce"]')?.content || undefined;

// react-remove-scroll (used by Radix dialogs) injects its scroll-lock style through get-nonce, which reads this global.
(globalThis as { __webpack_nonce__?: string }).__webpack_nonce__ = styleNonce;
