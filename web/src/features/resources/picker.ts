// Google's Picker ("choose from Drive"), loaded only when the owner clicks the button.
// Needs a Google Cloud project: docs/google-picker.md. The browser asks Google for a short-lived
// token with the drive.file scope; nothing is sent to or stored on our server. The Picker only
// hands back each file's name, address and type, which become resources.
// This path cannot run without the owner's Google credentials, so it is not covered by tests.

export interface PickerConfig {
  enabled: boolean;
  client_id?: string;
  api_key?: string;
  app_id?: string | null;
}
export interface PickedFile {
  name: string;
  url: string;
  mimeType: string;
}

const loaded = new Map<string, Promise<void>>();
function loadScript(src: string): Promise<void> {
  let p = loaded.get(src);
  if (!p) {
    p = new Promise<void>((resolve, reject) => {
      const s = document.createElement('script');
      s.src = src;
      s.async = true;
      s.onload = () => resolve();
      s.onerror = () => {
        loaded.delete(src);
        reject(new Error('Could not load Google’s script. Check your connection or ad blocker.'));
      };
      document.head.appendChild(s);
    });
    loaded.set(src, p);
  }
  return p;
}

/** The kind hint for a file: pdf, image, folder or plain file (Google Docs are known from the address). */
export function hintFromMime(mime: string): 'pdf' | 'image' | 'folder' | 'file' {
  if (mime === 'application/pdf') return 'pdf';
  if (mime.startsWith('image/')) return 'image';
  if (mime === 'application/vnd.google-apps.folder') return 'folder';
  return 'file';
}

export async function openPicker(cfg: PickerConfig): Promise<PickedFile[]> {
  const w = window as any;
  await Promise.all([loadScript('https://apis.google.com/js/api.js'), loadScript('https://accounts.google.com/gsi/client')]);
  await new Promise<void>((resolve) => w.gapi.load('picker', { callback: resolve }));
  const token = await new Promise<string>((resolve, reject) => {
    const client = w.google.accounts.oauth2.initTokenClient({
      client_id: cfg.client_id,
      scope: 'https://www.googleapis.com/auth/drive.file',
      callback: (r: any) => (r.error ? reject(new Error(r.error_description || r.error)) : resolve(r.access_token)),
      error_callback: (e: any) => reject(new Error(e?.type === 'popup_closed' ? 'Google sign-in was closed' : (e?.message ?? 'Google sign-in failed'))),
    });
    client.requestAccessToken({ prompt: '' });
  });
  return new Promise<PickedFile[]>((resolve) => {
    const g = w.google.picker;
    const mine = new g.DocsView(g.ViewId.DOCS).setIncludeFolders(true).setSelectFolderEnabled(true);
    const shared = new g.DocsView(g.ViewId.DOCS).setIncludeFolders(true).setSelectFolderEnabled(true).setEnableDrives(true).setLabel('Shared drives');
    const b = new g.PickerBuilder()
      .addView(mine)
      .addView(shared)
      .enableFeature(g.Feature.MULTISELECT_ENABLED)
      .setOAuthToken(token)
      .setDeveloperKey(cfg.api_key)
      .setOrigin(`${location.protocol}//${location.host}`)
      .setTitle('Choose from Google Drive')
      .setCallback((data: any) => {
        if (data.action === g.Action.PICKED) resolve((data.docs as any[]).map((d) => ({ name: d.name, url: d.url, mimeType: d.mimeType })));
        else if (data.action === g.Action.CANCEL) resolve([]);
      });
    if (cfg.app_id) b.setAppId(cfg.app_id);
    b.build().setVisible(true);
  });
}
