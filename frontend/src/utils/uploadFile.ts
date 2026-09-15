// Uploads through ury.ury.api.uploads.upload_image — a validated endpoint
// that actually decodes the file as an image before persisting it (see
// ury/ury/api/uploads.py), rather than Frappe's generic /api/method/
// upload_file, which accepts and serves any file type inline, SVG with an
// embedded <script> included (confirmed stored-XSS vector — any staff
// role can create a File, not just managers).

function extractErrorMessage(body: unknown): string | null {
  if (!body || typeof body !== 'object') return null;
  const obj = body as Record<string, unknown>;
  const raw = obj._server_messages;
  if (typeof raw !== 'string') return null;
  try {
    const messages = JSON.parse(raw) as string[];
    const first = messages[0];
    if (typeof first !== 'string') return null;
    const parsed = JSON.parse(first) as { message?: string };
    return parsed.message ?? null;
  } catch {
    return null;
  }
}

export async function uploadImageFile(file: File): Promise<string> {
  const formData = new FormData();
  formData.append('file', file, file.name);

  const baseUrl = import.meta.env?.VITE_FRAPPE_BASE_URL || '';
  const response = await fetch(`${baseUrl}/api/method/ury.ury.api.uploads.upload_image`, {
    method: 'POST',
    body: formData,
    headers: {
      Accept: 'application/json',
      'X-Frappe-CSRF-Token': (window as unknown as { csrf_token?: string }).csrf_token || '',
    },
    credentials: 'include',
  });

  const body = await response.json().catch(() => null);

  if (!response.ok) {
    throw new Error(extractErrorMessage(body) || 'Failed to upload image');
  }

  const fileUrl = (body as { message?: { file_url?: string } } | null)?.message?.file_url;
  if (!fileUrl) {
    throw new Error('Upload response did not contain a valid file URL');
  }
  return fileUrl;
}
