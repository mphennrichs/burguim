import { call } from '@ury/core';

// Extracted from MenuPage.tsx's item-image upload flow (previously
// duplicated inline there) so any screen that needs to upload a file to
// Frappe's generic file store — this one included — shares the same
// dual-path logic instead of reimplementing it.

function extractFileUrl(res: unknown): string | null {
  if (!res) return null;
  const looksLikeUrl = (v: unknown): v is string =>
    typeof v === 'string' && (v.startsWith('/') || v.startsWith('http'));

  if (looksLikeUrl(res)) return res;

  const obj = res as Record<string, unknown>;
  if (looksLikeUrl(obj.file_url)) return obj.file_url;

  if (obj.message && typeof obj.message === 'object') {
    const message = obj.message as Record<string, unknown>;
    if (looksLikeUrl(message.file_url)) return message.file_url;
    if (looksLikeUrl(message.name)) return message.name;
  }
  if (looksLikeUrl(obj.message)) return obj.message as string;

  return null;
}

export async function uploadImageFile(file: File): Promise<string> {
  // 1. Primary Method: Standard Frappe multipart/form-data upload using fetch
  try {
    const formData = new FormData();
    formData.append('file', file, file.name);
    formData.append('filename', file.name);
    formData.append('file_name', file.name);
    formData.append('is_private', '0');

    const baseUrl = import.meta.env?.VITE_FRAPPE_BASE_URL || '';
    const uploadEndpoint = `${baseUrl}/api/method/upload_file`;

    const response = await fetch(uploadEndpoint, {
      method: 'POST',
      body: formData,
      headers: {
        Accept: 'application/json',
        'X-Frappe-CSRF-Token': (window as unknown as { csrf_token?: string }).csrf_token || '',
      },
      credentials: 'include',
    });

    if (response.ok) {
      const resJson = await response.json();
      const url = extractFileUrl(resJson);
      if (url) return url;
    }
  } catch (err) {
    console.warn('multipart FormData upload failed, falling back to call("upload_file")', err);
  }

  // 2. Fallback: call upload_file RPC using base64 with explicit file_name
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Failed to read image file'));
    reader.onload = async (event) => {
      const dataUrl = event.target?.result as string;
      if (!dataUrl) {
        reject(new Error('Failed to read image data'));
        return;
      }
      try {
        const base64Data = dataUrl.split(',')[1];
        const uploadRes = await call('upload_file', {
          file_name: file.name,
          filename: file.name,
          filedata: base64Data,
          is_private: 0,
        });
        const url = extractFileUrl(uploadRes);
        if (url) {
          resolve(url);
        } else {
          reject(new Error('Upload response did not contain a valid file URL'));
        }
      } catch (err) {
        reject(err instanceof Error ? err : new Error(String(err)));
      }
    };
    reader.readAsDataURL(file);
  });
}
