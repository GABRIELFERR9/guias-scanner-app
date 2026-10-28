package br.com.cbro.guias;

import android.os.Bundle;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(EnviarWhatsAppPlugin.class);
        registerPlugin(LerTextoPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
