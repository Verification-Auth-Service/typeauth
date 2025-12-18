import { RESOURCE_SERVER_BASE } from "@typeauth/shared";

export async function fetchMe(accessToken: string) {
  const res = await fetch(RESOURCE_SERVER_BASE + "/api/me", {
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });
  const json = await res.json().catch(() => null);
  return { ok: res.ok, status: res.status, json };
}
