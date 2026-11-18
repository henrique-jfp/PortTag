import { useCallback, useEffect, useRef, useState } from "react";
import { Camera, Check, RotateCcw, X } from "lucide-react";

type CameraCaptureProps = {
  onCapture: (file: File) => void;
  onClose: () => void;
  onFallback: () => void;
};

type CapturedPhoto = { file: File; url: string };

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
 * Prefere a captura nativa do aparelho (ImageCapture). Desenhar o frame do
 * <video> no canvas gera uma foto com o foco do preview e resolves baixa — foi
 * o que deixou as etiquetas embaçadas na primeira versão deste visor.
 */
async function takeNativePhoto(stream: MediaStream): Promise<Blob | null> {
  const ImageCaptureCtor = (
    globalThis as unknown as {
      ImageCapture?: new (track: MediaStreamTrack) => { takePhoto: () => Promise<Blob> };
    }
  ).ImageCapture;
  const track = stream.getVideoTracks()[0];
  if (!ImageCaptureCtor || !track) return null;
  try {
    const imageCapture = new ImageCaptureCtor(track);
    return await imageCapture.takePhoto();
  } catch {
    return null;
  }
}

async function takeCanvasPhoto(video: HTMLVideoElement): Promise<Blob> {
  const canvas = document.createElement("canvas");
  canvas.width = video.videoWidth;
  canvas.height = video.videoHeight;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Canvas indisponível");
  context.drawImage(video, 0, 0, canvas.width, canvas.height);
  const blob = await new Promise<Blob | null>((resolve) => {
    canvas.toBlob(resolve, "image/jpeg", 1);
  });
  if (!blob) throw new Error("Não foi possível capturar a imagem");
  return blob;
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
  const [captured, setCaptured] = useState<CapturedPhoto | null>(null);
  const cameraActive = captured === null;
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
    if (!cameraActive || cameraUnavailable) return;
    let active = true;

    void (async () => {
      try {
        let stream: MediaStream;
        try {
          // Sem travar largura/altura: deixamos o aparelho usar a resolução
          // nativa. Pedir 1600x1200 fazia alguns modelos escolherem a câmera
          // frontal ou um sensor de baixa resolução.
          stream = await navigator.mediaDevices.getUserMedia({
            audio: false,
            video: { facingMode: { exact: "environment" } },
          });
        } catch {
          stream = await navigator.mediaDevices.getUserMedia({
            audio: false,
            video: { facingMode: "environment" },
          });
        }
        if (!active) {
          stream.getTracks().forEach((track) => track.stop());
          return;
        }
        streamRef.current = stream;
        const track = stream.getVideoTracks()[0];
        // Ignorado em aparelhos que não expõem controle de foco. O tipo do
        // DOM não conhece focusMode, mas o Chrome/Android aceita.
        const focusConstraint = {
          focusMode: "continuous",
        } as unknown as MediaTrackConstraintSet;
        void track?.applyConstraints({ advanced: [focusConstraint] }).catch(() => {});
        const video = videoRef.current;
        if (video) {
          video.srcObject = stream;
          await video.play().catch(() => {
            // Alguns navegadores só iniciam após a interação.
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
  }, [cameraActive, cameraUnavailable, stopCamera]);

  useEffect(() => {
    return () => {
      if (captured) URL.revokeObjectURL(captured.url);
    };
  }, [captured]);

  async function capture() {
    const video = videoRef.current;
    if (capturing) return;
    setCapturing(true);
    try {
      if (video?.paused) await video.play();
      const stream = streamRef.current;
      const blob =
        (stream ? await takeNativePhoto(stream) : null) ??
        (video ? await takeCanvasPhoto(video) : null);
      if (!blob) throw new Error("Não foi possível capturar a imagem");
      const file = new File([blob], `etiqueta-${Date.now()}.jpg`, {
        type: blob.type || "image/jpeg",
        lastModified: Date.now(),
      });
      stopCamera();
      setCaptured({ file, url: URL.createObjectURL(file) });
    } catch {
      setError("Não foi possível capturar a foto. Tente novamente.");
    } finally {
      setCapturing(false);
    }
  }

  function retake() {
    setCaptured(null);
    setError("");
    setStarting(true);
  }

  return (
    <div className="porter-camera-overlay" role="dialog" aria-modal="true">
      <div className="porter-camera-panel">
        <div className="porter-camera-header">
          <strong>{captured ? "Confira a foto" : "Fotografar etiqueta"}</strong>
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

        {captured ? (
          <img
            className="porter-camera-captured"
            src={captured.url}
            alt="Foto da etiqueta tirada agora"
          />
        ) : (
          <video
            ref={videoRef}
            className="porter-camera-video"
            autoPlay
            playsInline
            muted
          />
        )}

        {starting && cameraActive && (
          <p className="porter-camera-hint" role="status">
            Abrindo a câmera...
          </p>
        )}
        {error && <p className="porter-error">{error}</p>}
        {cameraActive && !error && (
          <p className="porter-camera-footnote">
            Aponte para a etiqueta, espere o foco estabilizar e toque em capturar.
          </p>
        )}

        <div className="porter-camera-actions">
          {captured ? (
            <>
              <button
                type="button"
                className="porter-camera-button"
                onClick={() => onCapture(captured.file)}
              >
                <Check size={22} aria-hidden="true" />
                <span>Usar esta foto</span>
              </button>
              <button type="button" className="porter-secondary-button" onClick={retake}>
                <RotateCcw size={18} aria-hidden="true" />
                Tirar novamente
              </button>
            </>
          ) : (
            <>
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
            </>
          )}
        </div>
        {!captured && (
          <p className="porter-camera-footnote">
            A foto fica apenas neste aparelho e é usada só para ler a etiqueta.
          </p>
        )}
      </div>
    </div>
  );
}
