import { useEffect, useRef, useState } from 'react';
import { Card, CardHeader, CardTitle, CardContent, Button, Spinner, showToast } from '@ury/ui';
import { ImagePlus } from 'lucide-react';
import { brandingService } from '../../services/branding';
import { uploadImageFile } from '../../utils/uploadFile';

export const BrandingPage: React.FC = () => {
  const [logoUrl, setLogoUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    brandingService
      .getLogo()
      .then(setLogoUrl)
      .catch(() => showToast.error('Não foi possível carregar o logo atual.'))
      .finally(() => setLoading(false));
  }, []);

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;

    if (!file.type.startsWith('image/')) {
      showToast.error('Selecione um arquivo de imagem.');
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      showToast.error('A imagem deve ter no máximo 5MB.');
      return;
    }

    setUploading(true);
    try {
      const fileUrl = await uploadImageFile(file);
      const savedUrl = await brandingService.setLogo(fileUrl);
      setLogoUrl(savedUrl);
      showToast.success('Logo atualizado com sucesso.');
    } catch {
      showToast.error('Não foi possível enviar o logo. Tente novamente.');
    } finally {
      setUploading(false);
    }
  }

  return (
    <div className="space-y-4 max-w-xl">
      <h1 className="text-xl font-semibold">Identidade Visual</h1>

      <Card>
        <CardHeader>
          <CardTitle>Logo do restaurante</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Esse logo aparece no painel administrativo, na tela da cozinha e na página de pedidos
            do cliente.
          </p>

          {loading ? (
            <Spinner message="Carregando logo..." />
          ) : (
            <div className="flex items-center gap-4">
              <div className="flex h-20 w-20 shrink-0 items-center justify-center rounded-lg border border-dashed border-gray-300 bg-muted/30 overflow-hidden">
                {logoUrl ? (
                  <img src={logoUrl} alt="Logo atual" className="h-full w-full object-contain" />
                ) : (
                  <ImagePlus className="h-6 w-6 text-muted-foreground" />
                )}
              </div>

              <div className="space-y-2">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={uploading}
                  onClick={() => fileInputRef.current?.click()}
                >
                  {uploading ? 'Enviando...' : logoUrl ? 'Trocar logo' : 'Enviar logo'}
                </Button>
                <p className="text-xs text-muted-foreground">PNG ou JPG, até 5MB.</p>
              </div>

              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={handleFileChange}
              />
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
};

export default BrandingPage;
