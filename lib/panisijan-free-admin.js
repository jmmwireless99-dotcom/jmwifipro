/** PANISIJAN-only free WiFi admin scope (router 51). */
export const PANISIJAN_FREE_ADMIN_ROLE = "panisijan_free_admin";
export const PANISIJAN_ROUTER_ID = 51;

export function isPanisijanFreeAdmin(user) {
  return String(user?.role || "") === PANISIJAN_FREE_ADMIN_ROLE;
}

export function panisijanFreeAdminPayload(user) {
  if (!user) return null;
  return {
    id: user.id,
    username: user.username,
    role: PANISIJAN_FREE_ADMIN_ROLE,
    router_id: PANISIJAN_ROUTER_ID,
    site: "PANISIJAN",
  };
}
