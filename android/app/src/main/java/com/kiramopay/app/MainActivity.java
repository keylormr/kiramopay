package com.kiramopay.app;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {

    @Override
    public void onCreate(Bundle savedInstanceState) {
        // Los plugins propios de la app (no los de npm) se registran antes de
        // super.onCreate(): es ahi donde el puente los recoge.
        registerPlugin(PantallaSeguraPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
