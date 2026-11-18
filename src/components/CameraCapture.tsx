import { useCallback, useEffect, useRef, useState } from "react";
import { Camera, X } from "lucide-react";

type CameraCaptureProps = {
  onCapture: (file: File) => void;
  onClose: () => void;
  onFallback: () => void;
};

function cameraErrorMessage(error: unknown) {
  const name = error instanceof Error ? error.name : "";
  if (name === "NotAllowedError" || name === "PermissionDeniedError") {
    return "Permissão de câmera negada. Libere o acesso no navegador e tente novamente.";
  }
  if (name === "NotFoundError" || name === "DevicesNotFoundError") {
    return "Nenhuma câmera foi encontrada neste aparelho.";
  }
  if (name === "NotReadableError" || name === "TrackStartError") {
    return "A câmera está ocupada por outro aplicativo. Feche outros apps e tente novamente.";
  }
  if (name === "OverconstrainedError") {
    return "Esta câmera não suporta a configuração solicitada. Tente a câmera do sistema.";
  }
  return "Não foi possível abrir a câmera. Tente a câmera do sistema.";
}

/**
 * Câmera dentro do próprio PWA. O input com `capture="environment"` abre o
 * aplicativo de câmera do Android; ao voltar, o sistema pode descartar o WebView
 * e o porteiro perde o que estava fazendo. Aqui a foto é tirada sem sair do app.
 */
export function CameraCapture({
  onCapture,
  onClose,
  onFallback,
}: CameraCaptureProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const cameraUnavailable =
    typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia;
  const [error, setError] = useState(
    cameraUnavailable ? "Este navegador não permite câmera dentro do app." : "",
  );
  const [starting, setStarting] = useState(!cameraUnavailable);
  const [capturing, setCapturing] = useState(false);

  const stopCamera = useCallback(() => {
    const stream = streamRef.current;
    streamRef.current = null;
    stream?.getTracks().forEach((track) => track.stop());
    if (videoRef.current) videoRef.current.srcObject = null;
  }, []);

  useEffect(() => {
    let active = true;
    if (cameraUnavailable) {
      return () => {
        active = false;
      };
    }

    void (async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: false,
          video: {
            facingMode: { ideal: "environment" },
            width: { ideal: 1600 },
            height: { ideal: 1200 },
          },
        });
        if (!active) {
          stream.getTracks().forEach((track) => track.stop());
          return;
        }
        streamRef.current = stream;
        const video = videoRef.current;
        if (video) {
          video.srcObject = stream;
          await video.play().catch(() => {
            // Alguns navegadores só iniciam após a interação; o botão abaixo
            // também chama play().
          });
        }
      } catch (cause) {
        if (active) setError(cameraErrorMessage(cause));
      } finally {
        if (active) setStarting(false);
      }
    })();

    return () => {
      active = false;
      stopCamera();
    };
  }, [cameraUnavailable, stopCamera]);

  async function capture() {
    const video = videoRef.current;
    if (!video?.videoWidth || !video.videoHeight || capturing) return;
    setCapturing(true);
    try {
      if (video.paused) await video.play();
      const canvas = document.createElement("canvas");
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      const context = canvas.getContext("2d");
      if (!context) throw new Error("Canvas indisponível");
      context.drawImage(video, 0, 0, canvas.width, canvas.height);
      const blob = await new Promise<Blob | null>((resolve) => {
        canvas.toBlob(resolve, "image/jpeg", 0.9);
      });
      if (!blob) throw new Error("Não foi possível capturar a imagem");
      const file = new File([blob], `etiqueta-${Date.now()}.jpg`, {
        type: "image/jpeg",
        lastModified: Date.now(),
      });
      stopCamera();
      onCapture(file);
    } catch {
      setError("Não foi possível capturar a foto. Tente novamente.");
      setCapturing(false);
    }
  }

  return (
    <div className="porter-camera-overlay" role="dialog" aria-modal="true">
      <div className="porter-camera-panel">
        <div className="porter-camera-header">
          <strong>Fotografar etiqueta</strong>
          <button
            type="button"
            className="porter-camera-close"
            onClick={() => {
              stopCamera();
              onClose();
            }}
            aria-label="Fechar câmera"
            disabled={capturing}
          >
            <X size={22} aria-hidden="true" />
          </button>
        </div>

        <video
          ref={videoRef}
          className="porter-camera-video"
          autoPlay
          playsInline
          muted
        />

        {starting && (
          <p className="porter-camera-hint" role="status">
            Abrindo a câmera...
          </p>
        )}
        {error && <p className="porter-error">{error}</p>}

        <div className="porter-camera-actions">
          {!error && (
            <button
              type="button"
              className="porter-camera-button"
              onClick={() => void capture()}
              disabled={starting || capturing}
            >
              <Camera size={22} aria-hidden="true" />
              <span>{capturing ? "Capturando..." : "Capturar foto"}</span>
            </button>
          )}
          <button
            type="button"
            className="porter-secondary-button"
            onClick={() => {
              stopCamera();
              onFallback();
            }}
            disabled={capturing}
          >
            Usar câmera do sistema
          </button>
        </div>
        <p className="porter-camera-footnote">
          A foto fica apenas neste aparelho e é usada só para ler a etiqueta.
        </p>
      </div>
    </div>
  );
}
