package com.kiramopay.app;

import android.view.Window;
import android.view.WindowManager;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * Protege la pantalla mientras la app muestra o recibe las palabras de la
 * billetera propia. Con FLAG_SECURE el sistema no deja sacar capturas ni
 * grabar la pantalla, y la miniatura de la app en recientes sale en blanco.
 *
 * La capa web la prende justo antes de mostrar las palabras y la apaga al
 * terminar (src/billetera/pantalla.ts). El resto de la app no queda protegido.
 * La bandera es de la ventana: si la actividad se destruye, vuelve a empezar sin ella.
 */
@CapacitorPlugin(name = "PantallaSegura")
public class PantallaSeguraPlugin extends Plugin {

    @PluginMethod
    public void activar(PluginCall call) {
        cambiar(call, true);
    }

    @PluginMethod
    public void desactivar(PluginCall call) {
        cambiar(call, false);
    }

    // Las banderas de la ventana se cambian en el hilo de la interfaz. Se
    // contesta cuando ya estan puestas: la web no muestra las palabras antes.
    private void cambiar(PluginCall call, boolean segura) {
        getActivity().runOnUiThread(() -> {
            try {
                Window ventana = getActivity().getWindow();
                if (segura) {
                    ventana.addFlags(WindowManager.LayoutParams.FLAG_SECURE);
                } else {
                    ventana.clearFlags(WindowManager.LayoutParams.FLAG_SECURE);
                }
                call.resolve();
            } catch (RuntimeException e) {
                call.reject("No se pudo cambiar la proteccion de la pantalla", e);
            }
        });
    }
}
