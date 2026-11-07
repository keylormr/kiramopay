import React from 'react';
import { IconosLinea } from './Icons';
import { leerDispositivo } from '@/utils/dispositivo';

/**
 * El icono de una sesion segun la plataforma real del aparato. Antes todas
 * llevaban el mismo telefono, tambien la de una computadora con Windows.
 * Sin plataforma conocida: la ventana de navegador si se reconoce el
 * navegador, y el icono generico de dispositivos si no se sabe nada.
 *
 * Cada caso es JSX fijo y no un componente elegido en el render, para que
 * React no lo trate como un componente nuevo en cada pintada.
 */
export const IconoDeDispositivo: React.FC<{ userAgent: string; size?: number; className?: string }> = ({
  userAgent,
  size = 24,
  className,
}) => {
  const p = { size, className };
  const d = leerDispositivo(userAgent);
  switch (d.plataforma) {
    case 'android':
      return <IconosLinea.TelefonoAndroid {...p} />;
    case 'iphone':
      return <IconosLinea.TelefonoIPhone {...p} />;
    case 'ipad':
      return <IconosLinea.Tableta {...p} />;
    case 'windows':
    case 'linux':
      return <IconosLinea.Computadora {...p} />;
    case 'mac':
    case 'chromeos':
      return <IconosLinea.Dispositivos {...p} />;
    default:
      return d.navegador ? <IconosLinea.Navegador {...p} /> : <IconosLinea.Dispositivos {...p} />;
  }
};
