import {
  agruparNumero,
  largoDelNumero,
  numeroOculto,
  redDeLaTarjeta,
  redPorIin,
} from '@/components/tarjetas/redDeTarjeta';

// La red sale de los primeros digitos (IIN). Cada rango se prueba en sus dos
// bordes y un paso afuera de cada uno.

describe('redPorIin — Visa: empieza en 4', () => {
  it.each(['4', '40', '4111111111111111', '4999999999999999', '4000000000000000006'])('%s es Visa', (n) => {
    expect(redPorIin(n)).toBe('visa');
  });

  it.each(['3999999999999999', '5000000000000000'])('%s no es Visa', (n) => {
    expect(redPorIin(n)).not.toBe('visa');
  });
});

describe('redPorIin — Mastercard: 51-55', () => {
  it.each(['51', '5105105105105100', '53', '55', '5555555555554444'])('%s es Mastercard', (n) => {
    expect(redPorIin(n)).toBe('mastercard');
  });

  it.each(['50', '5000000000000000', '56', '5600000000000000'])('%s queda fuera (propia)', (n) => {
    expect(redPorIin(n)).toBe('kiramopay');
  });
});

describe('redPorIin — Mastercard: 2221-2720', () => {
  it.each(['2221', '2221000000000009', '2500000000000001', '2720', '2720999999999996'])('%s es Mastercard', (n) => {
    expect(redPorIin(n)).toBe('mastercard');
  });

  it.each(['2220', '2220999999999999', '2721', '2721000000000004'])('%s queda fuera (propia)', (n) => {
    expect(redPorIin(n)).toBe('kiramopay');
  });

  // Con menos de 4 digitos no se sabe si es 2221 o 2220: no adivina.
  it.each(['2', '22', '222', '27', '272'])('%s todavia no alcanza para decidir', (n) => {
    expect(redPorIin(n)).toBe('kiramopay');
  });
});

describe('redPorIin — American Express: 34 y 37', () => {
  it.each(['34', '340000000000009', '37', '378282246310005', '371449635398431'])('%s es American Express', (n) => {
    expect(redPorIin(n)).toBe('amex');
  });

  it.each(['33', '35', '36', '38', '3530111333300000', '36227206271667'])('%s no es American Express', (n) => {
    expect(redPorIin(n)).toBe('kiramopay');
  });
});

describe('redPorIin — todo lo demas es la propia de KiramoPay', () => {
  it.each([
    ['la propia, que empieza en 8', '8111111111111113'],
    ['Discover', '6011111111111117'],
    ['vacio', ''],
    ['un 3 suelto', '3'],
    ['un 5 suelto', '5'],
  ])('%s', (_, n) => {
    expect(redPorIin(n)).toBe('kiramopay');
  });

  it('acepta espacios y guiones', () => {
    expect(redPorIin('5555 5555 5555 4444')).toBe('mastercard');
    expect(redPorIin('3782-822463-10005')).toBe('amex');
  });

  it('algo que no son digitos no es de ninguna red', () => {
    expect(redPorIin('•••• 4242')).toBe('kiramopay');
    expect(redPorIin('4x42')).toBe('kiramopay');
  });
});

