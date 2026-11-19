import { useEffect, useState } from "react";
import { RefreshCw, Wifi, WifiOff, QrCode, Send, AlertTriangle } from "lucide-react";
import { supabase } from "../lib/supabase";

type WhatsAppStatus = "disconnected" | "connecting" | "connected";

type InstanceInfo = {
  status: WhatsAppStatus;
  configured: boolean;
  instance: string;
  qrCode?: string | null;
};

export function WhatsAppSettings({
  condominiumId,
}: {
  condominiumId: string;
}) {
  const [loading, setLoading] = useState(true);
  const [info, setInfo] = useState<InstanceInfo | null>(null);
  const [qrCode, setQrCode] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [testPhone, setTestPhone] = useState("");
  const [connecting, setConnecting] = useState(false);
  const [sending, setSending] = useState(false);
  const [polling, setPolling] = useState(false);

  async function fetchStatus() {
    setError("");
    setLoading(true);
    try {
      const { data, error: fnErr } = await supabase.functions.invoke(
        "manage-condominium-whatsapp",
        { body: { action: "status", condominiumId } },
      );
      if (fnErr) {
        setError(fnErr.message);
        return;
      }
      setInfo(data as InstanceInfo);
      if ((data as InstanceInfo)?.status === "connected") {
        setQrCode(null);
        setPolling(false);
      }
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Falha ao consultar status.",
      );
    } finally {
      setLoading(false);
    }
  }

  async function connect() {
    setError("");
    setSuccess("");
    setConnecting(true);
    try {
      const { data, error: fnErr } = await supabase.functions.invoke(
        "manage-condominium-whatsapp",
        { body: { action: "connect", condominiumId } },
      );
      if (fnErr) {
        setError(fnErr.message);
        return;
      }
      const result = data as InstanceInfo;
      setInfo(result);
      if (result.qrCode) {
        setQrCode(result.qrCode);
        setPolling(true);
      }
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Falha ao conectar.",
      );
    } finally {
      setConnecting(false);
    }
  }

  async function disconnect() {
    if (!confirm("Desconectar o WhatsApp da portaria? O envio automático será desativado.")) return;
    setError("");
    setSuccess("");
    try {
      const { data, error: fnErr } = await supabase.functions.invoke(
        "manage-condominium-whatsapp",
        { body: { action: "disconnect", condominiumId } },
      );
      if (fnErr) {
        setError(fnErr.message);
        return;
      }
      setInfo(data as InstanceInfo);
      setQrCode(null);
      setPolling(false);
      setSuccess("WhatsApp desconectado.");
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Falha ao desconectar.",
      );
    }
  }

  async function sendTest() {
    if (!testPhone.trim()) {
      setError("Digite um número para o teste.");
      return;
    }
    setError("");
    setSuccess("");
    setSending(true);
    try {
      const { data, error: fnErr } = await supabase.functions.invoke(
        "manage-condominium-whatsapp",
        {
          body: {
            action: "test-message",
            condominiumId,
            phoneNumber: testPhone,
          },
        },
      );
      if (fnErr) {
        setError(fnErr.message);
        return;
      }
      if ((data as { success: boolean })?.success) {
        setSuccess("Mensagem de teste enviada com sucesso!");
        setTestPhone("");
      } else {
        setError((data as { error?: string })?.error || "Falha no envio.");
      }
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Falha ao enviar teste.",
      );
    } finally {
      setSending(false);
    }
  }

  useEffect(() => {
    void fetchStatus();
  }, [condominiumId]);

  // Polling durante QR Code
  useEffect(() => {
    if (!polling) return;
    const interval = setInterval(() => {
      void fetchStatus();
    }, 5000);
    return () => clearInterval(interval);
  }, [polling, condominiumId]);

  const status = info?.status ?? "disconnected";

  return (
    <div className="manager-whatsapp-settings">
      <div className="manager-whatsapp-header">
        <h3>WhatsApp da Portaria</h3>
        <button
          type="button"
          className="text-button"
          onClick={() => void fetchStatus()}
          disabled={loading}
          title="Atualizar status"
        >
          <RefreshCw size={16} className={loading ? "spin" : ""} />
        </button>
      </div>

      {error && <p className="porter-error">{error}</p>}
      {success && <p className="porter-success">{success}</p>}

      <div className="manager-whatsapp-status">
        {status === "connected" ? (
          <>
            <span className="manager-whatsapp-badge manager-whatsapp-connected">
              <Wifi size={14} /> Conectado
            </span>
            <p>
              Os avisos de encomenda serão enviados <strong>automaticamente</strong> pelo WhatsApp.
              Se a conexão cair, o porteiro poderá enviar manualmente.
            </p>
          </>
        ) : status === "connecting" ? (
          <>
            <span className="manager-whatsapp-badge manager-whatsapp-connecting">
              <QrCode size={14} /> Aguardando conexão...
            </span>
            <p>Escaneie o QR Code abaixo com o WhatsApp do celular da portaria.</p>
          </>
        ) : (
          <>
            <span className="manager-whatsapp-badge manager-whatsapp-disconnected">
              <WifiOff size={14} /> Desconectado
            </span>
            <p>
              O WhatsApp automático não está configurado. Os porteiros precisam enviar
              os avisos manualmente pelo link <code>wa.me</code>.
            </p>
          </>
        )}
      </div>

      {qrCode && (
        <div className="manager-whatsapp-qr">
          <img
            src={qrCode.startsWith("data:") ? qrCode : `data:image/png;base64,${qrCode}`}
            alt="QR Code para conectar o WhatsApp"
          />
          <small>Abra o WhatsApp → Aparelhos conectados → Conectar dispositivo</small>
        </div>
      )}

      <div className="manager-whatsapp-actions">
        {status === "disconnected" && (
          <button
            type="button"
            className="manager-primary-button"
            onClick={() => void connect()}
            disabled={connecting}
          >
            <QrCode size={16} />
            {connecting ? "Gerando QR Code..." : "Conectar WhatsApp"}
          </button>
        )}

        {status === "connected" && (
          <>
            <div className="manager-whatsapp-test">
              <input
                type="tel"
                placeholder="Número para teste (ex: 21999999999)"
                value={testPhone}
                onChange={(e) => setTestPhone(e.target.value)}
              />
              <button
                type="button"
                className="manager-primary-button"
                onClick={() => void sendTest()}
                disabled={sending}
              >
                <Send size={14} />
                {sending ? "Enviando..." : "Enviar teste"}
              </button>
            </div>
            <button
              type="button"
              className="text-button manager-whatsapp-disconnect"
              onClick={() => void disconnect()}
            >
              <AlertTriangle size={14} /> Desconectar WhatsApp
            </button>
          </>
        )}

        {status === "connecting" && !qrCode && (
          <button
            type="button"
            className="manager-primary-button"
            onClick={() => void connect()}
            disabled={connecting}
          >
            <QrCode size={16} />
            {connecting ? "Gerando..." : "Gerar novo QR Code"}
          </button>
        )}
      </div>
    </div>
  );
}
