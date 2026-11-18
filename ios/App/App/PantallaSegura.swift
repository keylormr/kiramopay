import UIKit
import Capacitor

// Protege la pantalla mientras la app muestra o recibe las palabras de la
// billetera propia (src/billetera/pantalla.ts la prende y la apaga).
//
// iOS no tiene el equivalente de FLAG_SECURE de Android. Lo que si se puede
// hacer, y es lo que se hace aqui: cuando la app deja de estar activa (se abre
// el selector de apps, llega una llamada, se bloquea el telefono) se pone una
// tapa del color de la app sobre el contenido, para que la miniatura que el
// sistema guarda del selector de apps no muestre las palabras. La tapa se quita
// al volver a estar activa.
//
// Cubre el selector de apps. NO impide una captura de pantalla ni una grabacion
// mientras la app esta activa.
@objc(PantallaSeguraPlugin)
public class PantallaSeguraPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "PantallaSeguraPlugin"
    public let jsName = "PantallaSegura"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "activar", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "desactivar", returnType: CAPPluginReturnPromise)
    ]

    private var activa = false
    private var tapa: UIView?
    private var observadores: [NSObjectProtocol] = []

    @objc override public func load() {
        let centro = NotificationCenter.default
        observadores.append(centro.addObserver(forName: UIApplication.willResignActiveNotification, object: nil, queue: OperationQueue.main) { [weak self] _ in
            self?.ponerTapa()
        })
        observadores.append(centro.addObserver(forName: UIApplication.didBecomeActiveNotification, object: nil, queue: OperationQueue.main) { [weak self] _ in
            self?.quitarTapa()
        })
    }

    deinit {
        for observador in observadores {
            NotificationCenter.default.removeObserver(observador)
        }
    }

    // Se contesta cuando la bandera ya esta puesta: la web no muestra las
    // palabras antes de recibir la respuesta.
    @objc func activar(_ call: CAPPluginCall) {
        DispatchQueue.main.async { [weak self] in
            self?.activa = true
            call.resolve()
        }
    }

    @objc func desactivar(_ call: CAPPluginCall) {
        DispatchQueue.main.async { [weak self] in
            self?.activa = false
            self?.quitarTapa()
            call.resolve()
        }
    }

    private func ponerTapa() {
        guard activa, tapa == nil, let ventana = bridge?.viewController?.view.window else { return }
        let vista = UIView(frame: ventana.bounds)
        vista.autoresizingMask = [.flexibleWidth, .flexibleHeight]
        // Es el fondo de la app en oscuro (#050B18, el backgroundColor de capacitor.config.ts).
        vista.backgroundColor = UIColor(red: 5.0 / 255.0, green: 11.0 / 255.0, blue: 24.0 / 255.0, alpha: 1.0)
        ventana.addSubview(vista)
        tapa = vista
    }

    private func quitarTapa() {
        tapa?.removeFromSuperview()
        tapa = nil
    }
}

// Vista principal de la app: la de Capacitor, mas los plugins propios (los que
// no vienen de npm se registran aqui, no en el CLI). Main.storyboard apunta a
// esta clase.
class KiramoViewController: CAPBridgeViewController {
    override open func capacitorDidLoad() {
        bridge?.registerPluginInstance(PantallaSeguraPlugin())
    }
}
