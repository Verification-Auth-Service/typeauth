const KEY = "typeauth_demo_token";
const VERIFIER_KEY = "typeauth_demo_pkce_verifier";
const STATE_KEY = "typeauth_demo_oauth_state";

export function saveToken(token: string) {
  sessionStorage.setItem(KEY, token);
}
export function loadToken(): string | null {
  return sessionStorage.getItem(KEY);
}
export function clearToken() {
  sessionStorage.removeItem(KEY);
}

export function saveVerifier(v: string) {
  sessionStorage.setItem(VERIFIER_KEY, v);
}
export function loadVerifier(): string | null {
  return sessionStorage.getItem(VERIFIER_KEY);
}
export function clearVerifier() {
  sessionStorage.removeItem(VERIFIER_KEY);
}

export function saveState(s: string) {
  sessionStorage.setItem(STATE_KEY, s);
}
export function loadState(): string | null {
  return sessionStorage.getItem(STATE_KEY);
}
export function clearState() {
  sessionStorage.removeItem(STATE_KEY);
}
