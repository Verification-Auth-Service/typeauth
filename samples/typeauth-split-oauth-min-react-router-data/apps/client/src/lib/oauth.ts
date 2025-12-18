import {
  AUTH_SERVER_BASE,
  REGISTERED_REDIRECT_URI,
  AUDIENCE,
} from "@typeauth/shared";
import { randomVerifier, challengeS256 } from "./pkce";
import { saveState, saveVerifier } from "./storage";

export async function startLogin() {
  const verifier = randomVerifier(64);
  const challenge = await challengeS256(verifier);
  const state = crypto.randomUUID();

  saveVerifier(verifier);
  saveState(state);

  const authorize = new URL(AUTH_SERVER_BASE + "/oauth/authorize");
  authorize.searchParams.set("response_type", "code");
  authorize.searchParams.set("client_id", AUDIENCE); // demo uses same value
  authorize.searchParams.set("redirect_uri", REGISTERED_REDIRECT_URI);
  authorize.searchParams.set("scope", "read write profile");
  authorize.searchParams.set("state", state);
  authorize.searchParams.set("code_challenge", challenge);
  authorize.searchParams.set("code_challenge_method", "S256");

  window.location.assign(authorize.toString());
}
