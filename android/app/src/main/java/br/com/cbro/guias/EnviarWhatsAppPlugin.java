package br.com.cbro.guias;

import android.content.Intent;
import android.content.pm.PackageManager;
import android.net.Uri;

import androidx.core.content.FileProvider;

import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.File;

/**
 * Envia um arquivo (guia PDF/ZIP) DIRETO para o WhatsApp, pulando a lista de apps.
 * Tenta WhatsApp normal, depois WhatsApp Business; se nenhum estiver instalado,
 * cai na folha de compartilhamento padrão. O arquivo é lido do diretório de
 * cache do app (onde o JS salva via Filesystem/Directory.Cache).
 */
@CapacitorPlugin(name = "EnviarWhatsApp")
public class EnviarWhatsAppPlugin extends Plugin {

    @PluginMethod
    public void enviar(PluginCall call) {
        String filename = call.getString("filename");
        String mime = call.getString("mimeType", "application/pdf");
        if (filename == null || filename.isEmpty()) {
            call.reject("filename ausente");
            return;
        }
        try {
            File file = new File(getContext().getCacheDir(), filename);
            if (!file.exists()) {
                call.reject("arquivo nao encontrado no cache");
                return;
            }

            String authority = getContext().getPackageName() + ".fileprovider";
            Uri uri = FileProvider.getUriForFile(getContext(), authority, file);

            // Descobre qual WhatsApp está instalado (normal ou Business).
            PackageManager pm = getContext().getPackageManager();
            String alvo = null;
            for (String p : new String[] { "com.whatsapp", "com.whatsapp.w4b" }) {
                try {
                    pm.getPackageInfo(p, 0);
                    alvo = p;
                    break;
                } catch (PackageManager.NameNotFoundException ignored) {
                }
            }

            Intent intent = new Intent(Intent.ACTION_SEND);
            intent.setType(mime);
            intent.putExtra(Intent.EXTRA_STREAM, uri);
            intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);

            if (alvo != null) {
                intent.setPackage(alvo);
                getContext().startActivity(intent);
            } else {
                // Sem WhatsApp instalado → lista padrão.
                Intent chooser = Intent.createChooser(intent, "Enviar guia");
                chooser.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                getContext().startActivity(chooser);
            }

            call.resolve();
        } catch (Exception e) {
            call.reject("Falha ao enviar: " + e.getMessage());
        }
    }
}
