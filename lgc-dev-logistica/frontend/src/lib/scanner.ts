/** Leitura por câmera via BarcodeDetector (Chrome/Android). Sem suporte, a tela cai para digitação/coletor USB. */
interface Detector { detect(source: CanvasImageSource): Promise<Array<{ rawValue: string }>> }
declare const BarcodeDetector: (new (opts?: { formats?: string[] }) => Detector) | undefined;

export const cameraSupported = () => typeof BarcodeDetector !== 'undefined' && !!navigator.mediaDevices?.getUserMedia;

/** Abre a câmera traseira e chama onCode a cada código novo. Retorna a função que encerra a leitura. */
export async function startCamera(video: HTMLVideoElement, onCode: (code: string) => void): Promise<() => void> {
  const detector = new BarcodeDetector!({ formats: ['qr_code', 'code_128', 'ean_13', 'ean_8', 'code_39', 'itf', 'data_matrix'] });
  const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' } }, audio: false });
  video.srcObject = stream;
  await video.play();
  let stopped = false;
  let last = '';
  let lastAt = 0;
  const tick = async () => {
    if (stopped) return;
    try {
      const found = await detector.detect(video);
      const v = found[0]?.rawValue;
      // Evita repetir o mesmo código em sequência (leitura contínua do mesmo QR).
      if (v && (v !== last || Date.now() - lastAt > 2500)) { last = v; lastAt = Date.now(); navigator.vibrate?.(60); onCode(v); }
    } catch { /* quadro sem imagem: ignora */ }
    setTimeout(tick, 150);
  };
  void tick();
  return () => { stopped = true; stream.getTracks().forEach((t) => t.stop()); video.srcObject = null; };
}
