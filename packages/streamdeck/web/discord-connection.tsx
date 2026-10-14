import { useState } from 'react';
import type { Snapshot } from '../src/studio-contract.ts';
import * as Api from './api.ts';
import { RedirectUri } from '@nixfiles/system-control/discord-contract.ts';
export function DiscordConnection({
  snapshot,
  disabled,
  onSnapshot,
  onBusy,
}: {
  snapshot: Snapshot;
  disabled: boolean;
  onSnapshot: (snapshot: Snapshot) => void;
  onBusy: (busy: boolean) => void;
}) {
  const connection = snapshot.discordConnection;
  const [clientId, setClientId] = useState(connection.clientId);
  const [secret, setSecret] = useState('');
  const [busy, setBusy] = useState<'save' | 'authorize' | null>(null);
  const [error, setError] = useState('');
  const changed = clientId !== connection.clientId || secret !== '';
  const operation = async (kind: 'save' | 'authorize') => {
    setBusy(kind);
    onBusy(true);
    setError('');
    try {
      const next = await Api.run(
        kind === 'save'
          ? Api.configureDiscord({
              clientId: clientId.trim(),
              ...(secret ? { clientSecret: secret } : {}),
            })
          : Api.authorizeDiscord,
      );
      onSnapshot(next);
      if (kind === 'save') {
        setClientId(next.discordConnection.clientId);
        setSecret('');
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Connexion Discord impossible.');
    } finally {
      setBusy(null);
      onBusy(false);
    }
  };
  return (
    <section className="discord-connection" aria-label="Connexion Discord">
      <h3>
        Connexion Discord
        <span className="plugin-phase" role="status">
          {connection.authorized
            ? 'Autorisation enregistrée'
            : connection.configured
              ? 'À autoriser'
              : 'À configurer'}
        </span>
      </h3>
      <a
        href="https://discord.com/developers/applications"
        target="_blank"
        rel="noreferrer"
        title="Ton compte doit avoir accès au RPC comme testeur, ou l’application doit être approuvée par Discord."
      >
        Discord Developer Portal
      </a>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void operation('save');
        }}
      >
        <label>
          Redirect URI
          <input
            readOnly={true}
            value={RedirectUri}
            title="À ajouter dans OAuth2 → Redirects dans le Developer Portal."
          />
        </label>
        <label>
          Application ID
          <input
            value={clientId}
            inputMode="numeric"
            pattern="[0-9]{6,25}"
            required={true}
            disabled={disabled || !!busy}
            onChange={(event) => setClientId(event.currentTarget.value)}
          />
        </label>
        <label>
          Client secret
          <input
            type="password"
            value={secret}
            autoComplete="off"
            required={!connection.configured || clientId !== connection.clientId}
            placeholder={
              connection.configured ? 'Secret enregistré' : 'Depuis OAuth2 dans le portail'
            }
            disabled={disabled || !!busy}
            onChange={(event) => setSecret(event.currentTarget.value)}
          />
        </label>
        <div className="discord-connection-actions">
          <button
            type="submit"
            disabled={disabled || !!busy || (!changed && connection.configured)}
          >
            {busy === 'save' ? 'Enregistrement…' : 'Enregistrer l’application'}
          </button>
          <button
            type="button"
            disabled={disabled || !!busy || !connection.configured || changed}
            onClick={() => void operation('authorize')}
          >
            {busy === 'authorize' ? 'Autorisation en cours…' : 'Autoriser dans Discord'}
          </button>
        </div>
      </form>
      {busy === 'authorize' ? (
        <p className="field-hint" role="status">
          Valide la demande dans Discord. Elle peut rester ouverte deux minutes.
        </p>
      ) : null}
      {error ? (
        <p className="error" role="alert">
          {error}
        </p>
      ) : null}
    </section>
  );
}
