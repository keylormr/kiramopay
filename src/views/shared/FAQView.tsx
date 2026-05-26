
import React, { useState } from 'react';
import { Icons } from '../../components/Icons';

interface FAQViewProps {
  onClose: () => void;
}

interface FAQItem {
  id: string;
  question: string;
  answer: string;
  category: string;
}

const FAQ_DATA: FAQItem[] = [
  // General
  {
    id: '1',
    category: 'General',
    question: '¿Que es KiramoPay?',
    answer: 'KiramoPay es una billetera digital costarricense que te permite realizar pagos, transferencias SINPE Movil, pago de servicios, recargas telefonicas y mucho mas, todo desde tu celular de forma rapida y segura.'
  },
  {
    id: '2',
    category: 'General',
    question: '¿Es seguro usar KiramoPay?',
    answer: 'Si, KiramoPay utiliza los mas altos estandares de seguridad incluyendo encriptacion de datos, autenticacion biometrica, PIN de seguridad y monitoreo constante de transacciones para proteger tu dinero y tu informacion personal.'
  },
  {
    id: '3',
    category: 'General',
    question: '¿Como puedo crear una cuenta?',
    answer: 'Para crear una cuenta necesitas tu numero de cedula costarricense, un numero de telefono activo y un correo electronico. El proceso de registro toma solo unos minutos y podras comenzar a usar la app inmediatamente.'
  },
  // Cuentas y Saldos
  {
    id: '4',
    category: 'Cuentas y Saldos',
    question: '¿Como puedo agregar dinero a mi cuenta?',
    answer: 'Puedes agregar dinero a tu cuenta mediante: transferencia SINPE desde tu banco, deposito en puntos autorizados (supermercados, farmacias), o recibiendo pagos de otros usuarios de KiramoPay.'
  },
  {
    id: '5',
    category: 'Cuentas y Saldos',
    question: '¿Puedo tener cuentas en diferentes monedas?',
    answer: 'Si, KiramoPay te permite tener cuentas en colones (CRC) y dolares (USD). Puedes hacer cambios de moneda directamente desde la app con tasas competitivas.'
  },
  {
    id: '6',
    category: 'Cuentas y Saldos',
    question: '¿Cual es el limite de saldo que puedo tener?',
    answer: 'El limite depende de tu nivel de verificacion (KYC). Nivel basico: hasta 500,000 colones. Nivel intermedio: hasta 2,000,000 colones. Nivel completo: sin limite.'
  },
  // SINPE Movil
  {
    id: '7',
    category: 'SINPE Movil',
    question: '¿Que es SINPE Movil?',
    answer: 'SINPE Movil es el sistema de pagos instantaneos del Banco Central de Costa Rica que permite enviar y recibir dinero usando solo el numero de telefono del destinatario, las 24 horas del dia, los 7 dias de la semana.'
  },
  {
    id: '8',
    category: 'SINPE Movil',
    question: '¿Cuanto cuesta enviar dinero por SINPE?',
    answer: 'Los envios entre usuarios de KiramoPay son completamente gratis. Para envios a otros bancos, el costo es de 150 colones por transaccion.'
  },
  {
    id: '9',
    category: 'SINPE Movil',
    question: '¿Cual es el limite de SINPE Movil?',
    answer: 'El limite diario de SINPE Movil es de 500,000 colones segun la regulacion del Banco Central de Costa Rica. Puedes realizar multiples transacciones hasta alcanzar este limite.'
  },
  // Pagos y Servicios
  {
    id: '10',
    category: 'Pagos y Servicios',
    question: '¿Que servicios puedo pagar con KiramoPay?',
    answer: 'Puedes pagar servicios de electricidad (ICE, CNFL), agua (AyA), telefonia e internet (Kolbi, Claro, Movistar), cable, municipalidades, universidades y muchos mas. Tambien puedes hacer recargas telefonicas.'
  },
  {
    id: '11',
    category: 'Pagos y Servicios',
    question: '¿Puedo programar pagos automaticos?',
    answer: 'Si, puedes configurar pagos automaticos para tus servicios recurrentes. La app te notificara antes de cada pago y podras cancelarlo en cualquier momento.'
  },
  // Seguridad
  {
    id: '12',
    category: 'Seguridad',
    question: '¿Que hago si pierdo mi telefono?',
    answer: 'Contacta inmediatamente a nuestro soporte al 800-KIRAMO o desde otro dispositivo ingresa a kiramopay.com para bloquear tu cuenta. Tus fondos estaran seguros gracias a nuestras medidas de seguridad.'
  },
  {
    id: '13',
    category: 'Seguridad',
    question: '¿Como cambio mi PIN de seguridad?',
    answer: 'Ve a Perfil > Seguridad > Cambiar PIN. Deberas ingresar tu PIN actual y luego configurar uno nuevo. Te recomendamos usar un PIN que no sea facil de adivinar.'
  },
  {
    id: '14',
    category: 'Seguridad',
    question: '¿Como activo la autenticacion biometrica?',
    answer: 'Ve a Perfil > Seguridad > Biometria. Activa la opcion y sigue las instrucciones para registrar tu huella dactilar o Face ID. Esto te permitira acceder mas rapido y de forma segura.'
  },
  // Soporte
  {
    id: '15',
    category: 'Soporte',
    question: '¿Como contacto a soporte?',
    answer: 'Puedes contactarnos por: WhatsApp: +506 8888-0000, Telefono: 800-KIRAMO (547266), Email: soporte@kiramopay.cr, o a traves del chat en la app disponible 24/7.'
  },
  {
    id: '16',
    category: 'Soporte',
    question: '¿Que hago si una transaccion falla?',
    answer: 'Si una transaccion falla, tu dinero sera devuelto automaticamente en un plazo maximo de 24 horas. Si no ves el reembolso, contacta a soporte con el numero de referencia de la transaccion.'
  },
];

