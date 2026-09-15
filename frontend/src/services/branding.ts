import { call } from '@ury/core';

interface LogoResponse {
  logo_url: string | null;
}

function unwrap<T>(res: unknown, fallback: T): T {
  if (res && typeof res === 'object' && 'message' in res) {
    return (res as { message: T }).message ?? fallback;
  }
  return (res as T) ?? fallback;
}

export const brandingService = {
  async getLogo(): Promise<string | null> {
    const res = await call<LogoResponse>('ury.ury.api.branding.get_logo');
    return unwrap<LogoResponse>(res, { logo_url: null }).logo_url;
  },

  async setLogo(fileUrl: string): Promise<string | null> {
    const res = await call<LogoResponse>('ury.ury.api.branding.set_logo', { file_url: fileUrl });
    return unwrap<LogoResponse>(res, { logo_url: null }).logo_url;
  },
};
