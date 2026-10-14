import { IntegrationError } from './json-socket.ts';

/** Preserve the diagnostic code; never echo arbitrary remote payloads or credentials. */
export const rpcError = (command: string, data: unknown): IntegrationError => {
  const record = data !== null && typeof data === 'object' ? data as Record<string, unknown> : {};
  const code = typeof record.code === 'number' && Number.isSafeInteger(record.code) ? record.code : undefined;
  const detail = typeof record.message === 'string' ? record.message : '';
  const reason = code === 4007 ? 'Application ID invalide.'
    : code === 4008 ? 'Origine OAuth de l’application refusée.'
    : code === 4009 ? 'Jeton OAuth invalide ou révoqué. Autorise à nouveau l’application.'
    : code === 4006 ? 'Permissions RPC insuffisantes. Vérifie l’accès de l’application et de ton compte.'
    : code === 5000 && /redirect_uri/i.test(detail) ? 'URI de redirection OAuth manquante ou invalide. Ajoute l’URI indiquée dans OAuth2 → Redirects du Developer Portal.'
    : code === 5000 && /invalid_scope/i.test(detail) ? 'Scopes OAuth refusés. L’accès RPC de cette application doit être vérifié auprès de Discord.'
    : code === 5000 && /access_denied/i.test(detail) ? 'Autorisation OAuth refusée. Tu peux relancer la demande dans Discord.'
    : code === 5000 ? 'Échec OAuth. Vérifie la configuration de l’application dans le Developer Portal.'
    : 'Commande refusée par Discord.';
  return new IntegrationError({ message: `Discord RPC ${command}${code === undefined ? '' : ` (${code})`} : ${reason}` });
};