describe('redDeLaTarjeta — solo cuenta un numero completo', () => {
  // La lista trae el numero enmascarado: leer el IIN de esos digitos seria
  // tomar los ultimos cuatro por los primeros, y un 4242 saldria Visa.
  it('el enmascarado de la lista no da red, aunque termine en 4', () => {
    expect(redDeLaTarjeta({ cardNumber: '•••• •••• •••• 4242' })).toBe('kiramopay');
    expect(redDeLaTarjeta({ cardNumber: '4242' })).toBe('kiramopay');
  });

  it('sin numero es la propia', () => {
    expect(redDeLaTarjeta({})).toBe('kiramopay');
    expect(redDeLaTarjeta({ cardNumber: null })).toBe('kiramopay');
  });

  // Las filas viejas con brand "visa" eran tarjetas de KiramoPay rotuladas
  // VISA (migracion 063). El brand no decide la cara.
  it('el brand del servidor no la vuelve Visa', () => {
    const vieja = { cardNumber: '•••• •••• •••• 4111', brand: 'visa' };
    expect(redDeLaTarjeta(vieja)).toBe('kiramopay');
  });

  it('con el numero completo, la red de su IIN', () => {
    expect(redDeLaTarjeta({ cardNumber: '4242424242424242' })).toBe('visa');
    expect(redDeLaTarjeta({ cardNumber: '4222222222222' })).toBe('visa');
    expect(redDeLaTarjeta({ cardNumber: '4000000000000000006' })).toBe('visa');
    expect(redDeLaTarjeta({ cardNumber: '2221000000000009' })).toBe('mastercard');
    expect(redDeLaTarjeta({ cardNumber: '3782 822463 10005' })).toBe('amex');
    expect(redDeLaTarjeta({ cardNumber: '8111111111111113' })).toBe('kiramopay');
  });

  // Para nombrar una red el numero tiene que poder ser de ella.
  it('con un largo que la red no usa no la nombra', () => {
    // 12 digitos que empiezan en 4 y pasan Luhn: Visa no emite de 12.
    expect(redDeLaTarjeta({ cardNumber: '424242424242' })).toBe('kiramopay');
    // 16 digitos que empiezan en 34: American Express tiene 15.
    expect(redDeLaTarjeta({ cardNumber: '3400000000000000' })).toBe('kiramopay');
    // 15 digitos que empiezan en 55: Mastercard tiene 16.
    expect(redDeLaTarjeta({ cardNumber: '555555555555442' })).toBe('kiramopay');
  });

  it('un numero que falla Luhn no es de ninguna red, aunque empiece en 4', () => {
    expect(redDeLaTarjeta({ cardNumber: '4242424242424241' })).toBe('kiramopay');
    // Como el de KiramoPay si algun dia cambiara su prefijo: falla Luhn a proposito.
    expect(redDeLaTarjeta({ cardNumber: '4111111111111112' })).toBe('kiramopay');
  });
});

describe('agruparNumero y numeroOculto', () => {
  it('Amex va 4-6-5 y tiene 15 digitos', () => {
    expect(largoDelNumero('amex')).toBe(15);
    expect(agruparNumero('378282246310005')).toBe('3782 822463 10005');
    expect(agruparNumero('3782 8224 6310 005')).toBe('3782 822463 10005');
  });

  it('las demas van 4-4-4-4 con 16', () => {
    expect(largoDelNumero('visa')).toBe(16);
    expect(largoDelNumero('mastercard')).toBe(16);
    expect(largoDelNumero('kiramopay')).toBe(16);
    expect(agruparNumero('4242424242424242')).toBe('4242 4242 4242 4242');
    expect(agruparNumero('5555555555554444')).toBe('5555 5555 5555 4444');
    expect(agruparNumero('8111111111111113')).toBe('8111 1111 1111 1113');
  });

  it('un numero mas largo que el de su red no pierde digitos', () => {
    expect(agruparNumero('4000000000000000006')).toBe('4000 0000 0000 0000 006');
  });

  it('a medio escribir agrupa lo que hay', () => {
    expect(agruparNumero('37828', 'amex')).toBe('3782 8');
    expect(agruparNumero('424242', 'visa')).toBe('4242 42');
  });

  it('oculto deja los ultimos cuatro y respeta la forma de la red', () => {
    expect(numeroOculto('4242', 'visa')).toBe('•••• •••• •••• 4242');
    expect(numeroOculto('0005', 'amex')).toBe('•••• •••••• •0005');
    expect(numeroOculto('1113', 'kiramopay')).toBe('•••• •••• •••• 1113');
  });
});
