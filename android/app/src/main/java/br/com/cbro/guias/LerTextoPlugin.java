package br.com.cbro.guias;

import android.net.Uri;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.google.mlkit.vision.common.InputImage;
import com.google.mlkit.vision.text.TextRecognition;
import com.google.mlkit.vision.text.TextRecognizer;
import com.google.mlkit.vision.text.latin.TextRecognizerOptions;

/**
 * OCR de uma imagem via ML Kit (offline). Recebe o caminho/URI de uma foto
 * escaneada e devolve o texto reconhecido, para o JS extrair o nome do paciente.
 */
@CapacitorPlugin(name = "LerTexto")
public class LerTextoPlugin extends Plugin {

    @PluginMethod
    public void reconhecer(PluginCall call) {
        String path = call.getString("path");
        if (path == null || path.isEmpty()) {
            call.reject("path ausente");
            return;
        }
        try {
            Uri uri = Uri.parse(path);
            InputImage image = InputImage.fromFilePath(getContext(), uri);
            TextRecognizer recognizer = TextRecognition.getClient(TextRecognizerOptions.DEFAULT_OPTIONS);
            recognizer.process(image)
                .addOnSuccessListener(text -> {
                    JSObject ret = new JSObject();
                    ret.put("texto", text.getText());
                    call.resolve(ret);
                })
                .addOnFailureListener(e -> call.reject("Falha no OCR: " + e.getMessage()));
        } catch (Exception e) {
            call.reject("Falha ao abrir imagem: " + e.getMessage());
        }
    }
}