const CATEGORIES = [...new Set(FAQ_DATA.map(item => item.category))];

export const FAQView: React.FC<FAQViewProps> = ({ onClose }) => {
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [selectedCategory, setSelectedCategory] = useState<string>('General');
  const [searchQuery, setSearchQuery] = useState('');

  const filteredFAQs = FAQ_DATA.filter(item => {
    const matchesCategory = selectedCategory === 'Todas' || item.category === selectedCategory;
    const matchesSearch = searchQuery === '' ||
      item.question.toLowerCase().includes(searchQuery.toLowerCase()) ||
      item.answer.toLowerCase().includes(searchQuery.toLowerCase());
    return matchesCategory && matchesSearch;
  });

  const toggleExpand = (id: string) => {
    setExpandedId(expandedId === id ? null : id);
  };

  return (
    <div className="fixed inset-0 z-50 bg-[var(--color-background)] dark:bg-[var(--color-background-dark)] animate-in slide-in-from-right duration-300">
      {/* Header */}
      <div className="sticky top-0 z-10 bg-white/95 dark:bg-surface-dark/95 backdrop-blur-lg border-b border-[var(--color-border)] dark:border-[var(--color-border-dark)]">
        <div className="flex items-center justify-between px-4 h-14">
          <button
            onClick={onClose}
            className="p-2 -ml-2 rounded-full hover:bg-[var(--color-surface-muted)] dark:hover:bg-[var(--color-surface-muted-dark)]"
          >
            <Icons.ChevronLeft size={24} />
          </button>
          <h1 className="text-lg font-bold">Preguntas Frecuentes</h1>
          <div className="w-10" />
        </div>

        {/* Search */}
        <div className="px-4 pb-3">
          <div className="relative">
            <Icons.Search size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              type="text"
              placeholder="Buscar pregunta..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-10 pr-4 py-2.5 bg-[var(--color-surface-muted)] dark:bg-[var(--color-surface-muted-dark)] rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-primary"
            />
          </div>
        </div>

        {/* Categories */}
        <div className="px-4 pb-3 overflow-x-auto">
          <div className="flex gap-2">
            {CATEGORIES.map((category) => (
              <button
                key={category}
                onClick={() => setSelectedCategory(category)}
                className={`px-4 py-1.5 rounded-full text-sm font-medium whitespace-nowrap transition-colors ${
                  selectedCategory === category
                    ? 'bg-[var(--color-primary)] hover:bg-[var(--color-primary-hover)] text-white'
                    : 'bg-[var(--color-surface-muted)] dark:bg-[var(--color-surface-muted-dark)] uv-text-secondary'
                }`}
              >
                {category}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="p-4 pb-24 overflow-y-auto h-[calc(100vh-200px)]">
        {filteredFAQs.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20">
            <div className="w-20 h-20 bg-[var(--color-surface-muted)] dark:bg-[var(--color-surface-muted-dark)] rounded-full flex items-center justify-center mb-4">
              <Icons.HelpCircle size={40} className="uv-text-muted" />
            </div>
            <h3 className="text-lg font-semibold mb-1">Sin resultados</h3>
            <p className="text-gray-500 text-sm text-center">
              No encontramos preguntas que coincidan con tu busqueda.
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {filteredFAQs.map((item) => (
              <div
                key={item.id}
                className="uv-surface-1 rounded-xl border border-[var(--color-border)] dark:border-[var(--color-border-dark)] overflow-hidden"
              >
                <button
                  onClick={() => toggleExpand(item.id)}
                  className="w-full flex items-center justify-between p-4 text-left"
                >
                  <span className="font-medium text-sm pr-4">{item.question}</span>
                  <Icons.ChevronRight
                    size={20}
                    className={`flex-shrink-0 text-gray-400 transition-transform ${
                      expandedId === item.id ? 'rotate-90' : ''
                    }`}
                  />
                </button>
                {expandedId === item.id && (
                  <div className="px-4 pb-4 animate-in slide-in-from-top-2 duration-200">
                    <div className="pt-2 border-t border-gray-100 dark:border-gray-700">
                      <p className="text-sm uv-text-secondary leading-relaxed">
                        {item.answer}
                      </p>
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}

        {/* Contact Support */}
        <div className="mt-8 bg-gradient-to-r from-primary to-accent rounded-2xl p-6 text-white">
          <h3 className="font-bold text-lg mb-2">¿No encontraste lo que buscabas?</h3>
          <p className="text-white/80 text-sm mb-4">
            Nuestro equipo de soporte esta disponible 24/7 para ayudarte.
          </p>
          <div className="flex gap-3">
            <button className="flex-1 bg-white/20 hover:bg-white/30 py-2.5 rounded-xl font-medium text-sm flex items-center justify-center gap-2">
              <Icons.MessageCircle size={18} />
              Chat
            </button>
            <button className="flex-1 bg-white/20 hover:bg-white/30 py-2.5 rounded-xl font-medium text-sm flex items-center justify-center gap-2">
              <Icons.Phone size={18} />
              Llamar
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
