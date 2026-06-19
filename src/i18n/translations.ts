// Sistema de internacionalizacion para KiramoPay
// Idiomas soportados: Espanol (ES), Ingles (EN), Chino Tradicional (ZH-TW), Japones (JA), Hindi (HI)

export type Language = 'es' | 'en' | 'zh-tw' | 'ja' | 'hi';

export interface LanguageOption {
  code: Language;
  name: string;
  nativeName: string;
  flag: string;
}

export const LANGUAGES: LanguageOption[] = [
  { code: 'es', name: 'Spanish', nativeName: 'Español', flag: '🇨🇷' },
  { code: 'en', name: 'English', nativeName: 'English', flag: '🇺🇸' },
  { code: 'zh-tw', name: 'Chinese (Traditional)', nativeName: '繁體中文', flag: '🇹🇼' },
  { code: 'ja', name: 'Japanese', nativeName: '日本語', flag: '🇯🇵' },
  { code: 'hi', name: 'Hindi', nativeName: 'हिन्दी', flag: '🇮🇳' },
];

type TranslationKeys = {
  // Common
  app_name: string;
  welcome: string;
  hello: string;
  continue: string;
  cancel: string;
  confirm: string;
  save: string;
  delete: string;
  edit: string;
  close: string;
  back: string;
  done: string;
  loading: string;
  error: string;
  success: string;

  // Auth
  login: string;
  logout: string;
  register: string;
  cedula: string;
  pin: string;
  enter_pin: string;
  incorrect_pin: string;
  biometric_login: string;
  create_account: string;
  cedula_not_registered: string;

  // Password
  enter_password: string;
  incorrect_password: string;
  current_password: string;
  show_password: string;
  hide_password: string;

  // Navigation
  nav_home: string;
  nav_sinpe: string;
  nav_services: string;
  nav_apps: string;
  nav_profile: string;

  // Home
  total_balance: string;
  available: string;
  accounts: string;
  quick_actions: string;
  scan_qr: string;
  send_money: string;
  request_money: string;
  pay_services: string;
  recent_transactions: string;
  view_all: string;

  // SINPE
  sinpe_mobile: string;
  send: string;
  receive: string;
  contacts: string;
  add_contact: string;
  phone_number: string;
  amount: string;
  description: string;
  bank: string;
  copy_number: string;
  share: string;
  copied: string;
  favorite: string;

  // Services
  services: string;
  recharges: string;
  history: string;
  bill_payments: string;
  phone_recharges: string;
  no_history: string;
  paid: string;
  successful: string;
  pending: string;

  // Profile
  profile: string;
  my_account: string;
  security: string;
  change_pin: string;
  biometric_auth: string;
  fingerprint_face: string;
  // Two-factor (TOTP)
  two_factor_auth: string;
  two_factor_desc: string;
  twofa_on: string;
  twofa_off: string;
  twofa_intro_desc: string;
  twofa_enable_btn: string;
  twofa_scan_instruction: string;
  twofa_manual_key: string;
  twofa_enter_code: string;
  twofa_verify: string;
  twofa_recovery_title: string;
  twofa_recovery_desc: string;
  twofa_copy: string;
  twofa_copied: string;
  twofa_recovery_done: string;
  twofa_disable_title: string;
  twofa_disable_desc: string;
  twofa_disable_btn: string;
  twofa_invalid_code: string;
  notifications_setting: string;
  dark_mode: string;
  language: string;
  support: string;
  help_center: string;
  faq: string;
  chat_support: string;
  about: string;
  version: string;

  // QR Scanner
  qr_scanner: string;
  scan_to_pay: string;
  scanning: string;
  point_camera: string;
  payment_detected: string;
  recipient: string;
  currency: string;

  // Misc
  made_in_cr: string;
  all_rights: string;
  test_users: string;

  // Additional UI
  add_money: string;
  add_account: string;
  open_new_account: string;
  insufficient_funds: string;
  card: string;
  deposit_crypto: string;
  amount_to_send: string;
  amount_to_request: string;
  from: string;
  add_new: string;
  status: string;
  date: string;
  category: string;
  transaction_id: string;
  report_issue: string;
  address: string;
  transaction_details: string;

  // Profile
  personal_data: string;
  kyc_verification: string;
  transaction_limits: string;
  lock_app: string;
  lock_now: string;
  biometrics: string;
  preferences: string;
  activated: string;
  deactivated: string;
  this_month: string;
  expenses: string;
  available_247: string;
  request_increase: string;
  daily_limit: string;
  monthly_limit: string;
  per_transaction: string;
  used: string;
  new_pin: string;
  confirm_pin_label: string;
  pins_dont_match: string;
  enable_biometrics: string;
  disable_biometrics: string;
  enter_pin_to_enable: string;
  enter_pin_to_disable: string;
  change_password: string;
  new_password: string;
  confirm_password: string;
  passwords_dont_match: string;
  enter_password_to_enable: string;
  enter_password_to_disable: string;
  password_strength: string;
  password_weak: string;
  password_medium: string;
  password_strong: string;
  password_requirements: string;
  security_pin: string;
  current: string;
  released: string;

  // SINPE View
  copied_to_clipboard: string;
  available_to_send: string;
  request: string;
  favorites: string;
  add: string;
  sinpe_contacts: string;
  new_contact: string;
  no_contacts_yet: string;
  send_to_new_number: string;
  my_sinpe_number: string;
  share_number_message: string;
  copy: string;
  no_transactions_yet: string;
  sent_to: string;
  received_from: string;
  add_sinpe_contact: string;
  contact_name: string;
  bank_optional: string;
  mark_as_favorite: string;
  save_contact: string;
  detail_optional: string;
  processing: string;
  sending_request: string;
  sent_success: string;
  sinpe_transfer_success: string;
  sent_to_label: string;
  phone: string;
  detail: string;
  sinpe_receipt: string;
  unknown_bank: string;
  request_to_number: string;
  reason_optional: string;
  quick_amounts: string;

  // Services View
  my_services: string;
  search_service: string;
  select_operator: string;
  recent_recharges: string;
  service_payments: string;
  no_service_payments: string;
  client_label: string;
  no_recharges_yet: string;
  pay_service: string;
  client_number_nis: string;
  amount_to_pay: string;
  processing_payment: string;
  pay: string;
  recharge_label: string;
  prepaid_recharge: string;
  number_to_recharge: string;
  select_amount: string;
  recharge_success: string;
  payment_success: string;
  ready: string;

  // Crypto View
  crypto_portfolio: string;
  my_assets: string;
  market: string;
  staking: string;
  buy: string;
  sell: string;
  convert: string;
  stake: string;
  unstake: string;
  claim: string;
  no_crypto_yet: string;
  buy_crypto: string;
  total_portfolio: string;
  profit_loss: string;
  apy: string;
  staked_amount: string;
  earned: string;
  locked: string;
  yield_rates: string;
  estimated_earnings: string;
  conversion_rate: string;
  network_fee: string;
  verify_address: string;
  irreversible_warning: string;
  scan_qr_receive: string;
  only_send_asset: string;
  start_staking: string;
  earn_passive: string;
  select_crypto: string;
  invest_amount: string;
  available_balance: string;
  receive_in: string;
  convert_to: string;
  destination_address: string;
  tx_hash: string;
  all_assets: string;

  // Registration
  reg_phone_title: string;
  reg_phone_desc: string;
  reg_verify_title: string;
  reg_code_sent_to: string;
  verify: string;
  reg_cedula_title: string;
  reg_cedula_desc: string;
  reg_cedula_nacional: string;
  reg_cedula_residente: string;
  reg_cedula_dimex: string;
  reg_name_title: string;
  reg_name_desc: string;
  first_name: string;
  last_name: string;
  reg_password_title: string;
  reg_password_desc: string;
  password: string;
  password_good: string;
  reg_creating_account: string;
  reg_error_default: string;
  reg_password_min_length: string;
  reg_security_note: string;

  // Login
  login_welcome: string;
  login_enter_cedula: string;
  login_last_access: string;
  login_change_cedula: string;
  login_password_title: string;
  login_verifying: string;
  login_enter: string;
  login_no_account: string;
  login_wrong_credentials: string;
  login_biometric_failed: string;
  login_biometric_prompt: string;
  login_terms: string;
  cedula_label: string;
  cedula_placeholder: string;

  // Error Boundary
  error_title: string;
  error_desc: string;
  error_retry: string;
  error_home: string;

  // Lock Screen
  unlock: string;
  unlock_biometric_prompt: string;

  // Navigation
  nav_crypto: string;

  recent_crypto_tx: string;

  // Budget
  budget: string;
  budgets: string;
  add_budget: string;
  edit_budget: string;
  budget_limit: string;
  budget_spent: string;
  budget_remaining: string;
  reset_budgets: string;
  no_budgets: string;
  total_spending: string;
  icon: string;
  color: string;

  // Recurring payments
  recurring_payments: string;
  add_recurring: string;
  frequency: string;
  weekly: string;
  biweekly: string;
  monthly: string;
  next_payment: string;
  last_paid: string;
  no_recurring: string;
  recurring_service: string;
  recurring_sinpe: string;
  recurring_recharge: string;

  // Export
  export_csv: string;
  export_transactions: string;
  export_options: string;
  export_excel: string;
  export_excel_desc: string;
  export_json: string;
  export_json_desc: string;
  copy_transactions: string;
  copy_transactions_desc: string;
  share_transactions: string;
  share_transactions_desc: string;
  export_success: string;

  // Transactions view
  income: string;
  net_balance: string;
  search_transactions: string;
  all_categories: string;
  num_transactions: string;

  // Theme scheduling
  theme_schedule: string;
  theme_off: string;
  theme_sunrise_sunset: string;
  theme_custom: string;
  dark_mode_start: string;
  dark_mode_end: string;

  // Feature flags
  feature_flags: string;
  experimental_features: string;

  // Analytics
  analytics_title: string;
  analytics_week: string;
  analytics_month: string;
  analytics_all: string;
  analytics_flow: string;
  analytics_by_category: string;
  analytics_no_expenses: string;
  analytics_insight: string;
  analytics_top_category: string;
  analytics_of_spending: string;
  analytics_weekly_pattern: string;
  analytics_total_tx: string;
  analytics_received: string;
  analytics_sent: string;
  analytics_sun: string;
  analytics_mon: string;
  analytics_tue: string;
  analytics_wed: string;
  analytics_thu: string;
  analytics_fri: string;
  analytics_sat: string;

  // Savings
  savings_title: string;
  savings_total_saved: string;
  savings_of_target: string;
  savings_no_goals: string;
  savings_no_goals_desc: string;
  savings_create_first: string;
  savings_add_goal: string;
  savings_goal_name: string;
  savings_goal_name_placeholder: string;
  savings_target_amount: string;
  savings_create_goal: string;
  savings_add_money: string;
  savings_deposit: string;

  // Home insights
  home_spending: string;
  home_top_cat: string;
  home_savings: string;
  home_savings_view: string;
  home_savings_desc: string;

  // Onboarding
  onboard_skip: string;
  onboard_get_started: string;
  onboard_title_1: string;
  onboard_desc_1: string;
  onboard_title_2: string;
  onboard_desc_2: string;
  onboard_title_3: string;
  onboard_desc_3: string;
  onboard_title_4: string;
  onboard_desc_4: string;

  // Split Pay
  splitpay_title: string;
  splitpay_no_splits: string;
  splitpay_no_splits_desc: string;
  splitpay_create: string;
  splitpay_desc: string;
  splitpay_desc_placeholder: string;
  splitpay_equal: string;
  splitpay_custom: string;
  splitpay_participants: string;
  splitpay_per_person: string;

  // Loyalty
  loyalty_title: string;
  loyalty_tier: string;
  loyalty_lifetime: string;
  loyalty_available: string;
  loyalty_rewards: string;
  loyalty_history: string;
  loyalty_earn: string;
  loyalty_earn_desc: string;
  loyalty_no_rewards: string;
  loyalty_no_history: string;
  loyalty_no_rules: string;
  loyalty_redeem: string;
  loyalty_next_tier: string;
  loyalty_max_per_tx: string;

  // Home extra cards
  home_split: string;
  home_split_view: string;
  home_split_desc: string;
  home_loyalty: string;
  home_loyalty_view: string;
  home_loyalty_desc: string;
  // Assistant (Phase 3a)
  assistant_title: string;
  assistant_card_desc: string;
  assistant_unavailable: string;
  assistant_greeting: string;
  assistant_disclaimer: string;
  assistant_example_1: string;
  assistant_example_2: string;
  assistant_placeholder: string;
  assistant_send: string;
  assistant_error: string;
  // Phase F — escrow + API keys + webhooks
  merchant_tools: string;
  escrow_menu: string;
  escrow_menu_desc: string;
  apikeys_menu: string;
  apikeys_menu_desc: string;
  webhooks_menu: string;
  webhooks_menu_desc: string;
  escrow_title: string;
  escrow_subtitle: string;
  escrow_empty: string;
  escrow_empty_desc: string;
  escrow_new: string;
  escrow_create_title: string;
  escrow_seller: string;
  escrow_seller_hint: string;
  escrow_amount: string;
  escrow_desc_label: string;
  escrow_desc_hint: string;
  escrow_create_btn: string;
  escrow_role_buyer: string;
  escrow_role_seller: string;
  escrow_you_buyer: string;
  escrow_you_seller: string;
  escrow_status_pending: string;
  escrow_status_funded: string;
  escrow_status_released: string;
  escrow_status_refunded: string;
  escrow_status_disputed: string;
  escrow_status_cancelled: string;
  escrow_fund: string;
  escrow_release: string;
  escrow_refund: string;
  escrow_dispute: string;
  escrow_cancel_agreement: string;
  escrow_dispute_title: string;
  escrow_dispute_reason: string;
  escrow_dispute_submit: string;
  escrow_action_failed: string;
  apikeys_title: string;
  apikeys_desc: string;
  apikeys_empty: string;
  apikeys_new: string;
  apikeys_name: string;
  apikeys_name_hint: string;
  apikeys_scopes: string;
  apikeys_create_btn: string;
  apikeys_full_title: string;
  apikeys_full_desc: string;
  apikeys_copy: string;
  apikeys_copied: string;
  apikeys_done: string;
  apikeys_revoke: string;
  apikeys_revoke_confirm: string;
  apikeys_revoked: string;
  apikeys_active: string;
  apikeys_created: string;
  webhooks_title: string;
  webhooks_desc: string;
  webhooks_empty: string;
  webhooks_new: string;
  webhooks_url: string;
  webhooks_events: string;
  webhooks_events_hint: string;
  webhooks_create_btn: string;
  webhooks_secret_title: string;
  webhooks_secret_desc: string;
  webhooks_delete: string;
  webhooks_delete_confirm: string;
  webhooks_deliveries: string;
  webhooks_no_deliveries: string;
  webhooks_active: string;
  webhooks_disabled: string;
};

const translations: Record<Language, TranslationKeys> = {
  es: {
    // Common
    app_name: 'KiramoPay',
    welcome: 'Bienvenido',
    hello: 'Hola',
    continue: 'Continuar',
    cancel: 'Cancelar',
    confirm: 'Confirmar',
    save: 'Guardar',
    delete: 'Eliminar',
    edit: 'Editar',
    close: 'Cerrar',
    back: 'Volver',
    done: 'Listo',
    loading: 'Cargando...',
    error: 'Error',
    success: 'Exito',

    // Auth
    login: 'Iniciar sesion',
    logout: 'Cerrar sesion',
    register: 'Registrarse',
    cedula: 'Cedula',
    pin: 'PIN',
    enter_pin: 'Ingresa tu PIN',
    incorrect_pin: 'PIN incorrecto',
    biometric_login: 'Ingresar con biometria',
    create_account: 'Crear cuenta',
    cedula_not_registered: 'Cedula no registrada. Por favor crea una cuenta.',
    enter_password: 'Ingresa tu contraseña',
    incorrect_password: 'Contraseña incorrecta',
    current_password: 'Contraseña actual',
    show_password: 'Mostrar contraseña',
    hide_password: 'Ocultar contraseña',

    // Navigation
    nav_home: 'Inicio',
    nav_sinpe: 'SINPE',
    nav_services: 'Servicios',
    nav_apps: 'Apps',
    nav_profile: 'Perfil',

    // Home
    total_balance: 'Balance Total',
    available: 'Disponible',
    accounts: 'Cuentas',
    quick_actions: 'Acciones rapidas',
    scan_qr: 'Escanear QR',
    send_money: 'Enviar dinero',
    request_money: 'Solicitar dinero',
    pay_services: 'Pagar servicios',
    recent_transactions: 'Transacciones recientes',
    view_all: 'Ver todo',

    // SINPE
    sinpe_mobile: 'SINPE Movil',
    send: 'Enviar',
    receive: 'Recibir',
    contacts: 'Contactos',
    add_contact: 'Agregar contacto',
    phone_number: 'Numero de telefono',
    amount: 'Monto',
    description: 'Descripcion',
    bank: 'Banco',
    copy_number: 'Copiar numero',
    share: 'Compartir',
    copied: 'Copiado',
    favorite: 'Favorito',

    // Services
    services: 'Servicios',
    recharges: 'Recargas',
    history: 'Historial',
    bill_payments: 'Pagos de servicios',
    phone_recharges: 'Recargas telefonicas',
    no_history: 'No hay historial aun',
    paid: 'Pagado',
    successful: 'Exitosa',
    pending: 'Pendiente',

    // Profile
    profile: 'Perfil',
    my_account: 'Mi cuenta',
    security: 'Seguridad',
    change_pin: 'Cambiar PIN',
    biometric_auth: 'Autenticacion biometrica',
    fingerprint_face: 'Huella digital / Face ID',
    two_factor_auth: 'Autenticación en dos pasos',
    two_factor_desc: 'App de autenticación (TOTP)',
    twofa_on: 'Activo',
    twofa_off: 'Inactivo',
    twofa_intro_desc: 'Agregá una capa extra de seguridad usando una app de autenticación como Google Authenticator o Authy.',
    twofa_enable_btn: 'Activar',
    twofa_scan_instruction: 'Escaneá este código QR con tu app de autenticación.',
    twofa_manual_key: 'O ingresá esta clave manualmente:',
    twofa_enter_code: 'Ingresá el código de 6 dígitos',
    twofa_verify: 'Verificar y activar',
    twofa_recovery_title: '¡Listo! Guardá tus códigos de recuperación',
    twofa_recovery_desc: 'Cada código sirve una sola vez si perdés acceso a tu autenticador. Guardalos en un lugar seguro.',
    twofa_copy: 'Copiar códigos',
    twofa_copied: 'Copiado',
    twofa_recovery_done: 'Ya los guardé',
    twofa_disable_title: 'Desactivar 2FA',
    twofa_disable_desc: 'Ingresá un código de tu autenticador (o de recuperación) para desactivar la verificación en dos pasos.',
    twofa_disable_btn: 'Desactivar',
    twofa_invalid_code: 'Código inválido. Intentá de nuevo.',
    notifications_setting: 'Notificaciones',
    dark_mode: 'Modo oscuro',
    language: 'Idioma',
    support: 'Soporte',
    help_center: 'Centro de ayuda',
    faq: 'Preguntas frecuentes',
    chat_support: 'Chat con soporte',
    about: 'Acerca de',
    version: 'Version',

    // QR Scanner
    qr_scanner: 'Escaner QR',
    scan_to_pay: 'Escanear para pagar',
    scanning: 'Escaneando...',
    point_camera: 'Apunta la camara al codigo QR',
    payment_detected: 'Pago detectado',
    recipient: 'Destinatario',
    currency: 'Moneda',

    // Misc
    made_in_cr: 'Hecho con amor en Costa Rica',
    all_rights: 'Todos los derechos reservados',
    test_users: 'Usuarios de prueba',

    // Additional UI
    add_money: 'Agregar dinero',
    add_account: 'Agregar cuenta',
    open_new_account: 'Abrir nueva cuenta',
    insufficient_funds: 'Fondos insuficientes',
    card: 'Tarjeta',
    deposit_crypto: 'Depositar Crypto',
    amount_to_send: 'Monto a enviar',
    amount_to_request: 'Monto a solicitar',
    from: 'De',
    add_new: 'Agregar',
    status: 'Estado',
    date: 'Fecha',
    category: 'Categoria',
    transaction_id: 'ID de transaccion',
    report_issue: 'Reportar problema',
    address: 'Direccion',
    transaction_details: 'Detalles de transaccion',

    // Profile
    personal_data: 'Datos personales',
    kyc_verification: 'Verificacion KYC',
    transaction_limits: 'Limites de transaccion',
    lock_app: 'Bloquear app',
    lock_now: 'Bloquear ahora',
    biometrics: 'Biometria',
    preferences: 'Preferencias',
    activated: 'Activado',
    deactivated: 'Desactivado',
    this_month: 'Este mes',
    expenses: 'gastos',
    available_247: 'Disponible 24/7',
    request_increase: 'Solicitar aumento',
    daily_limit: 'Limite diario',
    monthly_limit: 'Limite mensual',
    per_transaction: 'Por transaccion',
    used: 'Usado',
    new_pin: 'Nuevo PIN (4 digitos)',
    confirm_pin_label: 'Confirmar PIN',
    pins_dont_match: 'Los PIN no coinciden',
    enable_biometrics: 'Activar biometria',
    disable_biometrics: 'Desactivar biometria',
    enter_pin_to_enable: 'Ingresa tu PIN para activar la autenticacion biometrica',
    enter_pin_to_disable: 'Ingresa tu PIN para confirmar que deseas desactivar la biometria',
    change_password: 'Cambiar contraseña',
    new_password: 'Nueva contraseña',
    confirm_password: 'Confirmar contraseña',
    passwords_dont_match: 'Las contraseñas no coinciden',
    enter_password_to_enable: 'Ingresa tu contraseña para activar la autenticacion biometrica',
    enter_password_to_disable: 'Ingresa tu contraseña para confirmar que deseas desactivar la biometria',
    password_strength: 'Fortaleza',
    password_weak: 'Debil',
    password_medium: 'Media',
    password_strong: 'Fuerte',
    password_requirements: 'Min. 8 caracteres, mayuscula, minuscula, numero y especial',
    security_pin: 'PIN de seguridad',
    current: 'Actual',
    released: 'Lanzado',

    // SINPE View
    copied_to_clipboard: 'Copiado al portapapeles',
    available_to_send: 'Disponible para enviar',
    request: 'Solicitar',
    favorites: 'Favoritos',
    add: 'Agregar',
    sinpe_contacts: 'Contactos SINPE',
    new_contact: 'Nuevo',
    no_contacts_yet: 'No tienes contactos aun',
    send_to_new_number: 'Enviar a nuevo numero',
    my_sinpe_number: 'Mi numero SINPE',
    share_number_message: 'Comparte este numero para recibir dinero',
    copy: 'Copiar',
    no_transactions_yet: 'No hay transacciones aun',
    sent_to: 'Enviado a',
    received_from: 'Recibido de',
    add_sinpe_contact: 'Agregar contacto SINPE',
    contact_name: 'Nombre del contacto',
    bank_optional: 'Banco (opcional)',
    mark_as_favorite: 'Marcar como favorito',
    save_contact: 'Guardar contacto',
    detail_optional: 'Detalle (opcional)',
    processing: 'Procesando...',
    sending_request: 'Enviando solicitud...',
    sent_success: 'Enviado!',
    sinpe_transfer_success: 'Tu transferencia SINPE fue exitosa',
    sent_to_label: 'Enviado a',
    phone: 'Telefono',
    detail: 'Detalle',
    sinpe_receipt: 'Comprobante SINPE',
    unknown_bank: 'Desconocido',
    request_to_number: 'Solicitar a (numero)',
    reason_optional: 'Motivo (opcional)',
    quick_amounts: 'Montos rapidos',

    // Services View
    my_services: 'Mis servicios',
    search_service: 'Buscar servicio...',
    select_operator: 'Selecciona operador',
    recent_recharges: 'Recargas recientes',
    service_payments: 'Pagos de servicios',
    no_service_payments: 'No hay pagos de servicios aun',
    client_label: 'Cliente',
    no_recharges_yet: 'No hay recargas aun',
    pay_service: 'Pagar',
    client_number_nis: 'Numero de cliente / NIS / Contrato',
    amount_to_pay: 'Monto a pagar',
    processing_payment: 'Procesando pago...',
    pay: 'Pagar',
    recharge_label: 'Recarga',
    prepaid_recharge: 'Recarga prepago',
    number_to_recharge: 'Numero a recargar',
    select_amount: 'Selecciona monto',
    recharge_success: 'Recarga exitosa!',
    payment_success: 'Pago exitoso!',
    ready: 'Listo',

    // Crypto View
    crypto_portfolio: 'Portfolio Crypto',
    my_assets: 'Mis Activos',
    market: 'Mercado',
    staking: 'Staking',
    buy: 'Comprar',
    sell: 'Vender',
    convert: 'Convertir',
    stake: 'Stakear',
    unstake: 'Retirar Stake',
    claim: 'Reclamar',
    no_crypto_yet: 'No tienes activos crypto aun',
    buy_crypto: 'Comprar Crypto',
    total_portfolio: 'Portfolio Total',
    profit_loss: 'Ganancia/Perdida',
    apy: 'APY',
    staked_amount: 'Cantidad Stakeada',
    earned: 'Ganado',
    locked: 'Bloqueado',
    yield_rates: 'Tasas de Rendimiento',
    estimated_earnings: 'Ganancia estimada mensual',
    conversion_rate: 'Tasa de conversion',
    network_fee: 'Comision de red',
    verify_address: 'Verificar direccion',
    irreversible_warning: 'Las transacciones crypto son irreversibles',
    scan_qr_receive: 'Escanea el codigo QR para recibir',
    only_send_asset: 'Solo envia {asset} a esta direccion',
    start_staking: 'Comenzar Staking',
    earn_passive: 'Gana rendimientos con tus crypto',
    select_crypto: 'Seleccionar Crypto',
    invest_amount: 'Monto a invertir',
    available_balance: 'Balance disponible',
    receive_in: 'Recibir en',
    convert_to: 'Convertir a',
    destination_address: 'Direccion destino',
    tx_hash: 'Hash TX',
    all_assets: 'Todos los Activos',

    // Registration
    reg_phone_title: 'Tu numero de telefono',
    reg_phone_desc: 'Lo usaras para enviar y recibir dinero con SINPE Movil',
    reg_verify_title: 'Verifica tu numero',
    reg_code_sent_to: 'Codigo enviado a',
    verify: 'Verificar',
    reg_cedula_title: 'Tu identificacion',
    reg_cedula_desc: 'Necesitamos verificar tu identidad para cumplir con regulaciones',
    reg_cedula_nacional: 'Nacional',
    reg_cedula_residente: 'Residente',
    reg_cedula_dimex: 'DIMEX',
    reg_name_title: '¿Como te llamas?',
    reg_name_desc: 'Asi te identificaran cuando envien dinero',
    first_name: 'Nombre',
    last_name: 'Apellido',
    reg_password_title: 'Crea tu contrasena',
    reg_password_desc: 'Minimo 8 caracteres, incluye mayusculas, numeros y simbolos',
    password: 'Contrasena',
    password_good: 'Buena',
    reg_creating_account: 'Creando cuenta...',
    reg_error_default: 'Error al crear la cuenta',
    reg_password_min_length: 'La contrasena debe tener al menos 8 caracteres',
    reg_security_note: 'Tu informacion esta protegida con encriptacion de nivel bancario',
    login_welcome: 'Bienvenido',
    login_enter_cedula: 'Ingresa tu numero de cedula para continuar',
    login_last_access: 'Ultimo acceso:',
    login_change_cedula: 'Cambiar cedula',
    login_password_title: 'Ingresa tu contrasena',
    login_verifying: 'Verificando...',
    login_enter: 'Ingresar',
    login_no_account: '¿No tienes cuenta?',
    login_wrong_credentials: 'Cedula o contrasena incorrecta',
    login_biometric_failed: 'Autenticacion biometrica fallida',
    login_biometric_prompt: 'Ingresa con tu huella o Face ID',
    login_terms: 'Al continuar, aceptas nuestros Terminos de Servicio y Politica de Privacidad',
    cedula_label: 'Numero de cedula',
    cedula_placeholder: 'Ej: 702650930',
    error_title: 'Algo salio mal',
    error_desc: 'Ocurrio un error inesperado. Puedes intentar de nuevo o volver al inicio.',
    error_retry: 'Reintentar',
    error_home: 'Inicio',
    unlock: 'Desbloquear',
    unlock_biometric_prompt: 'Desbloquear KiramoPay',
    nav_crypto: 'Crypto',

    recent_crypto_tx: 'Transacciones Recientes',

    budget: 'Presupuesto',
    budgets: 'Presupuestos',
    add_budget: 'Agregar presupuesto',
    edit_budget: 'Editar presupuesto',
    budget_limit: 'Limite',
    budget_spent: 'Gastado',
    budget_remaining: 'Restante',
    reset_budgets: 'Reiniciar gastos',
    no_budgets: 'No hay presupuestos configurados',
    total_spending: 'Gasto total',
    icon: 'Icono',
    color: 'Color',
    recurring_payments: 'Pagos recurrentes',
    add_recurring: 'Agregar pago recurrente',
    frequency: 'Frecuencia',
    weekly: 'Semanal',
    biweekly: 'Quincenal',
    monthly: 'Mensual',
    next_payment: 'Proximo pago',
    last_paid: 'Ultimo pago',
    no_recurring: 'No hay pagos recurrentes',
    recurring_service: 'Servicio',
    recurring_sinpe: 'SINPE',
    recurring_recharge: 'Recarga',
    export_csv: 'Exportar CSV',
    export_transactions: 'Exportar',
    export_options: 'Opciones de exportacion',
    export_excel: 'Excel (CSV)',
    export_excel_desc: 'Archivo compatible con Excel, Numbers y Google Sheets',
    export_json: 'JSON',
    export_json_desc: 'Formato estructurado para desarrolladores y APIs',
    copy_transactions: 'Copiar al portapapeles',
    copy_transactions_desc: 'Copia un resumen formateado como texto',
    share_transactions: 'Compartir',
    share_transactions_desc: 'Enviar resumen por WhatsApp, correo u otra app',
    export_success: 'Exportado exitosamente',
    income: 'Ingresos',
    net_balance: 'Neto',
    search_transactions: 'Buscar transacciones...',
    all_categories: 'Todas',
    num_transactions: 'transacciones',
    theme_schedule: 'Programar tema',
    theme_off: 'Desactivado',
    theme_sunrise_sunset: 'Amanecer/Atardecer',
    theme_custom: 'Personalizado',
    dark_mode_start: 'Inicio modo oscuro',
    dark_mode_end: 'Fin modo oscuro',
    feature_flags: 'Funciones experimentales',
    experimental_features: 'Activar o desactivar funciones en desarrollo',

    // Analytics
    analytics_title: 'Analisis de gastos',
    analytics_week: 'Semana',
    analytics_month: 'Mes',
    analytics_all: 'Todo',
    analytics_flow: 'Flujo de dinero',
    analytics_by_category: 'Gastos por categoria',
    analytics_no_expenses: 'Sin gastos registrados',
    analytics_insight: 'Resumen inteligente',
    analytics_top_category: 'Mayor gasto en',
    analytics_of_spending: 'del total',
    analytics_weekly_pattern: 'Patron semanal',
    analytics_total_tx: 'Total',
    analytics_received: 'Recibidas',
    analytics_sent: 'Enviadas',
    analytics_sun: 'Dom',
    analytics_mon: 'Lun',
    analytics_tue: 'Mar',
    analytics_wed: 'Mie',
    analytics_thu: 'Jue',
    analytics_fri: 'Vie',
    analytics_sat: 'Sab',

    // Savings
    savings_title: 'Metas de ahorro',
    savings_total_saved: 'Total ahorrado',
    savings_of_target: 'de la meta de',
    savings_no_goals: 'Sin metas de ahorro',
    savings_no_goals_desc: 'Crea tu primera meta y empieza a ahorrar para lo que mas importa',
    savings_create_first: 'Crear primera meta',
    savings_add_goal: 'Nueva meta',
    savings_goal_name: 'Nombre de la meta',
    savings_goal_name_placeholder: 'Ej: Vacaciones, Auto nuevo...',
    savings_target_amount: 'Monto objetivo',
    savings_create_goal: 'Crear meta',
    savings_add_money: 'Agregar fondos',
    savings_deposit: 'Depositar',

    // Home insights
    home_spending: 'Gastos',
    home_top_cat: 'Mayor gasto',
    home_savings: 'Ahorro',
    home_savings_view: 'Mis metas',
    home_savings_desc: 'Ahorra para tus suenos',

    // Onboarding
    onboard_skip: 'Omitir',
    onboard_get_started: 'Comenzar',
    onboard_title_1: 'Tu dinero, en un solo lugar',
    onboard_desc_1: 'Gestiona todas tus cuentas, tarjetas y criptomonedas desde una sola app.',
    onboard_title_2: 'Envios y pagos al instante',
    onboard_desc_2: 'SINPE Movil, QR, servicios y recargas. Todo rapido, seguro y sin complicaciones.',
    onboard_title_3: 'Seguridad de primera',
    onboard_desc_3: 'Autenticacion biometrica, cifrado de datos y proteccion contra fraude para tu tranquilidad.',
    onboard_title_4: 'Ahorra e invierte inteligente',
    onboard_desc_4: 'Crea metas de ahorro, analiza tus gastos y haz crecer tu dinero con crypto y mas.',
    splitpay_title: 'Dividir cuenta',
    splitpay_no_splits: 'Sin cuentas divididas',
    splitpay_no_splits_desc: 'Divide gastos con amigos facilmente',
    splitpay_create: 'Crear division',
    splitpay_desc: 'Descripcion',
    splitpay_desc_placeholder: 'Ej: Cena, Viaje, Compras...',
    splitpay_equal: 'Partes iguales',
    splitpay_custom: 'Personalizado',
    splitpay_participants: 'Participantes',
    splitpay_per_person: 'por persona',
    loyalty_title: 'Puntos y recompensas',
    loyalty_tier: 'Nivel',
    loyalty_lifetime: 'Puntos totales',
    loyalty_available: 'Disponibles',
    loyalty_rewards: 'Recompensas',
    loyalty_history: 'Historial',
    loyalty_earn: 'Ganar',
    loyalty_earn_desc: 'Gana puntos automaticamente con cada transaccion en KiramoPay',
    loyalty_no_rewards: 'Sin recompensas disponibles',
    loyalty_no_history: 'Sin historial de puntos',
    loyalty_no_rules: 'Sin reglas de cashback',
    loyalty_redeem: 'Canjear',
    loyalty_next_tier: 'Siguiente nivel',
    loyalty_max_per_tx: 'Max por transaccion',
    home_split: 'Dividir',
    home_split_view: 'Split Pay',
    home_split_desc: 'Divide cuentas con amigos',
    home_loyalty: 'Puntos',
    home_loyalty_view: 'Recompensas',
    home_loyalty_desc: 'Gana y canjea puntos',
    // Assistant (Phase 3a)
    assistant_title: 'Asistente',
    assistant_card_desc: 'Pregúntame sobre tus finanzas',
    assistant_unavailable: 'El asistente no está disponible por ahora.',
    assistant_greeting: '¡Hola! ¿En qué puedo ayudarte con tus finanzas?',
    assistant_disclaimer: 'No doy asesoría financiera y no puedo mover dinero.',
    assistant_example_1: '¿Cuánto gasté este mes?',
    assistant_example_2: '¿Cuál es mi saldo?',
    assistant_placeholder: 'Escribe tu pregunta…',
    assistant_send: 'Enviar',
    assistant_error: 'No pude responder. Inténtalo de nuevo.',
    // Phase F — escrow + API keys + webhooks
    merchant_tools: 'Herramientas de comercio',
    escrow_menu: 'Pagos protegidos',
    escrow_menu_desc: 'Acuerdos con garantía (escrow)',
    apikeys_menu: 'Claves API',
    apikeys_menu_desc: 'Acceso programático para comercios',
    webhooks_menu: 'Webhooks',
    webhooks_menu_desc: 'Notificaciones de eventos',
    escrow_title: 'Pagos protegidos',
    escrow_subtitle: 'El dinero se retiene de forma segura hasta que ambas partes cumplan',
    escrow_empty: 'Aún no tienes acuerdos',
    escrow_empty_desc: 'Crea un acuerdo para retener un pago de forma segura',
    escrow_new: 'Nuevo acuerdo',
    escrow_create_title: 'Crear acuerdo',
    escrow_seller: 'ID del vendedor',
    escrow_seller_hint: 'UUID del usuario que recibirá el pago',
    escrow_amount: 'Monto',
    escrow_desc_label: 'Descripción',
    escrow_desc_hint: '¿Qué se está comprando?',
    escrow_create_btn: 'Crear acuerdo',
    escrow_role_buyer: 'Comprador',
    escrow_role_seller: 'Vendedor',
    escrow_you_buyer: 'Eres el comprador',
    escrow_you_seller: 'Eres el vendedor',
    escrow_status_pending: 'Pendiente',
    escrow_status_funded: 'Fondeado',
    escrow_status_released: 'Liberado',
    escrow_status_refunded: 'Reembolsado',
    escrow_status_disputed: 'En disputa',
    escrow_status_cancelled: 'Cancelado',
    escrow_fund: 'Fondear',
    escrow_release: 'Liberar al vendedor',
    escrow_refund: 'Reembolsar al comprador',
    escrow_dispute: 'Abrir disputa',
    escrow_cancel_agreement: 'Cancelar acuerdo',
    escrow_dispute_title: 'Abrir disputa',
    escrow_dispute_reason: 'Motivo',
    escrow_dispute_submit: 'Enviar disputa',
    escrow_action_failed: 'No se pudo completar la acción',
    apikeys_title: 'Claves API',
    apikeys_desc: 'Autentican el acceso programático a tu cuenta',
    apikeys_empty: 'No tienes claves',
    apikeys_new: 'Crear clave',
    apikeys_name: 'Nombre',
    apikeys_name_hint: 'Para identificarla (ej. "Tienda en línea")',
    apikeys_scopes: 'Permisos',
    apikeys_create_btn: 'Crear clave',
    apikeys_full_title: 'Guarda tu clave',
    apikeys_full_desc: 'Esta es la única vez que se mostrará. Guárdala en un lugar seguro.',
    apikeys_copy: 'Copiar',
    apikeys_copied: 'Copiada',
    apikeys_done: 'Listo',
    apikeys_revoke: 'Revocar',
    apikeys_revoke_confirm: '¿Revocar esta clave? Dejará de funcionar de inmediato.',
    apikeys_revoked: 'Revocada',
    apikeys_active: 'Activa',
    apikeys_created: 'Creada',
    webhooks_title: 'Webhooks',
    webhooks_desc: 'Recibe notificaciones de eventos firmadas',
    webhooks_empty: 'No tienes webhooks',
    webhooks_new: 'Agregar webhook',
    webhooks_url: 'URL del endpoint',
    webhooks_events: 'Eventos',
    webhooks_events_hint: 'Separados por coma, o * para todos',
    webhooks_create_btn: 'Registrar webhook',
    webhooks_secret_title: 'Guarda tu secreto',
    webhooks_secret_desc: 'Úsalo para verificar la firma. Solo se muestra una vez.',
    webhooks_delete: 'Eliminar',
    webhooks_delete_confirm: '¿Eliminar este webhook?',
    webhooks_deliveries: 'Entregas recientes',
    webhooks_no_deliveries: 'Sin entregas todavía',
    webhooks_active: 'Activo',
    webhooks_disabled: 'Deshabilitado',
  },

  en: {
    // Common
    app_name: 'KiramoPay',
    welcome: 'Welcome',
    hello: 'Hello',
    continue: 'Continue',
    cancel: 'Cancel',
    confirm: 'Confirm',
    save: 'Save',
    delete: 'Delete',
    edit: 'Edit',
    close: 'Close',
    back: 'Back',
    done: 'Done',
    loading: 'Loading...',
    error: 'Error',
    success: 'Success',

    // Auth
    login: 'Log in',
    logout: 'Log out',
    register: 'Sign up',
    cedula: 'ID Number',
    pin: 'PIN',
    enter_pin: 'Enter your PIN',
    incorrect_pin: 'Incorrect PIN',
    biometric_login: 'Login with biometrics',
    create_account: 'Create account',
    cedula_not_registered: 'ID not registered. Please create an account.',
    enter_password: 'Enter your password',
    incorrect_password: 'Incorrect password',
    current_password: 'Current password',
    show_password: 'Show password',
    hide_password: 'Hide password',

    // Navigation
    nav_home: 'Home',
    nav_sinpe: 'SINPE',
    nav_services: 'Services',
    nav_apps: 'Apps',
    nav_profile: 'Profile',

    // Home
    total_balance: 'Total Balance',
    available: 'Available',
    accounts: 'Accounts',
    quick_actions: 'Quick Actions',
    scan_qr: 'Scan QR',
    send_money: 'Send Money',
    request_money: 'Request Money',
    pay_services: 'Pay Services',
    recent_transactions: 'Recent Transactions',
    view_all: 'View All',

    // SINPE
    sinpe_mobile: 'SINPE Mobile',
    send: 'Send',
    receive: 'Receive',
    contacts: 'Contacts',
    add_contact: 'Add Contact',
    phone_number: 'Phone Number',
    amount: 'Amount',
    description: 'Description',
    bank: 'Bank',
    copy_number: 'Copy Number',
    share: 'Share',
    copied: 'Copied',
    favorite: 'Favorite',

    // Services
    services: 'Services',
    recharges: 'Recharges',
    history: 'History',
    bill_payments: 'Bill Payments',
    phone_recharges: 'Phone Recharges',
    no_history: 'No history yet',
    paid: 'Paid',
    successful: 'Successful',
    pending: 'Pending',

    // Profile
    profile: 'Profile',
    my_account: 'My Account',
    security: 'Security',
    change_pin: 'Change PIN',
    biometric_auth: 'Biometric Authentication',
    fingerprint_face: 'Fingerprint / Face ID',
    two_factor_auth: 'Two-factor authentication',
    two_factor_desc: 'Authenticator app (TOTP)',
    twofa_on: 'On',
    twofa_off: 'Off',
    twofa_intro_desc: 'Add an extra layer of security using an authenticator app like Google Authenticator or Authy.',
    twofa_enable_btn: 'Enable',
    twofa_scan_instruction: 'Scan this QR code with your authenticator app.',
    twofa_manual_key: 'Or enter this key manually:',
    twofa_enter_code: 'Enter the 6-digit code',
    twofa_verify: 'Verify and enable',
    twofa_recovery_title: 'Done! Save your recovery codes',
    twofa_recovery_desc: 'Each code works once if you lose access to your authenticator. Keep them somewhere safe.',
    twofa_copy: 'Copy codes',
    twofa_copied: 'Copied',
    twofa_recovery_done: 'I saved them',
    twofa_disable_title: 'Disable 2FA',
    twofa_disable_desc: 'Enter a code from your authenticator (or a recovery code) to disable two-factor authentication.',
    twofa_disable_btn: 'Disable',
    twofa_invalid_code: 'Invalid code. Please try again.',
    notifications_setting: 'Notifications',
    dark_mode: 'Dark Mode',
    language: 'Language',
    support: 'Support',
    help_center: 'Help Center',
    faq: 'FAQ',
    chat_support: 'Chat Support',
    about: 'About',
    version: 'Version',

    // QR Scanner
    qr_scanner: 'QR Scanner',
    scan_to_pay: 'Scan to Pay',
    scanning: 'Scanning...',
    point_camera: 'Point camera at QR code',
    payment_detected: 'Payment Detected',
    recipient: 'Recipient',
    currency: 'Currency',

    // Misc
    made_in_cr: 'Made with love in Costa Rica',
    all_rights: 'All rights reserved',
    test_users: 'Test Users',

    // Additional UI
    add_money: 'Add Money',
    add_account: 'Add Account',
    open_new_account: 'Open New Account',
    insufficient_funds: 'Insufficient funds',
    card: 'Card',
    deposit_crypto: 'Deposit Crypto',
    amount_to_send: 'Amount to send',
    amount_to_request: 'Amount to request',
    from: 'From',
    add_new: 'Add New',
    status: 'Status',
    date: 'Date',
    category: 'Category',
    transaction_id: 'Transaction ID',
    report_issue: 'Report an Issue',
    address: 'Address',
    transaction_details: 'Transaction Details',

    // Profile
    personal_data: 'Personal data',
    kyc_verification: 'KYC Verification',
    transaction_limits: 'Transaction limits',
    lock_app: 'Lock app',
    lock_now: 'Lock now',
    biometrics: 'Biometrics',
    preferences: 'Preferences',
    activated: 'Activated',
    deactivated: 'Deactivated',
    this_month: 'This month',
    expenses: 'expenses',
    available_247: 'Available 24/7',
    request_increase: 'Request increase',
    daily_limit: 'Daily limit',
    monthly_limit: 'Monthly limit',
    per_transaction: 'Per transaction',
    used: 'Used',
    new_pin: 'New PIN (4 digits)',
    confirm_pin_label: 'Confirm PIN',
    pins_dont_match: 'PINs do not match',
    enable_biometrics: 'Enable biometrics',
    disable_biometrics: 'Disable biometrics',
    enter_pin_to_enable: 'Enter your PIN to enable biometric authentication',
    enter_pin_to_disable: 'Enter your PIN to confirm you want to disable biometrics',
    change_password: 'Change password',
    new_password: 'New password',
    confirm_password: 'Confirm password',
    passwords_dont_match: 'Passwords do not match',
    enter_password_to_enable: 'Enter your password to enable biometric authentication',
    enter_password_to_disable: 'Enter your password to confirm you want to disable biometrics',
    password_strength: 'Strength',
    password_weak: 'Weak',
    password_medium: 'Medium',
    password_strong: 'Strong',
    password_requirements: 'Min. 8 characters, uppercase, lowercase, number and special',
    security_pin: 'Security PIN',
    current: 'Current',
    released: 'Released',

    // SINPE View
    copied_to_clipboard: 'Copied to clipboard',
    available_to_send: 'Available to send',
    request: 'Request',
    favorites: 'Favorites',
    add: 'Add',
    sinpe_contacts: 'SINPE Contacts',
    new_contact: 'New',
    no_contacts_yet: 'No contacts yet',
    send_to_new_number: 'Send to new number',
    my_sinpe_number: 'My SINPE Number',
    share_number_message: 'Share this number to receive money',
    copy: 'Copy',
    no_transactions_yet: 'No transactions yet',
    sent_to: 'Sent to',
    received_from: 'Received from',
    add_sinpe_contact: 'Add SINPE Contact',
    contact_name: 'Contact name',
    bank_optional: 'Bank (optional)',
    mark_as_favorite: 'Mark as favorite',
    save_contact: 'Save contact',
    detail_optional: 'Detail (optional)',
    processing: 'Processing...',
    sending_request: 'Sending request...',
    sent_success: 'Sent!',
    sinpe_transfer_success: 'Your SINPE transfer was successful',
    sent_to_label: 'Sent to',
    phone: 'Phone',
    detail: 'Detail',
    sinpe_receipt: 'SINPE Receipt',
    unknown_bank: 'Unknown',
    request_to_number: 'Request from (number)',
    reason_optional: 'Reason (optional)',
    quick_amounts: 'Quick amounts',

    // Services View
    my_services: 'My services',
    search_service: 'Search service...',
    select_operator: 'Select operator',
    recent_recharges: 'Recent recharges',
    service_payments: 'Service payments',
    no_service_payments: 'No service payments yet',
    client_label: 'Client',
    no_recharges_yet: 'No recharges yet',
    pay_service: 'Pay',
    client_number_nis: 'Client number / NIS / Contract',
    amount_to_pay: 'Amount to pay',
    processing_payment: 'Processing payment...',
    pay: 'Pay',
    recharge_label: 'Recharge',
    prepaid_recharge: 'Prepaid recharge',
    number_to_recharge: 'Number to recharge',
    select_amount: 'Select amount',
    recharge_success: 'Recharge successful!',
    payment_success: 'Payment successful!',
    ready: 'Done',

    // Crypto View
    crypto_portfolio: 'Crypto Portfolio',
    my_assets: 'My Assets',
    market: 'Market',
    staking: 'Staking',
    buy: 'Buy',
    sell: 'Sell',
    convert: 'Convert',
    stake: 'Stake',
    unstake: 'Unstake',
    claim: 'Claim',
    no_crypto_yet: 'No crypto assets yet',
    buy_crypto: 'Buy Crypto',
    total_portfolio: 'Total Portfolio',
    profit_loss: 'Profit/Loss',
    apy: 'APY',
    staked_amount: 'Staked Amount',
    earned: 'Earned',
    locked: 'Locked',
    yield_rates: 'Yield Rates',
    estimated_earnings: 'Estimated monthly earnings',
    conversion_rate: 'Conversion rate',
    network_fee: 'Network fee',
    verify_address: 'Verify address',
    irreversible_warning: 'Crypto transactions are irreversible',
    scan_qr_receive: 'Scan QR code to receive',
    only_send_asset: 'Only send {asset} to this address',
    start_staking: 'Start Staking',
    earn_passive: 'Earn passive income with your crypto',
    select_crypto: 'Select Crypto',
    invest_amount: 'Amount to invest',
    available_balance: 'Available balance',
    receive_in: 'Receive in',
    convert_to: 'Convert to',
    destination_address: 'Destination address',
    tx_hash: 'TX Hash',
    all_assets: 'All Assets',

    // Registration
    reg_phone_title: 'Your phone number',
    reg_phone_desc: 'You will use it to send and receive money with SINPE Movil',
    reg_verify_title: 'Verify your number',
    reg_code_sent_to: 'Code sent to',
    verify: 'Verify',
    reg_cedula_title: 'Your identification',
    reg_cedula_desc: 'We need to verify your identity to comply with regulations',
    reg_cedula_nacional: 'National',
    reg_cedula_residente: 'Resident',
    reg_cedula_dimex: 'DIMEX',
    reg_name_title: 'What is your name?',
    reg_name_desc: 'This is how people will identify you when sending money',
    first_name: 'First Name',
    last_name: 'Last Name',
    reg_password_title: 'Create your password',
    reg_password_desc: 'Minimum 8 characters, include uppercase, numbers and symbols',
    password: 'Password',
    password_good: 'Good',
    reg_creating_account: 'Creating account...',
    reg_error_default: 'Error creating account',
    reg_password_min_length: 'Password must be at least 8 characters',
    reg_security_note: 'Your information is protected with bank-level encryption',
    login_welcome: 'Welcome',
    login_enter_cedula: 'Enter your ID number to continue',
    login_last_access: 'Last access:',
    login_change_cedula: 'Change ID',
    login_password_title: 'Enter your password',
    login_verifying: 'Verifying...',
    login_enter: 'Log in',
    login_no_account: 'Don\'t have an account?',
    login_wrong_credentials: 'ID or password incorrect',
    login_biometric_failed: 'Biometric authentication failed',
    login_biometric_prompt: 'Log in with fingerprint or Face ID',
    login_terms: 'By continuing, you accept our Terms of Service and Privacy Policy',
    cedula_label: 'ID Number',
    cedula_placeholder: 'e.g. 702650930',
    error_title: 'Something went wrong',
    error_desc: 'An unexpected error occurred. You can try again or go back to the home screen.',
    error_retry: 'Retry',
    error_home: 'Home',
    unlock: 'Unlock',
    unlock_biometric_prompt: 'Unlock KiramoPay',
    nav_crypto: 'Crypto',

    recent_crypto_tx: 'Recent Transactions',

    budget: 'Budget',
    budgets: 'Budgets',
    add_budget: 'Add budget',
    edit_budget: 'Edit budget',
    budget_limit: 'Limit',
    budget_spent: 'Spent',
    budget_remaining: 'Remaining',
    reset_budgets: 'Reset spending',
    no_budgets: 'No budgets configured',
    total_spending: 'Total spending',
    icon: 'Icon',
    color: 'Color',
    recurring_payments: 'Recurring payments',
    add_recurring: 'Add recurring payment',
    frequency: 'Frequency',
    weekly: 'Weekly',
    biweekly: 'Biweekly',
    monthly: 'Monthly',
    next_payment: 'Next payment',
    last_paid: 'Last paid',
    no_recurring: 'No recurring payments',
    recurring_service: 'Service',
    recurring_sinpe: 'SINPE',
    recurring_recharge: 'Recharge',
    export_csv: 'Export CSV',
    export_transactions: 'Export',
    export_options: 'Export options',
    export_excel: 'Excel (CSV)',
    export_excel_desc: 'File compatible with Excel, Numbers and Google Sheets',
    export_json: 'JSON',
    export_json_desc: 'Structured format for developers and APIs',
    copy_transactions: 'Copy to clipboard',
    copy_transactions_desc: 'Copy a formatted summary as text',
    share_transactions: 'Share',
    share_transactions_desc: 'Send summary via WhatsApp, email or another app',
    export_success: 'Exported successfully',
    income: 'Income',
    net_balance: 'Net',
    search_transactions: 'Search transactions...',
    all_categories: 'All',
    num_transactions: 'transactions',
    theme_schedule: 'Schedule theme',
    theme_off: 'Off',
    theme_sunrise_sunset: 'Sunrise/Sunset',
    theme_custom: 'Custom',
    dark_mode_start: 'Dark mode start',
    dark_mode_end: 'Dark mode end',
    feature_flags: 'Experimental features',
    experimental_features: 'Enable or disable features in development',

    // Analytics
    analytics_title: 'Spending Analytics',
    analytics_week: 'Week',
    analytics_month: 'Month',
    analytics_all: 'All',
    analytics_flow: 'Money Flow',
    analytics_by_category: 'Spending by Category',
    analytics_no_expenses: 'No expenses recorded',
    analytics_insight: 'Smart Insight',
    analytics_top_category: 'Top spending on',
    analytics_of_spending: 'of total',
    analytics_weekly_pattern: 'Weekly Pattern',
    analytics_total_tx: 'Total',
    analytics_received: 'Received',
    analytics_sent: 'Sent',
    analytics_sun: 'Sun',
    analytics_mon: 'Mon',
    analytics_tue: 'Tue',
    analytics_wed: 'Wed',
    analytics_thu: 'Thu',
    analytics_fri: 'Fri',
    analytics_sat: 'Sat',

    // Savings
    savings_title: 'Savings Goals',
    savings_total_saved: 'Total Saved',
    savings_of_target: 'of target',
    savings_no_goals: 'No savings goals yet',
    savings_no_goals_desc: 'Create your first goal and start saving for what matters most',
    savings_create_first: 'Create first goal',
    savings_add_goal: 'New Goal',
    savings_goal_name: 'Goal name',
    savings_goal_name_placeholder: 'e.g. Vacation, New Car...',
    savings_target_amount: 'Target amount',
    savings_create_goal: 'Create Goal',
    savings_add_money: 'Add Funds',
    savings_deposit: 'Deposit',

    // Home insights
    home_spending: 'Spending',
    home_top_cat: 'Top category',
    home_savings: 'Savings',
    home_savings_view: 'My Goals',
    home_savings_desc: 'Save for your dreams',

    // Onboarding
    onboard_skip: 'Skip',
    onboard_get_started: 'Get Started',
    onboard_title_1: 'Your money, one place',
    onboard_desc_1: 'Manage all your accounts, cards and crypto from a single app.',
    onboard_title_2: 'Instant payments & transfers',
    onboard_desc_2: 'SINPE Mobile, QR, services and top-ups. Fast, secure, hassle-free.',
    onboard_title_3: 'Top-tier security',
    onboard_desc_3: 'Biometric auth, data encryption and fraud protection for your peace of mind.',
    onboard_title_4: 'Save & invest smart',
    onboard_desc_4: 'Create savings goals, analyze spending and grow your money with crypto and more.',
    splitpay_title: 'Split Bill',
    splitpay_no_splits: 'No split bills yet',
    splitpay_no_splits_desc: 'Split expenses with friends easily',
    splitpay_create: 'Create Split',
    splitpay_desc: 'Description',
    splitpay_desc_placeholder: 'e.g. Dinner, Trip, Shopping...',
    splitpay_equal: 'Equal',
    splitpay_custom: 'Custom',
    splitpay_participants: 'Participants',
    splitpay_per_person: 'per person',
    loyalty_title: 'Points & Rewards',
    loyalty_tier: 'Tier',
    loyalty_lifetime: 'Lifetime points',
    loyalty_available: 'Available',
    loyalty_rewards: 'Rewards',
    loyalty_history: 'History',
    loyalty_earn: 'Earn',
    loyalty_earn_desc: 'Earn points automatically with every transaction on KiramoPay',
    loyalty_no_rewards: 'No rewards available',
    loyalty_no_history: 'No points history',
    loyalty_no_rules: 'No cashback rules',
    loyalty_redeem: 'Redeem',
    loyalty_next_tier: 'Next tier',
    loyalty_max_per_tx: 'Max per transaction',
    home_split: 'Split',
    home_split_view: 'Split Pay',
    home_split_desc: 'Split bills with friends',
    home_loyalty: 'Points',
    home_loyalty_view: 'Rewards',
    home_loyalty_desc: 'Earn and redeem points',
    // Assistant (Phase 3a)
    assistant_title: 'Assistant',
    assistant_card_desc: 'Ask me about your finances',
    assistant_unavailable: 'The assistant is not available right now.',
    assistant_greeting: 'Hi! How can I help with your finances?',
    assistant_disclaimer: 'I don\'t give financial advice and can\'t move money.',
    assistant_example_1: 'How much did I spend this month?',
    assistant_example_2: 'What\'s my balance?',
    assistant_placeholder: 'Type your question…',
    assistant_send: 'Send',
    assistant_error: 'I couldn\'t answer. Please try again.',
    // Phase F — escrow + API keys + webhooks
    merchant_tools: 'Merchant tools',
    escrow_menu: 'Protected payments',
    escrow_menu_desc: 'Escrow agreements',
    apikeys_menu: 'API keys',
    apikeys_menu_desc: 'Programmatic merchant access',
    webhooks_menu: 'Webhooks',
    webhooks_menu_desc: 'Event notifications',
    escrow_title: 'Protected payments',
    escrow_subtitle: 'Funds are held safely until both parties are satisfied',
    escrow_empty: 'No agreements yet',
    escrow_empty_desc: 'Create an agreement to hold a payment safely',
    escrow_new: 'New agreement',
    escrow_create_title: 'Create agreement',
    escrow_seller: 'Seller ID',
    escrow_seller_hint: 'UUID of the user who will receive the payment',
    escrow_amount: 'Amount',
    escrow_desc_label: 'Description',
    escrow_desc_hint: 'What is being purchased?',
    escrow_create_btn: 'Create agreement',
    escrow_role_buyer: 'Buyer',
    escrow_role_seller: 'Seller',
    escrow_you_buyer: 'You are the buyer',
    escrow_you_seller: 'You are the seller',
    escrow_status_pending: 'Pending',
    escrow_status_funded: 'Funded',
    escrow_status_released: 'Released',
    escrow_status_refunded: 'Refunded',
    escrow_status_disputed: 'Disputed',
    escrow_status_cancelled: 'Cancelled',
    escrow_fund: 'Fund',
    escrow_release: 'Release to seller',
    escrow_refund: 'Refund to buyer',
    escrow_dispute: 'Open dispute',
    escrow_cancel_agreement: 'Cancel agreement',
    escrow_dispute_title: 'Open dispute',
    escrow_dispute_reason: 'Reason',
    escrow_dispute_submit: 'Submit dispute',
    escrow_action_failed: 'Could not complete the action',
    apikeys_title: 'API keys',
    apikeys_desc: 'Authenticate programmatic access to your account',
    apikeys_empty: 'No keys yet',
    apikeys_new: 'Create key',
    apikeys_name: 'Name',
    apikeys_name_hint: 'To identify it (e.g. "Online store")',
    apikeys_scopes: 'Scopes',
    apikeys_create_btn: 'Create key',
    apikeys_full_title: 'Save your key',
    apikeys_full_desc: 'This is the only time it will be shown. Store it somewhere safe.',
    apikeys_copy: 'Copy',
    apikeys_copied: 'Copied',
    apikeys_done: 'Done',
    apikeys_revoke: 'Revoke',
    apikeys_revoke_confirm: 'Revoke this key? It will stop working immediately.',
    apikeys_revoked: 'Revoked',
    apikeys_active: 'Active',
    apikeys_created: 'Created',
    webhooks_title: 'Webhooks',
    webhooks_desc: 'Receive signed event notifications',
    webhooks_empty: 'No webhooks yet',
    webhooks_new: 'Add webhook',
    webhooks_url: 'Endpoint URL',
    webhooks_events: 'Events',
    webhooks_events_hint: 'Comma-separated, or * for all',
    webhooks_create_btn: 'Register webhook',
    webhooks_secret_title: 'Save your secret',
    webhooks_secret_desc: 'Use it to verify the signature. Shown only once.',
    webhooks_delete: 'Delete',
    webhooks_delete_confirm: 'Delete this webhook?',
    webhooks_deliveries: 'Recent deliveries',
    webhooks_no_deliveries: 'No deliveries yet',
    webhooks_active: 'Active',
    webhooks_disabled: 'Disabled',
  },

  'zh-tw': {
    // Common
    app_name: 'KiramoPay',
    welcome: '歡迎',
    hello: '您好',
    continue: '繼續',
    cancel: '取消',
    confirm: '確認',
    save: '儲存',
    delete: '刪除',
    edit: '編輯',
    close: '關閉',
    back: '返回',
    done: '完成',
    loading: '載入中...',
    error: '錯誤',
    success: '成功',

    // Auth
    login: '登入',
    logout: '登出',
    register: '註冊',
    cedula: '身份證號',
    pin: 'PIN碼',
    enter_pin: '請輸入您的PIN碼',
    incorrect_pin: 'PIN碼錯誤',
    biometric_login: '使用生物識別登入',
    create_account: '建立帳戶',
    cedula_not_registered: '身份證未註冊，請建立帳戶。',
    enter_password: '請輸入您的密碼',
    incorrect_password: '密碼錯誤',
    current_password: '當前密碼',
    show_password: '顯示密碼',
    hide_password: '隱藏密碼',

    // Navigation
    nav_home: '首頁',
    nav_sinpe: 'SINPE',
    nav_services: '服務',
    nav_apps: '應用',
    nav_profile: '個人',

    // Home
    total_balance: '總餘額',
    available: '可用',
    accounts: '帳戶',
    quick_actions: '快速操作',
    scan_qr: '掃描QR碼',
    send_money: '轉帳',
    request_money: '請款',
    pay_services: '繳費',
    recent_transactions: '近期交易',
    view_all: '查看全部',

    // SINPE
    sinpe_mobile: 'SINPE行動支付',
    send: '發送',
    receive: '接收',
    contacts: '聯絡人',
    add_contact: '新增聯絡人',
    phone_number: '電話號碼',
    amount: '金額',
    description: '描述',
    bank: '銀行',
    copy_number: '複製號碼',
    share: '分享',
    copied: '已複製',
    favorite: '收藏',

    // Services
    services: '服務',
    recharges: '儲值',
    history: '歷史記錄',
    bill_payments: '帳單付款',
    phone_recharges: '電話儲值',
    no_history: '尚無記錄',
    paid: '已付款',
    successful: '成功',
    pending: '待處理',

    // Profile
    profile: '個人資料',
    my_account: '我的帳戶',
    security: '安全性',
    change_pin: '更改PIN碼',
    biometric_auth: '生物識別',
    fingerprint_face: '指紋 / Face ID',
    two_factor_auth: '兩步驗證',
    two_factor_desc: '驗證器應用程式 (TOTP)',
    twofa_on: '已啟用',
    twofa_off: '未啟用',
    twofa_intro_desc: '使用 Google Authenticator 或 Authy 等驗證器應用程式增加額外的安全層級。',
    twofa_enable_btn: '啟用',
    twofa_scan_instruction: '用你的驗證器應用程式掃描此 QR 碼。',
    twofa_manual_key: '或手動輸入此金鑰：',
    twofa_enter_code: '輸入 6 位數驗證碼',
    twofa_verify: '驗證並啟用',
    twofa_recovery_title: '完成！請儲存你的復原碼',
    twofa_recovery_desc: '若你失去驗證器的存取權，每個碼只能使用一次。請妥善保存。',
    twofa_copy: '複製代碼',
    twofa_copied: '已複製',
    twofa_recovery_done: '我已儲存',
    twofa_disable_title: '停用兩步驗證',
    twofa_disable_desc: '輸入驗證器的代碼（或復原碼）以停用兩步驗證。',
    twofa_disable_btn: '停用',
    twofa_invalid_code: '驗證碼無效，請重試。',
    notifications_setting: '通知',
    dark_mode: '深色模式',
    language: '語言',
    support: '支援',
    help_center: '幫助中心',
    faq: '常見問題',
    chat_support: '線上客服',
    about: '關於',
    version: '版本',

    // QR Scanner
    qr_scanner: 'QR掃描器',
    scan_to_pay: '掃描付款',
    scanning: '掃描中...',
    point_camera: '將相機對準QR碼',
    payment_detected: '偵測到付款',
    recipient: '收款人',
    currency: '貨幣',

    // Misc
    made_in_cr: '用愛製造於哥斯大黎加',
    all_rights: '版權所有',
    test_users: '測試用戶',

    // Additional UI
    add_money: '加值',
    add_account: '新增帳戶',
    open_new_account: '開設新帳戶',
    insufficient_funds: '餘額不足',
    card: '卡片',
    deposit_crypto: '存入加密貨幣',
    amount_to_send: '發送金額',
    amount_to_request: '請求金額',
    from: '來自',
    add_new: '新增',
    status: '狀態',
    date: '日期',
    category: '類別',
    transaction_id: '交易編號',
    report_issue: '回報問題',
    address: '地址',
    transaction_details: '交易詳情',

    // Profile
    personal_data: '個人資料',
    kyc_verification: 'KYC驗證',
    transaction_limits: '交易限額',
    lock_app: '鎖定應用',
    lock_now: '立即鎖定',
    biometrics: '生物識別',
    preferences: '偏好設定',
    activated: '已啟用',
    deactivated: '已停用',
    this_month: '本月',
    expenses: '筆支出',
    available_247: '全天候服務',
    request_increase: '申請提高限額',
    daily_limit: '每日限額',
    monthly_limit: '每月限額',
    per_transaction: '每筆交易',
    used: '已使用',
    new_pin: '新PIN碼（4位數）',
    confirm_pin_label: '確認PIN碼',
    pins_dont_match: 'PIN碼不匹配',
    enable_biometrics: '啟用生物識別',
    disable_biometrics: '停用生物識別',
    enter_pin_to_enable: '輸入PIN碼以啟用生物識別認證',
    enter_pin_to_disable: '輸入PIN碼確認停用生物識別',
    change_password: '更改密碼',
    new_password: '新密碼',
    confirm_password: '確認密碼',
    passwords_dont_match: '密碼不匹配',
    enter_password_to_enable: '輸入密碼以啟用生物識別認證',
    enter_password_to_disable: '輸入密碼確認停用生物識別',
    password_strength: '強度',
    password_weak: '弱',
    password_medium: '中等',
    password_strong: '強',
    password_requirements: '至少8個字符，大寫、小寫、數字和特殊字符',
    security_pin: '安全PIN碼',
    current: '當前',
    released: '發布',

    // SINPE View
    copied_to_clipboard: '已複製到剪貼簿',
    available_to_send: '可發送金額',
    request: '請款',
    favorites: '收藏夾',
    add: '新增',
    sinpe_contacts: 'SINPE聯絡人',
    new_contact: '新增',
    no_contacts_yet: '尚無聯絡人',
    send_to_new_number: '發送至新號碼',
    my_sinpe_number: '我的SINPE號碼',
    share_number_message: '分享此號碼以接收款項',
    copy: '複製',
    no_transactions_yet: '尚無交易記錄',
    sent_to: '已發送至',
    received_from: '收到來自',
    add_sinpe_contact: '新增SINPE聯絡人',
    contact_name: '聯絡人姓名',
    bank_optional: '銀行（選填）',
    mark_as_favorite: '標記為收藏',
    save_contact: '儲存聯絡人',
    detail_optional: '備註（選填）',
    processing: '處理中...',
    sending_request: '發送請求中...',
    sent_success: '已發送！',
    sinpe_transfer_success: '您的SINPE轉帳已成功',
    sent_to_label: '發送至',
    phone: '電話',
    detail: '詳情',
    sinpe_receipt: 'SINPE收據',
    unknown_bank: '未知',
    request_to_number: '向（號碼）請款',
    reason_optional: '原因（選填）',
    quick_amounts: '快速金額',

    // Services View
    my_services: '我的服務',
    search_service: '搜尋服務...',
    select_operator: '選擇營運商',
    recent_recharges: '近期儲值',
    service_payments: '服務繳費',
    no_service_payments: '尚無服務繳費記錄',
    client_label: '客戶',
    no_recharges_yet: '尚無儲值記錄',
    pay_service: '付款',
    client_number_nis: '客戶編號 / NIS / 合約',
    amount_to_pay: '付款金額',
    processing_payment: '處理付款中...',
    pay: '付款',
    recharge_label: '儲值',
    prepaid_recharge: '預付儲值',
    number_to_recharge: '儲值號碼',
    select_amount: '選擇金額',
    recharge_success: '儲值成功！',
    payment_success: '付款成功！',
    ready: '完成',

    // Crypto View
    crypto_portfolio: '加密貨幣投資組合',
    my_assets: '我的資產',
    market: '市場',
    staking: '質押',
    buy: '購買',
    sell: '出售',
    convert: '轉換',
    stake: '質押',
    unstake: '取消質押',
    claim: '領取',
    no_crypto_yet: '尚無加密資產',
    buy_crypto: '購買加密貨幣',
    total_portfolio: '總投資組合',
    profit_loss: '盈虧',
    apy: '年利率',
    staked_amount: '質押金額',
    earned: '已賺取',
    locked: '已鎖定',
    yield_rates: '收益率',
    estimated_earnings: '預估月收益',
    conversion_rate: '兌換率',
    network_fee: '網路費用',
    verify_address: '驗證地址',
    irreversible_warning: '加密貨幣交易不可逆',
    scan_qr_receive: '掃描QR碼接收',
    only_send_asset: '僅發送{asset}到此地址',
    start_staking: '開始質押',
    earn_passive: '透過加密貨幣賺取被動收入',
    select_crypto: '選擇加密貨幣',
    invest_amount: '投資金額',
    available_balance: '可用餘額',
    receive_in: '接收幣種',
    convert_to: '轉換為',
    destination_address: '目標地址',
    tx_hash: '交易哈希',
    all_assets: '所有資產',

    reg_phone_title: '您的電話號碼',
    reg_phone_desc: '您將使用它通過SINPE Movil收發資金',
    reg_verify_title: '驗證您的號碼',
    reg_code_sent_to: '驗證碼已發送至',
    verify: '驗證',
    reg_cedula_title: '您的身份證明',
    reg_cedula_desc: '我們需要驗證您的身份以符合法規',
    reg_cedula_nacional: '國民',
    reg_cedula_residente: '居民',
    reg_cedula_dimex: 'DIMEX',
    reg_name_title: '您的姓名是？',
    reg_name_desc: '這是別人匯款時識別您的方式',
    first_name: '名',
    last_name: '姓',
    reg_password_title: '建立密碼',
    reg_password_desc: '至少8個字符，包含大寫、數字和符號',
    password: '密碼',
    password_good: '良好',
    reg_creating_account: '正在建立帳戶...',
    reg_error_default: '建立帳戶時發生錯誤',
    reg_password_min_length: '密碼至少需要8個字符',
    reg_security_note: '您的資訊受銀行級加密保護',
    login_welcome: '歡迎',
    login_enter_cedula: '請輸入您的身份證號繼續',
    login_last_access: '上次登入：',
    login_change_cedula: '更換身份證',
    login_password_title: '請輸入您的密碼',
    login_verifying: '驗證中...',
    login_enter: '登入',
    login_no_account: '還沒有帳戶？',
    login_wrong_credentials: '身份證或密碼錯誤',
    login_biometric_failed: '生物識別認證失敗',
    login_biometric_prompt: '使用指紋或Face ID登入',
    login_terms: '繼續即表示您接受我們的服務條款和隱私政策',
    cedula_label: '身份證號碼',
    cedula_placeholder: '例如：702650930',
    error_title: '發生錯誤',
    error_desc: '發生了意外錯誤。您可以重試或返回首頁。',
    error_retry: '重試',
    error_home: '首頁',
    unlock: '解鎖',
    unlock_biometric_prompt: '解鎖KiramoPay',
    nav_crypto: '加密貨幣',

    recent_crypto_tx: '最近交易',

    budget: '預算',
    budgets: '預算',
    add_budget: '新增預算',
    edit_budget: '編輯預算',
    budget_limit: '限額',
    budget_spent: '已花費',
    budget_remaining: '剩餘',
    reset_budgets: '重置支出',
    no_budgets: '尚未設定預算',
    total_spending: '總支出',
    icon: '圖示',
    color: '顏色',
    recurring_payments: '定期付款',
    add_recurring: '新增定期付款',
    frequency: '頻率',
    weekly: '每週',
    biweekly: '每兩週',
    monthly: '每月',
    next_payment: '下次付款',
    last_paid: '上次付款',
    no_recurring: '沒有定期付款',
    recurring_service: '服務',
    recurring_sinpe: 'SINPE',
    recurring_recharge: '儲值',
    export_csv: '匯出CSV',
    export_transactions: '匯出',
    export_options: '匯出選項',
    export_excel: 'Excel (CSV)',
    export_excel_desc: '相容 Excel、Numbers 和 Google Sheets 的檔案',
    export_json: 'JSON',
    export_json_desc: '開發人員和 API 的結構化格式',
    copy_transactions: '複製到剪貼簿',
    copy_transactions_desc: '複製格式化的摘要為文字',
    share_transactions: '分享',
    share_transactions_desc: '透過 WhatsApp、電子郵件或其他應用程式傳送摘要',
    export_success: '匯出成功',
    income: '收入',
    net_balance: '淨額',
    search_transactions: '搜尋交易記錄...',
    all_categories: '全部',
    num_transactions: '筆交易',
    theme_schedule: '主題排程',
    theme_off: '關閉',
    theme_sunrise_sunset: '日出/日落',
    theme_custom: '自訂',
    dark_mode_start: '深色模式開始',
    dark_mode_end: '深色模式結束',
    feature_flags: '實驗性功能',
    experimental_features: '啟用或停用開發中的功能',

    analytics_title: '消費分析',
    analytics_week: '本週',
    analytics_month: '本月',
    analytics_all: '全部',
    analytics_flow: '資金流向',
    analytics_by_category: '按類別支出',
    analytics_no_expenses: '尚無支出記錄',
    analytics_insight: '智慧洞察',
    analytics_top_category: '最高支出',
    analytics_of_spending: '佔總額',
    analytics_weekly_pattern: '每週模式',
    analytics_total_tx: '總計',
    analytics_received: '已收',
    analytics_sent: '已發',
    analytics_sun: '日',
    analytics_mon: '一',
    analytics_tue: '二',
    analytics_wed: '三',
    analytics_thu: '四',
    analytics_fri: '五',
    analytics_sat: '六',
    savings_title: '儲蓄目標',
    savings_total_saved: '總儲蓄',
    savings_of_target: '目標金額',
    savings_no_goals: '尚無儲蓄目標',
    savings_no_goals_desc: '建立您的第一個目標，開始為重要的事情儲蓄',
    savings_create_first: '建立第一個目標',
    savings_add_goal: '新目標',
    savings_goal_name: '目標名稱',
    savings_goal_name_placeholder: '例如：旅行、新車...',
    savings_target_amount: '目標金額',
    savings_create_goal: '建立目標',
    savings_add_money: '加入資金',
    savings_deposit: '存入',
    home_spending: '支出',
    home_top_cat: '最高類別',
    home_savings: '儲蓄',
    home_savings_view: '我的目標',
    home_savings_desc: '為夢想儲蓄',
    onboard_skip: '跳過',
    onboard_get_started: '開始使用',
    onboard_title_1: '您的資金，集中管理',
    onboard_desc_1: '在一個應用中管理所有帳戶、卡片和加密貨幣。',
    onboard_title_2: '即時付款與轉帳',
    onboard_desc_2: 'SINPE行動支付、QR碼、服務和充值。快速、安全、簡單。',
    onboard_title_3: '頂級安全',
    onboard_desc_3: '生物識別認證、數據加密和防詐保護，讓您安心。',
    onboard_title_4: '聰明儲蓄與投資',
    onboard_desc_4: '設定儲蓄目標，分析支出，用加密貨幣等方式增長財富。',
    splitpay_title: '分帳',
    splitpay_no_splits: '尚無分帳記錄',
    splitpay_no_splits_desc: '輕鬆與朋友分攤費用',
    splitpay_create: '建立分帳',
    splitpay_desc: '說明',
    splitpay_desc_placeholder: '例如：晚餐、旅行、購物...',
    splitpay_equal: '均分',
    splitpay_custom: '自訂',
    splitpay_participants: '參與者',
    splitpay_per_person: '每人',
    loyalty_title: '積分與獎勵',
    loyalty_tier: '等級',
    loyalty_lifetime: '累計積分',
    loyalty_available: '可用',
    loyalty_rewards: '獎勵',
    loyalty_history: '記錄',
    loyalty_earn: '賺取',
    loyalty_earn_desc: '每筆交易自動賺取積分',
    loyalty_no_rewards: '暫無可用獎勵',
    loyalty_no_history: '暫無積分記錄',
    loyalty_no_rules: '暫無回饋規則',
    loyalty_redeem: '兌換',
    loyalty_next_tier: '下一等級',
    loyalty_max_per_tx: '每筆最高',
    home_split: '分帳',
    home_split_view: '分帳付款',
    home_split_desc: '與朋友分攤帳單',
    home_loyalty: '積分',
    home_loyalty_view: '獎勵',
    home_loyalty_desc: '賺取和兌換積分',
    // Assistant (Phase 3a)
    assistant_title: '助理',
    assistant_card_desc: '向我詢問你的財務狀況',
    assistant_unavailable: '助理目前無法使用。',
    assistant_greeting: '嗨！我能如何協助你的財務呢？',
    assistant_disclaimer: '我不提供理財建議，也無法轉移資金。',
    assistant_example_1: '我這個月花了多少錢？',
    assistant_example_2: '我的餘額是多少？',
    assistant_placeholder: '輸入你的問題…',
    assistant_send: '傳送',
    assistant_error: '我無法回答，請再試一次。',
    // Phase F — escrow + API keys + webhooks
    merchant_tools: '商家工具',
    escrow_menu: '保障付款',
    escrow_menu_desc: '第三方保管協議',
    apikeys_menu: 'API 金鑰',
    apikeys_menu_desc: '商家程式化存取',
    webhooks_menu: 'Webhook',
    webhooks_menu_desc: '事件通知',
    escrow_title: '保障付款',
    escrow_subtitle: '資金將安全保管，直到雙方都滿意為止',
    escrow_empty: '尚無協議',
    escrow_empty_desc: '建立協議以安全保管款項',
    escrow_new: '新增協議',
    escrow_create_title: '建立協議',
    escrow_seller: '賣方 ID',
    escrow_seller_hint: '將收款使用者的 UUID',
    escrow_amount: '金額',
    escrow_desc_label: '說明',
    escrow_desc_hint: '購買的內容是什麼？',
    escrow_create_btn: '建立協議',
    escrow_role_buyer: '買方',
    escrow_role_seller: '賣方',
    escrow_you_buyer: '您是買方',
    escrow_you_seller: '您是賣方',
    escrow_status_pending: '待處理',
    escrow_status_funded: '已撥款',
    escrow_status_released: '已放款',
    escrow_status_refunded: '已退款',
    escrow_status_disputed: '爭議中',
    escrow_status_cancelled: '已取消',
    escrow_fund: '撥款',
    escrow_release: '放款給賣方',
    escrow_refund: '退款給買方',
    escrow_dispute: '提出爭議',
    escrow_cancel_agreement: '取消協議',
    escrow_dispute_title: '提出爭議',
    escrow_dispute_reason: '原因',
    escrow_dispute_submit: '送出爭議',
    escrow_action_failed: '無法完成此操作',
    apikeys_title: 'API 金鑰',
    apikeys_desc: '驗證對您帳戶的程式化存取',
    apikeys_empty: '尚無金鑰',
    apikeys_new: '建立金鑰',
    apikeys_name: '名稱',
    apikeys_name_hint: '用於識別（例如「網路商店」）',
    apikeys_scopes: '權限範圍',
    apikeys_create_btn: '建立金鑰',
    apikeys_full_title: '儲存您的金鑰',
    apikeys_full_desc: '金鑰僅顯示這一次，請妥善保存於安全處。',
    apikeys_copy: '複製',
    apikeys_copied: '已複製',
    apikeys_done: '完成',
    apikeys_revoke: '撤銷',
    apikeys_revoke_confirm: '要撤銷此金鑰嗎？將立即停止運作。',
    apikeys_revoked: '已撤銷',
    apikeys_active: '使用中',
    apikeys_created: '建立時間',
    webhooks_title: 'Webhook',
    webhooks_desc: '接收已簽署的事件通知',
    webhooks_empty: '尚無 Webhook',
    webhooks_new: '新增 Webhook',
    webhooks_url: '端點網址',
    webhooks_events: '事件',
    webhooks_events_hint: '以逗號分隔，或輸入 * 代表全部',
    webhooks_create_btn: '註冊 Webhook',
    webhooks_secret_title: '儲存您的密鑰',
    webhooks_secret_desc: '用於驗證簽章。僅顯示一次。',
    webhooks_delete: '刪除',
    webhooks_delete_confirm: '要刪除此 Webhook 嗎？',
    webhooks_deliveries: '最近的傳送紀錄',
    webhooks_no_deliveries: '尚無傳送紀錄',
    webhooks_active: '使用中',
    webhooks_disabled: '已停用',
  },

  ja: {
    // Common
    app_name: 'KiramoPay',
    welcome: 'ようこそ',
    hello: 'こんにちは',
    continue: '続ける',
    cancel: 'キャンセル',
    confirm: '確認',
    save: '保存',
    delete: '削除',
    edit: '編集',
    close: '閉じる',
    back: '戻る',
    done: '完了',
    loading: '読み込み中...',
    error: 'エラー',
    success: '成功',

    // Auth
    login: 'ログイン',
    logout: 'ログアウト',
    register: '登録',
    cedula: '身分証番号',
    pin: 'PIN',
    enter_pin: 'PINを入力してください',
    incorrect_pin: 'PINが正しくありません',
    biometric_login: '生体認証でログイン',
    create_account: 'アカウント作成',
    cedula_not_registered: '身分証が未登録です。アカウントを作成してください。',
    enter_password: 'パスワードを入力してください',
    incorrect_password: 'パスワードが正しくありません',
    current_password: '現在のパスワード',
    show_password: 'パスワードを表示',
    hide_password: 'パスワードを非表示',

    // Navigation
    nav_home: 'ホーム',
    nav_sinpe: 'SINPE',
    nav_services: 'サービス',
    nav_apps: 'アプリ',
    nav_profile: 'プロフィール',

    // Home
    total_balance: '合計残高',
    available: '利用可能',
    accounts: 'アカウント',
    quick_actions: 'クイックアクション',
    scan_qr: 'QRスキャン',
    send_money: '送金',
    request_money: '請求',
    pay_services: '支払い',
    recent_transactions: '最近の取引',
    view_all: 'すべて見る',

    // SINPE
    sinpe_mobile: 'SINPEモバイル',
    send: '送る',
    receive: '受け取る',
    contacts: '連絡先',
    add_contact: '連絡先を追加',
    phone_number: '電話番号',
    amount: '金額',
    description: '説明',
    bank: '銀行',
    copy_number: '番号をコピー',
    share: '共有',
    copied: 'コピーしました',
    favorite: 'お気に入り',

    // Services
    services: 'サービス',
    recharges: 'チャージ',
    history: '履歴',
    bill_payments: '請求書支払い',
    phone_recharges: '電話チャージ',
    no_history: '履歴がありません',
    paid: '支払済み',
    successful: '成功',
    pending: '保留中',

    // Profile
    profile: 'プロフィール',
    my_account: 'マイアカウント',
    security: 'セキュリティ',
    change_pin: 'PIN変更',
    biometric_auth: '生体認証',
    fingerprint_face: '指紋 / Face ID',
    two_factor_auth: '二段階認証',
    two_factor_desc: '認証アプリ (TOTP)',
    twofa_on: '有効',
    twofa_off: '無効',
    twofa_intro_desc: 'Google Authenticator や Authy などの認証アプリでセキュリティを強化します。',
    twofa_enable_btn: '有効にする',
    twofa_scan_instruction: '認証アプリでこの QR コードをスキャンしてください。',
    twofa_manual_key: 'または、このキーを手動で入力してください：',
    twofa_enter_code: '6桁のコードを入力',
    twofa_verify: '確認して有効化',
    twofa_recovery_title: '完了！リカバリーコードを保存してください',
    twofa_recovery_desc: '認証アプリにアクセスできなくなった場合、各コードは一度だけ使用できます。安全な場所に保管してください。',
    twofa_copy: 'コードをコピー',
    twofa_copied: 'コピーしました',
    twofa_recovery_done: '保存しました',
    twofa_disable_title: '二段階認証を無効化',
    twofa_disable_desc: '二段階認証を無効にするには、認証アプリのコード（またはリカバリーコード）を入力してください。',
    twofa_disable_btn: '無効にする',
    twofa_invalid_code: 'コードが無効です。もう一度お試しください。',
    notifications_setting: '通知',
    dark_mode: 'ダークモード',
    language: '言語',
    support: 'サポート',
    help_center: 'ヘルプセンター',
    faq: 'よくある質問',
    chat_support: 'チャットサポート',
    about: '概要',
    version: 'バージョン',

    // QR Scanner
    qr_scanner: 'QRスキャナー',
    scan_to_pay: 'スキャンして支払う',
    scanning: 'スキャン中...',
    point_camera: 'カメラをQRコードに向けてください',
    payment_detected: '支払いを検出しました',
    recipient: '受取人',
    currency: '通貨',

    // Misc
    made_in_cr: 'コスタリカで愛を込めて作成',
    all_rights: '全著作権所有',
    test_users: 'テストユーザー',

    // Additional UI
    add_money: '入金',
    add_account: 'アカウント追加',
    open_new_account: '新規口座開設',
    insufficient_funds: '残高不足',
    card: 'カード',
    deposit_crypto: '暗号資産を入金',
    amount_to_send: '送金額',
    amount_to_request: '請求額',
    from: '送金元',
    add_new: '追加',
    status: 'ステータス',
    date: '日付',
    category: 'カテゴリ',
    transaction_id: '取引ID',
    report_issue: '問題を報告',
    address: 'アドレス',
    transaction_details: '取引詳細',

    // Profile
    personal_data: '個人情報',
    kyc_verification: 'KYC認証',
    transaction_limits: '取引限度額',
    lock_app: 'アプリをロック',
    lock_now: '今すぐロック',
    biometrics: '生体認証',
    preferences: '設定',
    activated: '有効',
    deactivated: '無効',
    this_month: '今月',
    expenses: '件の支出',
    available_247: '24時間対応',
    request_increase: '増額を申請',
    daily_limit: '1日の限度額',
    monthly_limit: '月間限度額',
    per_transaction: '1取引あたり',
    used: '使用済み',
    new_pin: '新しいPIN（4桁）',
    confirm_pin_label: 'PINを確認',
    pins_dont_match: 'PINが一致しません',
    enable_biometrics: '生体認証を有効にする',
    disable_biometrics: '生体認証を無効にする',
    enter_pin_to_enable: 'PINを入力して生体認証を有効にします',
    enter_pin_to_disable: 'PINを入力して生体認証を無効にすることを確認します',
    change_password: 'パスワード変更',
    new_password: '新しいパスワード',
    confirm_password: 'パスワードを確認',
    passwords_dont_match: 'パスワードが一致しません',
    enter_password_to_enable: 'パスワードを入力して生体認証を有効にします',
    enter_password_to_disable: 'パスワードを入力して生体認証を無効にすることを確認します',
    password_strength: '強度',
    password_weak: '弱い',
    password_medium: '普通',
    password_strong: '強い',
    password_requirements: '8文字以上、大文字、小文字、数字、特殊文字を含む',
    security_pin: 'セキュリティPIN',
    current: '現在',
    released: 'リリース',

    // SINPE View
    copied_to_clipboard: 'クリップボードにコピーしました',
    available_to_send: '送金可能額',
    request: '請求',
    favorites: 'お気に入り',
    add: '追加',
    sinpe_contacts: 'SINPE連絡先',
    new_contact: '新規',
    no_contacts_yet: '連絡先がありません',
    send_to_new_number: '新しい番号に送金',
    my_sinpe_number: '私のSINPE番号',
    share_number_message: 'この番号を共有して入金を受け取る',
    copy: 'コピー',
    no_transactions_yet: '取引履歴がありません',
    sent_to: '送金先',
    received_from: '受取元',
    add_sinpe_contact: 'SINPE連絡先を追加',
    contact_name: '連絡先の名前',
    bank_optional: '銀行（任意）',
    mark_as_favorite: 'お気に入りに追加',
    save_contact: '連絡先を保存',
    detail_optional: '詳細（任意）',
    processing: '処理中...',
    sending_request: 'リクエスト送信中...',
    sent_success: '送金完了！',
    sinpe_transfer_success: 'SINPE送金が完了しました',
    sent_to_label: '送金先',
    phone: '電話',
    detail: '詳細',
    sinpe_receipt: 'SINPE領収書',
    unknown_bank: '不明',
    request_to_number: '（番号）に請求',
    reason_optional: '理由（任意）',
    quick_amounts: 'クイック金額',

    // Services View
    my_services: 'マイサービス',
    search_service: 'サービスを検索...',
    select_operator: 'オペレーターを選択',
    recent_recharges: '最近のチャージ',
    service_payments: 'サービス支払い',
    no_service_payments: 'サービス支払い履歴がありません',
    client_label: 'クライアント',
    no_recharges_yet: 'チャージ履歴がありません',
    pay_service: '支払う',
    client_number_nis: '顧客番号 / NIS / 契約',
    amount_to_pay: '支払い金額',
    processing_payment: '支払い処理中...',
    pay: '支払う',
    recharge_label: 'チャージ',
    prepaid_recharge: 'プリペイドチャージ',
    number_to_recharge: 'チャージする番号',
    select_amount: '金額を選択',
    recharge_success: 'チャージ成功！',
    payment_success: '支払い成功！',
    ready: '完了',

    // Crypto View
    crypto_portfolio: '暗号資産ポートフォリオ',
    my_assets: 'マイアセット',
    market: 'マーケット',
    staking: 'ステーキング',
    buy: '購入',
    sell: '売却',
    convert: '変換',
    stake: 'ステーク',
    unstake: 'アンステーク',
    claim: '受取',
    no_crypto_yet: '暗号資産がありません',
    buy_crypto: '暗号資産を購入',
    total_portfolio: '総ポートフォリオ',
    profit_loss: '損益',
    apy: '年利',
    staked_amount: 'ステーク額',
    earned: '獲得済み',
    locked: 'ロック中',
    yield_rates: '利回り',
    estimated_earnings: '月間予想収益',
    conversion_rate: '変換レート',
    network_fee: 'ネットワーク手数料',
    verify_address: 'アドレスを確認',
    irreversible_warning: '暗号資産の取引は取り消せません',
    scan_qr_receive: 'QRコードをスキャンして受取',
    only_send_asset: 'このアドレスには{asset}のみ送信してください',
    start_staking: 'ステーキングを開始',
    earn_passive: '暗号資産で受動収入を得る',
    select_crypto: '暗号資産を選択',
    invest_amount: '投資額',
    available_balance: '利用可能残高',
    receive_in: '受取通貨',
    convert_to: '変換先',
    destination_address: '送信先アドレス',
    tx_hash: 'TXハッシュ',
    all_assets: 'すべての資産',

    reg_phone_title: '電話番号',
    reg_phone_desc: 'SINPE Movilでの送受金に使用します',
    reg_verify_title: '番号を確認',
    reg_code_sent_to: '確認コード送信先',
    verify: '確認',
    reg_cedula_title: '本人確認',
    reg_cedula_desc: '規制に準拠するため身元の確認が必要です',
    reg_cedula_nacional: '国民',
    reg_cedula_residente: '居住者',
    reg_cedula_dimex: 'DIMEX',
    reg_name_title: 'お名前は？',
    reg_name_desc: '送金時にこの名前で識別されます',
    first_name: '名',
    last_name: '姓',
    reg_password_title: 'パスワードを作成',
    reg_password_desc: '8文字以上、大文字、数字、記号を含む',
    password: 'パスワード',
    password_good: '良好',
    reg_creating_account: 'アカウント作成中...',
    reg_error_default: 'アカウント作成エラー',
    reg_password_min_length: 'パスワードは8文字以上必要です',
    reg_security_note: '情報は銀行レベルの暗号化で保護されています',
    login_welcome: 'ようこそ',
    login_enter_cedula: '続けるには身分証番号を入力してください',
    login_last_access: '前回のアクセス：',
    login_change_cedula: '身分証を変更',
    login_password_title: 'パスワードを入力',
    login_verifying: '確認中...',
    login_enter: 'ログイン',
    login_no_account: 'アカウントをお持ちでないですか？',
    login_wrong_credentials: '身分証またはパスワードが正しくありません',
    login_biometric_failed: '生体認証に失敗しました',
    login_biometric_prompt: '指紋またはFace IDでログイン',
    login_terms: '続けることで、利用規約とプライバシーポリシーに同意します',
    cedula_label: '身分証番号',
    cedula_placeholder: '例：702650930',
    error_title: '問題が発生しました',
    error_desc: '予期しないエラーが発生しました。再試行するかホームに戻ることができます。',
    error_retry: '再試行',
    error_home: 'ホーム',
    unlock: 'ロック解除',
    unlock_biometric_prompt: 'KiramoPay のロックを解除',
    nav_crypto: '暗号資産',

    recent_crypto_tx: '最近の取引',

    budget: '予算',
    budgets: '予算',
    add_budget: '予算を追加',
    edit_budget: '予算を編集',
    budget_limit: '上限',
    budget_spent: '使用済み',
    budget_remaining: '残り',
    reset_budgets: '支出をリセット',
    no_budgets: '予算が設定されていません',
    total_spending: '総支出',
    icon: 'アイコン',
    color: '色',
    recurring_payments: '定期支払い',
    add_recurring: '定期支払いを追加',
    frequency: '頻度',
    weekly: '毎週',
    biweekly: '隔週',
    monthly: '毎月',
    next_payment: '次回の支払い',
    last_paid: '前回の支払い',
    no_recurring: '定期支払いがありません',
    recurring_service: 'サービス',
    recurring_sinpe: 'SINPE',
    recurring_recharge: 'チャージ',
    export_csv: 'CSV出力',
    export_transactions: 'エクスポート',
    export_options: 'エクスポートオプション',
    export_excel: 'Excel (CSV)',
    export_excel_desc: 'Excel、Numbers、Google Sheetsと互換性のあるファイル',
    export_json: 'JSON',
    export_json_desc: '開発者とAPI用の構造化フォーマット',
    copy_transactions: 'クリップボードにコピー',
    copy_transactions_desc: 'フォーマットされた要約をテキストとしてコピー',
    share_transactions: '共有',
    share_transactions_desc: 'WhatsApp、メール、その他のアプリで要約を送信',
    export_success: 'エクスポート完了',
    income: '収入',
    net_balance: '純額',
    search_transactions: '取引を検索...',
    all_categories: 'すべて',
    num_transactions: '件の取引',
    theme_schedule: 'テーマスケジュール',
    theme_off: 'オフ',
    theme_sunrise_sunset: '日の出/日の入り',
    theme_custom: 'カスタム',
    dark_mode_start: 'ダークモード開始',
    dark_mode_end: 'ダークモード終了',
    feature_flags: '実験的機能',
    experimental_features: '開発中の機能を有効または無効にする',

    analytics_title: '支出分析',
    analytics_week: '週間',
    analytics_month: '月間',
    analytics_all: '全期間',
    analytics_flow: 'お金の流れ',
    analytics_by_category: 'カテゴリ別支出',
    analytics_no_expenses: '支出記録なし',
    analytics_insight: 'スマート分析',
    analytics_top_category: '最大支出',
    analytics_of_spending: '（全体比）',
    analytics_weekly_pattern: '週間パターン',
    analytics_total_tx: '合計',
    analytics_received: '受取',
    analytics_sent: '送金',
    analytics_sun: '日',
    analytics_mon: '月',
    analytics_tue: '火',
    analytics_wed: '水',
    analytics_thu: '木',
    analytics_fri: '金',
    analytics_sat: '土',
    savings_title: '貯蓄目標',
    savings_total_saved: '合計貯蓄額',
    savings_of_target: '目標額',
    savings_no_goals: '貯蓄目標なし',
    savings_no_goals_desc: '最初の目標を作成して、大切なことのために貯蓄を始めましょう',
    savings_create_first: '最初の目標を作成',
    savings_add_goal: '新しい目標',
    savings_goal_name: '目標名',
    savings_goal_name_placeholder: '例：旅行、新車...',
    savings_target_amount: '目標金額',
    savings_create_goal: '目標を作成',
    savings_add_money: '資金を追加',
    savings_deposit: '入金',
    home_spending: '支出',
    home_top_cat: 'トップカテゴリ',
    home_savings: '貯蓄',
    home_savings_view: 'マイ目標',
    home_savings_desc: '夢のために貯蓄',
    onboard_skip: 'スキップ',
    onboard_get_started: '始める',
    onboard_title_1: 'あなたのお金を一元管理',
    onboard_desc_1: 'すべての口座、カード、暗号通貨を1つのアプリで管理できます。',
    onboard_title_2: '即時決済＆送金',
    onboard_desc_2: 'SINPEモバイル、QR、サービス、チャージ。速くて安全、簡単。',
    onboard_title_3: '最高レベルのセキュリティ',
    onboard_desc_3: '生体認証、データ暗号化、詐欺防止で安心をお届けします。',
    onboard_title_4: 'スマートに貯蓄＆投資',
    onboard_desc_4: '貯蓄目標を設定し、支出を分析し、暗号通貨などで資産を増やしましょう。',
    splitpay_title: '割り勘',
    splitpay_no_splits: '割り勘記録なし',
    splitpay_no_splits_desc: '友達と簡単に費用を分割',
    splitpay_create: '割り勘を作成',
    splitpay_desc: '説明',
    splitpay_desc_placeholder: '例：ディナー、旅行、買い物...',
    splitpay_equal: '均等',
    splitpay_custom: 'カスタム',
    splitpay_participants: '参加者',
    splitpay_per_person: '一人あたり',
    loyalty_title: 'ポイント＆特典',
    loyalty_tier: 'ランク',
    loyalty_lifetime: '累計ポイント',
    loyalty_available: '利用可能',
    loyalty_rewards: '特典',
    loyalty_history: '履歴',
    loyalty_earn: '獲得',
    loyalty_earn_desc: 'KiramoPay上の全取引で自動的にポイント獲得',
    loyalty_no_rewards: '利用可能な特典なし',
    loyalty_no_history: 'ポイント履歴なし',
    loyalty_no_rules: 'キャッシュバックルールなし',
    loyalty_redeem: '交換',
    loyalty_next_tier: '次のランク',
    loyalty_max_per_tx: '取引あたり上限',
    home_split: '割り勘',
    home_split_view: '割り勘',
    home_split_desc: '友達と割り勘',
    home_loyalty: 'ポイント',
    home_loyalty_view: '特典',
    home_loyalty_desc: 'ポイントを貯めて交換',
    // Assistant (Phase 3a)
    assistant_title: 'アシスタント',
    assistant_card_desc: '家計について質問できます',
    assistant_unavailable: '現在アシスタントはご利用いただけません。',
    assistant_greeting: 'こんにちは！家計について何かお手伝いできますか？',
    assistant_disclaimer: '資産運用のアドバイスや送金はできません。',
    assistant_example_1: '今月はいくら使いましたか？',
    assistant_example_2: '残高はいくらですか？',
    assistant_placeholder: '質問を入力…',
    assistant_send: '送信',
    assistant_error: '回答できませんでした。もう一度お試しください。',
    // Phase F — escrow + API keys + webhooks
    merchant_tools: '加盟店ツール',
    escrow_menu: 'エスクロー決済',
    escrow_menu_desc: 'エスクロー契約',
    apikeys_menu: 'APIキー',
    apikeys_menu_desc: 'プログラムによる加盟店アクセス',
    webhooks_menu: 'Webhook',
    webhooks_menu_desc: 'イベント通知',
    escrow_title: 'エスクロー決済',
    escrow_subtitle: '双方が合意するまで資金を安全に保管します',
    escrow_empty: '契約はまだありません',
    escrow_empty_desc: '契約を作成して支払いを安全に保管しましょう',
    escrow_new: '新規契約',
    escrow_create_title: '契約の作成',
    escrow_seller: '販売者ID',
    escrow_seller_hint: '支払いを受け取るユーザーのUUID',
    escrow_amount: '金額',
    escrow_desc_label: '説明',
    escrow_desc_hint: '何を購入しますか？',
    escrow_create_btn: '契約を作成',
    escrow_role_buyer: '購入者',
    escrow_role_seller: '販売者',
    escrow_you_buyer: 'あなたは購入者です',
    escrow_you_seller: 'あなたは販売者です',
    escrow_status_pending: '保留中',
    escrow_status_funded: '入金済み',
    escrow_status_released: '支払い完了',
    escrow_status_refunded: '返金済み',
    escrow_status_disputed: '異議申立中',
    escrow_status_cancelled: 'キャンセル済み',
    escrow_fund: '入金',
    escrow_release: '販売者へ支払う',
    escrow_refund: '購入者へ返金',
    escrow_dispute: '異議を申し立てる',
    escrow_cancel_agreement: '契約をキャンセル',
    escrow_dispute_title: '異議の申立て',
    escrow_dispute_reason: '理由',
    escrow_dispute_submit: '異議を送信',
    escrow_action_failed: '操作を完了できませんでした',
    apikeys_title: 'APIキー',
    apikeys_desc: 'アカウントへのプログラムアクセスを認証します',
    apikeys_empty: 'キーはまだありません',
    apikeys_new: 'キーを作成',
    apikeys_name: '名前',
    apikeys_name_hint: '識別用（例：「オンラインストア」）',
    apikeys_scopes: 'スコープ',
    apikeys_create_btn: 'キーを作成',
    apikeys_full_title: 'キーを保存してください',
    apikeys_full_desc: '表示されるのはこの一度きりです。安全な場所に保管してください。',
    apikeys_copy: 'コピー',
    apikeys_copied: 'コピーしました',
    apikeys_done: '完了',
    apikeys_revoke: '無効化',
    apikeys_revoke_confirm: 'このキーを無効化しますか？すぐに使用できなくなります。',
    apikeys_revoked: '無効化済み',
    apikeys_active: '有効',
    apikeys_created: '作成日',
    webhooks_title: 'Webhook',
    webhooks_desc: '署名付きのイベント通知を受信します',
    webhooks_empty: 'Webhookはまだありません',
    webhooks_new: 'Webhookを追加',
    webhooks_url: 'エンドポイントURL',
    webhooks_events: 'イベント',
    webhooks_events_hint: 'カンマ区切り、またはすべての場合は *',
    webhooks_create_btn: 'Webhookを登録',
    webhooks_secret_title: 'シークレットを保存してください',
    webhooks_secret_desc: '署名の検証に使用します。表示は一度きりです。',
    webhooks_delete: '削除',
    webhooks_delete_confirm: 'このWebhookを削除しますか？',
    webhooks_deliveries: '最近の配信',
    webhooks_no_deliveries: '配信はまだありません',
    webhooks_active: '有効',
    webhooks_disabled: '無効',
  },

  hi: {
    // Common
    app_name: 'KiramoPay',
    welcome: 'स्वागत है',
    hello: 'नमस्ते',
    continue: 'जारी रखें',
    cancel: 'रद्द करें',
    confirm: 'पुष्टि करें',
    save: 'सहेजें',
    delete: 'हटाएं',
    edit: 'संपादित करें',
    close: 'बंद करें',
    back: 'वापस',
    done: 'हो गया',
    loading: 'लोड हो रहा है...',
    error: 'त्रुटि',
    success: 'सफल',

    // Auth
    login: 'लॉग इन',
    logout: 'लॉग आउट',
    register: 'पंजीकरण',
    cedula: 'पहचान संख्या',
    pin: 'पिन',
    enter_pin: 'अपना पिन दर्ज करें',
    incorrect_pin: 'गलत पिन',
    biometric_login: 'बायोमेट्रिक से लॉगिन',
    create_account: 'खाता बनाएं',
    cedula_not_registered: 'पहचान पंजीकृत नहीं है। कृपया खाता बनाएं।',
    enter_password: 'अपना पासवर्ड दर्ज करें',
    incorrect_password: 'गलत पासवर्ड',
    current_password: 'वर्तमान पासवर्ड',
    show_password: 'पासवर्ड दिखाएं',
    hide_password: 'पासवर्ड छुपाएं',

    // Navigation
    nav_home: 'होम',
    nav_sinpe: 'SINPE',
    nav_services: 'सेवाएं',
    nav_apps: 'ऐप्स',
    nav_profile: 'प्रोफाइल',

    // Home
    total_balance: 'कुल शेष',
    available: 'उपलब्ध',
    accounts: 'खाते',
    quick_actions: 'त्वरित कार्य',
    scan_qr: 'QR स्कैन करें',
    send_money: 'पैसे भेजें',
    request_money: 'पैसे मांगें',
    pay_services: 'सेवाएं भुगतान करें',
    recent_transactions: 'हाल के लेनदेन',
    view_all: 'सभी देखें',

    // SINPE
    sinpe_mobile: 'SINPE मोबाइल',
    send: 'भेजें',
    receive: 'प्राप्त करें',
    contacts: 'संपर्क',
    add_contact: 'संपर्क जोड़ें',
    phone_number: 'फ़ोन नंबर',
    amount: 'राशि',
    description: 'विवरण',
    bank: 'बैंक',
    copy_number: 'नंबर कॉपी करें',
    share: 'साझा करें',
    copied: 'कॉपी हो गया',
    favorite: 'पसंदीदा',

    // Services
    services: 'सेवाएं',
    recharges: 'रिचार्ज',
    history: 'इतिहास',
    bill_payments: 'बिल भुगतान',
    phone_recharges: 'फ़ोन रिचार्ज',
    no_history: 'अभी तक कोई इतिहास नहीं',
    paid: 'भुगतान किया',
    successful: 'सफल',
    pending: 'लंबित',

    // Profile
    profile: 'प्रोफाइल',
    my_account: 'मेरा खाता',
    security: 'सुरक्षा',
    change_pin: 'पिन बदलें',
    biometric_auth: 'बायोमेट्रिक प्रमाणीकरण',
    fingerprint_face: 'फिंगरप्रिंट / Face ID',
    two_factor_auth: 'दो-कारक प्रमाणीकरण',
    two_factor_desc: 'प्रमाणक ऐप (TOTP)',
    twofa_on: 'चालू',
    twofa_off: 'बंद',
    twofa_intro_desc: 'Google Authenticator या Authy जैसे प्रमाणक ऐप से सुरक्षा की एक अतिरिक्त परत जोड़ें।',
    twofa_enable_btn: 'सक्षम करें',
    twofa_scan_instruction: 'अपने प्रमाणक ऐप से यह QR कोड स्कैन करें।',
    twofa_manual_key: 'या यह कुंजी मैन्युअल रूप से दर्ज करें:',
    twofa_enter_code: '6 अंकों का कोड दर्ज करें',
    twofa_verify: 'सत्यापित करें और सक्षम करें',
    twofa_recovery_title: 'हो गया! अपने रिकवरी कोड सहेजें',
    twofa_recovery_desc: 'यदि आप अपने प्रमाणक तक पहुंच खो देते हैं तो प्रत्येक कोड एक बार काम करता है। इन्हें सुरक्षित स्थान पर रखें।',
    twofa_copy: 'कोड कॉपी करें',
    twofa_copied: 'कॉपी किया गया',
    twofa_recovery_done: 'मैंने सहेज लिया',
    twofa_disable_title: '2FA अक्षम करें',
    twofa_disable_desc: 'दो-कारक प्रमाणीकरण अक्षम करने के लिए अपने प्रमाणक से एक कोड (या रिकवरी कोड) दर्ज करें।',
    twofa_disable_btn: 'अक्षम करें',
    twofa_invalid_code: 'अमान्य कोड। कृपया पुनः प्रयास करें।',
    notifications_setting: 'सूचनाएं',
    dark_mode: 'डार्क मोड',
    language: 'भाषा',
    support: 'सहायता',
    help_center: 'सहायता केंद्र',
    faq: 'अक्सर पूछे जाने वाले प्रश्न',
    chat_support: 'चैट सहायता',
    about: 'के बारे में',
    version: 'संस्करण',

    // QR Scanner
    qr_scanner: 'QR स्कैनर',
    scan_to_pay: 'भुगतान के लिए स्कैन करें',
    scanning: 'स्कैन हो रहा है...',
    point_camera: 'कैमरा QR कोड की ओर करें',
    payment_detected: 'भुगतान पता चला',
    recipient: 'प्राप्तकर्ता',
    currency: 'मुद्रा',

    // Misc
    made_in_cr: 'कोस्टा रिका में प्यार से बनाया',
    all_rights: 'सर्वाधिकार सुरक्षित',
    test_users: 'परीक्षण उपयोगकर्ता',

    // Additional UI
    add_money: 'पैसे जोड़ें',
    add_account: 'खाता जोड़ें',
    open_new_account: 'नया खाता खोलें',
    insufficient_funds: 'अपर्याप्त राशि',
    card: 'कार्ड',
    deposit_crypto: 'क्रिप्टो जमा करें',
    amount_to_send: 'भेजने की राशि',
    amount_to_request: 'अनुरोध राशि',
    from: 'से',
    add_new: 'नया जोड़ें',
    status: 'स्थिति',
    date: 'तारीख',
    category: 'श्रेणी',
    transaction_id: 'लेनदेन आईडी',
    report_issue: 'समस्या रिपोर्ट करें',
    address: 'पता',
    transaction_details: 'लेनदेन विवरण',

    // Profile
    personal_data: 'व्यक्तिगत जानकारी',
    kyc_verification: 'KYC सत्यापन',
    transaction_limits: 'लेनदेन सीमाएं',
    lock_app: 'ऐप लॉक करें',
    lock_now: 'अभी लॉक करें',
    biometrics: 'बायोमेट्रिक्स',
    preferences: 'प्राथमिकताएं',
    activated: 'सक्रिय',
    deactivated: 'निष्क्रिय',
    this_month: 'इस महीने',
    expenses: 'खर्च',
    available_247: '24/7 उपलब्ध',
    request_increase: 'वृद्धि का अनुरोध करें',
    daily_limit: 'दैनिक सीमा',
    monthly_limit: 'मासिक सीमा',
    per_transaction: 'प्रति लेनदेन',
    used: 'उपयोग किया गया',
    new_pin: 'नया पिन (4 अंक)',
    confirm_pin_label: 'पिन की पुष्टि करें',
    pins_dont_match: 'पिन मेल नहीं खाते',
    enable_biometrics: 'बायोमेट्रिक्स सक्षम करें',
    disable_biometrics: 'बायोमेट्रिक्स अक्षम करें',
    enter_pin_to_enable: 'बायोमेट्रिक प्रमाणीकरण सक्षम करने के लिए अपना पिन दर्ज करें',
    enter_pin_to_disable: 'बायोमेट्रिक्स अक्षम करने की पुष्टि के लिए अपना पिन दर्ज करें',
    change_password: 'पासवर्ड बदलें',
    new_password: 'नया पासवर्ड',
    confirm_password: 'पासवर्ड की पुष्टि करें',
    passwords_dont_match: 'पासवर्ड मेल नहीं खाते',
    enter_password_to_enable: 'बायोमेट्रिक प्रमाणीकरण सक्षम करने के लिए अपना पासवर्ड दर्ज करें',
    enter_password_to_disable: 'बायोमेट्रिक्स अक्षम करने की पुष्टि के लिए अपना पासवर्ड दर्ज करें',
    password_strength: 'मजबूती',
    password_weak: 'कमजोर',
    password_medium: 'मध्यम',
    password_strong: 'मजबूत',
    password_requirements: 'कम से कम 8 अक्षर, बड़ा, छोटा, संख्या और विशेष अक्षर',
    security_pin: 'सुरक्षा पिन',
    current: 'वर्तमान',
    released: 'जारी',

    // SINPE View
    copied_to_clipboard: 'क्लिपबोर्ड पर कॉपी किया गया',
    available_to_send: 'भेजने के लिए उपलब्ध',
    request: 'अनुरोध',
    favorites: 'पसंदीदा',
    add: 'जोड़ें',
    sinpe_contacts: 'SINPE संपर्क',
    new_contact: 'नया',
    no_contacts_yet: 'अभी तक कोई संपर्क नहीं',
    send_to_new_number: 'नए नंबर पर भेजें',
    my_sinpe_number: 'मेरा SINPE नंबर',
    share_number_message: 'पैसे प्राप्त करने के लिए यह नंबर साझा करें',
    copy: 'कॉपी',
    no_transactions_yet: 'अभी तक कोई लेनदेन नहीं',
    sent_to: 'को भेजा गया',
    received_from: 'से प्राप्त',
    add_sinpe_contact: 'SINPE संपर्क जोड़ें',
    contact_name: 'संपर्क का नाम',
    bank_optional: 'बैंक (वैकल्पिक)',
    mark_as_favorite: 'पसंदीदा में जोड़ें',
    save_contact: 'संपर्क सहेजें',
    detail_optional: 'विवरण (वैकल्पिक)',
    processing: 'प्रोसेसिंग...',
    sending_request: 'अनुरोध भेज रहे हैं...',
    sent_success: 'भेजा गया!',
    sinpe_transfer_success: 'आपका SINPE ट्रांसफर सफल रहा',
    sent_to_label: 'को भेजा गया',
    phone: 'फ़ोन',
    detail: 'विवरण',
    sinpe_receipt: 'SINPE रसीद',
    unknown_bank: 'अज्ञात',
    request_to_number: '(नंबर) से अनुरोध',
    reason_optional: 'कारण (वैकल्पिक)',
    quick_amounts: 'त्वरित राशि',

    // Services View
    my_services: 'मेरी सेवाएं',
    search_service: 'सेवा खोजें...',
    select_operator: 'ऑपरेटर चुनें',
    recent_recharges: 'हाल के रिचार्ज',
    service_payments: 'सेवा भुगतान',
    no_service_payments: 'अभी तक कोई सेवा भुगतान नहीं',
    client_label: 'ग्राहक',
    no_recharges_yet: 'अभी तक कोई रिचार्ज नहीं',
    pay_service: 'भुगतान करें',
    client_number_nis: 'ग्राहक संख्या / NIS / अनुबंध',
    amount_to_pay: 'भुगतान राशि',
    processing_payment: 'भुगतान प्रोसेस हो रहा है...',
    pay: 'भुगतान करें',
    recharge_label: 'रिचार्ज',
    prepaid_recharge: 'प्रीपेड रिचार्ज',
    number_to_recharge: 'रिचार्ज करने का नंबर',
    select_amount: 'राशि चुनें',
    recharge_success: 'रिचार्ज सफल!',
    payment_success: 'भुगतान सफल!',
    ready: 'हो गया',

    // Crypto View
    crypto_portfolio: 'क्रिप्टो पोर्टफोलियो',
    my_assets: 'मेरी संपत्तियां',
    market: 'बाजार',
    staking: 'स्टेकिंग',
    buy: 'खरीदें',
    sell: 'बेचें',
    convert: 'परिवर्तित करें',
    stake: 'स्टेक करें',
    unstake: 'अनस्टेक करें',
    claim: 'दावा करें',
    no_crypto_yet: 'अभी कोई क्रिप्टो संपत्ति नहीं',
    buy_crypto: 'क्रिप्टो खरीदें',
    total_portfolio: 'कुल पोर्टफोलियो',
    profit_loss: 'लाभ/हानि',
    apy: 'वार्षिक प्रतिशत',
    staked_amount: 'स्टेक राशि',
    earned: 'अर्जित',
    locked: 'लॉक',
    yield_rates: 'प्रतिफल दरें',
    estimated_earnings: 'अनुमानित मासिक कमाई',
    conversion_rate: 'रूपांतरण दर',
    network_fee: 'नेटवर्क शुल्क',
    verify_address: 'पता सत्यापित करें',
    irreversible_warning: 'क्रिप्टो लेनदेन अपरिवर्तनीय हैं',
    scan_qr_receive: 'प्राप्त करने के लिए QR स्कैन करें',
    only_send_asset: 'इस पते पर केवल {asset} भेजें',
    start_staking: 'स्टेकिंग शुरू करें',
    earn_passive: 'क्रिप्टो से निष्क्रिय आय अर्जित करें',
    select_crypto: 'क्रिप्टो चुनें',
    invest_amount: 'निवेश राशि',
    available_balance: 'उपलब्ध शेष',
    receive_in: 'में प्राप्त करें',
    convert_to: 'में बदलें',
    destination_address: 'गंतव्य पता',
    tx_hash: 'TX हैश',
    all_assets: 'सभी संपत्तियां',

    reg_phone_title: 'आपका फ़ोन नंबर',
    reg_phone_desc: 'SINPE Movil से पैसे भेजने और प्राप्त करने के लिए इसका उपयोग करें',
    reg_verify_title: 'अपना नंबर सत्यापित करें',
    reg_code_sent_to: 'कोड भेजा गया',
    verify: 'सत्यापित करें',
    reg_cedula_title: 'आपकी पहचान',
    reg_cedula_desc: 'नियमों का पालन करने के लिए हमें आपकी पहचान सत्यापित करनी होगी',
    reg_cedula_nacional: 'राष्ट्रीय',
    reg_cedula_residente: 'निवासी',
    reg_cedula_dimex: 'DIMEX',
    reg_name_title: 'आपका नाम क्या है?',
    reg_name_desc: 'पैसे भेजते समय लोग आपको इस नाम से पहचानेंगे',
    first_name: 'पहला नाम',
    last_name: 'अंतिम नाम',
    reg_password_title: 'अपना पासवर्ड बनाएं',
    reg_password_desc: 'कम से कम 8 अक्षर, बड़े अक्षर, संख्याएं और प्रतीक शामिल करें',
    password: 'पासवर्ड',
    password_good: 'अच्छा',
    reg_creating_account: 'खाता बना रहे हैं...',
    reg_error_default: 'खाता बनाने में त्रुटि',
    reg_password_min_length: 'पासवर्ड कम से कम 8 अक्षर का होना चाहिए',
    reg_security_note: 'आपकी जानकारी बैंक-स्तर एन्क्रिप्शन से सुरक्षित है',
    login_welcome: 'स्वागत है',
    login_enter_cedula: 'जारी रखने के लिए अपनी पहचान संख्या दर्ज करें',
    login_last_access: 'अंतिम पहुंच:',
    login_change_cedula: 'पहचान बदलें',
    login_password_title: 'अपना पासवर्ड दर्ज करें',
    login_verifying: 'सत्यापित हो रहा है...',
    login_enter: 'लॉग इन करें',
    login_no_account: 'खाता नहीं है?',
    login_wrong_credentials: 'पहचान या पासवर्ड गलत है',
    login_biometric_failed: 'बायोमेट्रिक प्रमाणीकरण विफल',
    login_biometric_prompt: 'फिंगरप्रिंट या Face ID से लॉगिन करें',
    login_terms: 'जारी रखकर, आप हमारी सेवा की शर्तें और गोपनीयता नीति स्वीकार करते हैं',
    cedula_label: 'पहचान संख्या',
    cedula_placeholder: 'उदा: 702650930',
    error_title: 'कुछ गलत हो गया',
    error_desc: 'एक अप्रत्याशित त्रुटि हुई। आप पुनः प्रयास कर सकते हैं या होम पर लौट सकते हैं।',
    error_retry: 'पुनः प्रयास करें',
    error_home: 'होम',
    unlock: 'अनलॉक करें',
    unlock_biometric_prompt: 'KiramoPay अनलॉक करें',
    nav_crypto: 'क्रिप्टो',

    recent_crypto_tx: 'हाल के लेनदेन',

    budget: 'बजट',
    budgets: 'बजट',
    add_budget: 'बजट जोड़ें',
    edit_budget: 'बजट संपादित करें',
    budget_limit: 'सीमा',
    budget_spent: 'खर्च किया',
    budget_remaining: 'शेष',
    reset_budgets: 'खर्च रीसेट करें',
    no_budgets: 'कोई बजट कॉन्फ़िगर नहीं किया गया',
    total_spending: 'कुल खर्च',
    icon: 'आइकन',
    color: 'रंग',
    recurring_payments: 'आवर्ती भुगतान',
    add_recurring: 'आवर्ती भुगतान जोड़ें',
    frequency: 'आवृत्ति',
    weekly: 'साप्ताहिक',
    biweekly: 'पाक्षिक',
    monthly: 'मासिक',
    next_payment: 'अगला भुगतान',
    last_paid: 'अंतिम भुगतान',
    no_recurring: 'कोई आवर्ती भुगतान नहीं',
    recurring_service: 'सेवा',
    recurring_sinpe: 'SINPE',
    recurring_recharge: 'रिचार्ज',
    export_csv: 'CSV निर्यात करें',
    export_transactions: 'निर्यात',
    export_options: 'निर्यात विकल्प',
    export_excel: 'Excel (CSV)',
    export_excel_desc: 'Excel, Numbers और Google Sheets के साथ संगत फाइल',
    export_json: 'JSON',
    export_json_desc: 'डेवलपर्स और APIs के लिए संरचित प्रारूप',
    copy_transactions: 'क्लिपबोर्ड पर कॉपी करें',
    copy_transactions_desc: 'एक स्वरूपित सारांश को टेक्स्ट के रूप में कॉपी करें',
    share_transactions: 'साझा करें',
    share_transactions_desc: 'WhatsApp, ईमेल या अन्य ऐप से सारांश भेजें',
    export_success: 'सफलतापूर्वक निर्यात किया गया',
    income: 'आय',
    net_balance: 'शुद्ध',
    search_transactions: 'लेनदेन खोजें...',
    all_categories: 'सभी',
    num_transactions: 'लेनदेन',
    theme_schedule: 'थीम शेड्यूल',
    theme_off: 'बंद',
    theme_sunrise_sunset: 'सूर्योदय/सूर्यास्त',
    theme_custom: 'कस्टम',
    dark_mode_start: 'डार्क मोड शुरू',
    dark_mode_end: 'डार्क मोड समाप्त',
    feature_flags: 'प्रयोगात्मक सुविधाएं',
    experimental_features: 'विकास में सुविधाओं को सक्षम या अक्षम करें',

    analytics_title: 'खर्च विश्लेषण',
    analytics_week: 'सप्ताह',
    analytics_month: 'महीना',
    analytics_all: 'सब',
    analytics_flow: 'पैसे का प्रवाह',
    analytics_by_category: 'श्रेणी अनुसार खर्च',
    analytics_no_expenses: 'कोई खर्च दर्ज नहीं',
    analytics_insight: 'स्मार्ट विश्लेषण',
    analytics_top_category: 'सबसे अधिक खर्च',
    analytics_of_spending: 'कुल का',
    analytics_weekly_pattern: 'साप्ताहिक पैटर्न',
    analytics_total_tx: 'कुल',
    analytics_received: 'प्राप्त',
    analytics_sent: 'भेजे',
    analytics_sun: 'रवि',
    analytics_mon: 'सोम',
    analytics_tue: 'मंगल',
    analytics_wed: 'बुध',
    analytics_thu: 'गुरु',
    analytics_fri: 'शुक्र',
    analytics_sat: 'शनि',
    savings_title: 'बचत लक्ष्य',
    savings_total_saved: 'कुल बचत',
    savings_of_target: 'लक्ष्य का',
    savings_no_goals: 'कोई बचत लक्ष्य नहीं',
    savings_no_goals_desc: 'अपना पहला लक्ष्य बनाएं और जो सबसे महत्वपूर्ण है उसके लिए बचत शुरू करें',
    savings_create_first: 'पहला लक्ष्य बनाएं',
    savings_add_goal: 'नया लक्ष्य',
    savings_goal_name: 'लक्ष्य का नाम',
    savings_goal_name_placeholder: 'जैसे: छुट्टी, नई कार...',
    savings_target_amount: 'लक्ष्य राशि',
    savings_create_goal: 'लक्ष्य बनाएं',
    savings_add_money: 'धन जोड़ें',
    savings_deposit: 'जमा करें',
    home_spending: 'खर्च',
    home_top_cat: 'शीर्ष श्रेणी',
    home_savings: 'बचत',
    home_savings_view: 'मेरे लक्ष्य',
    home_savings_desc: 'अपने सपनों के लिए बचत करें',
    onboard_skip: 'छोड़ें',
    onboard_get_started: 'शुरू करें',
    onboard_title_1: 'आपका पैसा, एक जगह',
    onboard_desc_1: 'एक ही ऐप से अपने सभी खाते, कार्ड और क्रिप्टो प्रबंधित करें।',
    onboard_title_2: 'तुरंत भुगतान और ट्रांसफर',
    onboard_desc_2: 'SINPE मोबाइल, QR, सेवाएं और रिचार्ज। तेज, सुरक्षित, आसान।',
    onboard_title_3: 'शीर्ष स्तर की सुरक्षा',
    onboard_desc_3: 'बायोमेट्रिक प्रमाणीकरण, डेटा एन्क्रिप्शन और धोखाधड़ी सुरक्षा।',
    onboard_title_4: 'स्मार्ट बचत और निवेश',
    onboard_desc_4: 'बचत लक्ष्य बनाएं, खर्च का विश्लेषण करें और क्रिप्टो से अपना पैसा बढ़ाएं।',
    splitpay_title: 'बिल बांटें',
    splitpay_no_splits: 'कोई विभाजित बिल नहीं',
    splitpay_no_splits_desc: 'दोस्तों के साथ आसानी से खर्च बांटें',
    splitpay_create: 'विभाजन बनाएं',
    splitpay_desc: 'विवरण',
    splitpay_desc_placeholder: 'जैसे: रात का खाना, यात्रा, खरीदारी...',
    splitpay_equal: 'बराबर',
    splitpay_custom: 'कस्टम',
    splitpay_participants: 'प्रतिभागी',
    splitpay_per_person: 'प्रति व्यक्ति',
    loyalty_title: 'पॉइंट्स और रिवॉर्ड्स',
    loyalty_tier: 'स्तर',
    loyalty_lifetime: 'कुल पॉइंट्स',
    loyalty_available: 'उपलब्ध',
    loyalty_rewards: 'रिवॉर्ड्स',
    loyalty_history: 'इतिहास',
    loyalty_earn: 'कमाएं',
    loyalty_earn_desc: 'KiramoPay पर हर लेनदेन से स्वचालित रूप से पॉइंट्स कमाएं',
    loyalty_no_rewards: 'कोई रिवॉर्ड उपलब्ध नहीं',
    loyalty_no_history: 'कोई पॉइंट इतिहास नहीं',
    loyalty_no_rules: 'कोई कैशबैक नियम नहीं',
    loyalty_redeem: 'रिडीम करें',
    loyalty_next_tier: 'अगला स्तर',
    loyalty_max_per_tx: 'प्रति लेनदेन अधिकतम',
    home_split: 'बांटें',
    home_split_view: 'स्प्लिट पे',
    home_split_desc: 'दोस्तों के साथ बिल बांटें',
    home_loyalty: 'पॉइंट्स',
    home_loyalty_view: 'रिवॉर्ड्स',
    home_loyalty_desc: 'पॉइंट्स कमाएं और रिडीम करें',
    // Assistant (Phase 3a)
    assistant_title: 'सहायक',
    assistant_card_desc: 'अपने वित्त के बारे में मुझसे पूछें',
    assistant_unavailable: 'सहायक अभी उपलब्ध नहीं है।',
    assistant_greeting: 'नमस्ते! मैं आपके वित्त में कैसे मदद करूँ?',
    assistant_disclaimer: 'मैं वित्तीय सलाह नहीं देता और पैसे ट्रांसफर नहीं कर सकता।',
    assistant_example_1: 'इस महीने मैंने कितना खर्च किया?',
    assistant_example_2: 'मेरा बैलेंस क्या है?',
    assistant_placeholder: 'अपना सवाल लिखें…',
    assistant_send: 'भेजें',
    assistant_error: 'मैं जवाब नहीं दे सका। कृपया फिर से कोशिश करें।',
    // Phase F — escrow + API keys + webhooks
    merchant_tools: 'मर्चेंट टूल्स',
    escrow_menu: 'सुरक्षित भुगतान',
    escrow_menu_desc: 'एस्क्रो समझौते',
    apikeys_menu: 'API कीज़',
    apikeys_menu_desc: 'प्रोग्रामैटिक मर्चेंट एक्सेस',
    webhooks_menu: 'वेबहुक',
    webhooks_menu_desc: 'इवेंट सूचनाएँ',
    escrow_title: 'सुरक्षित भुगतान',
    escrow_subtitle: 'दोनों पक्षों के संतुष्ट होने तक धनराशि सुरक्षित रखी जाती है',
    escrow_empty: 'अभी कोई समझौता नहीं',
    escrow_empty_desc: 'भुगतान सुरक्षित रखने के लिए एक समझौता बनाएँ',
    escrow_new: 'नया समझौता',
    escrow_create_title: 'समझौता बनाएँ',
    escrow_seller: 'विक्रेता ID',
    escrow_seller_hint: 'भुगतान प्राप्त करने वाले उपयोगकर्ता का UUID',
    escrow_amount: 'राशि',
    escrow_desc_label: 'विवरण',
    escrow_desc_hint: 'क्या खरीदा जा रहा है?',
    escrow_create_btn: 'समझौता बनाएँ',
    escrow_role_buyer: 'खरीदार',
    escrow_role_seller: 'विक्रेता',
    escrow_you_buyer: 'आप खरीदार हैं',
    escrow_you_seller: 'आप विक्रेता हैं',
    escrow_status_pending: 'लंबित',
    escrow_status_funded: 'वित्तपोषित',
    escrow_status_released: 'जारी किया गया',
    escrow_status_refunded: 'वापस किया गया',
    escrow_status_disputed: 'विवादित',
    escrow_status_cancelled: 'रद्द किया गया',
    escrow_fund: 'वित्तपोषित करें',
    escrow_release: 'विक्रेता को जारी करें',
    escrow_refund: 'खरीदार को वापस करें',
    escrow_dispute: 'विवाद खोलें',
    escrow_cancel_agreement: 'समझौता रद्द करें',
    escrow_dispute_title: 'विवाद खोलें',
    escrow_dispute_reason: 'कारण',
    escrow_dispute_submit: 'विवाद सबमिट करें',
    escrow_action_failed: 'कार्रवाई पूरी नहीं हो सकी',
    apikeys_title: 'API कीज़',
    apikeys_desc: 'अपने खाते तक प्रोग्रामैटिक एक्सेस को प्रमाणित करें',
    apikeys_empty: 'अभी कोई की नहीं',
    apikeys_new: 'की बनाएँ',
    apikeys_name: 'नाम',
    apikeys_name_hint: 'इसे पहचानने के लिए (जैसे "ऑनलाइन स्टोर")',
    apikeys_scopes: 'स्कोप',
    apikeys_create_btn: 'की बनाएँ',
    apikeys_full_title: 'अपनी की सहेजें',
    apikeys_full_desc: 'यह केवल एक बार दिखाई देगी। इसे किसी सुरक्षित जगह सहेजें।',
    apikeys_copy: 'कॉपी करें',
    apikeys_copied: 'कॉपी हो गई',
    apikeys_done: 'हो गया',
    apikeys_revoke: 'रद्द करें',
    apikeys_revoke_confirm: 'यह की रद्द करें? यह तुरंत काम करना बंद कर देगी।',
    apikeys_revoked: 'रद्द कर दी गई',
    apikeys_active: 'सक्रिय',
    apikeys_created: 'बनाई गई',
    webhooks_title: 'वेबहुक',
    webhooks_desc: 'हस्ताक्षरित इवेंट सूचनाएँ प्राप्त करें',
    webhooks_empty: 'अभी कोई वेबहुक नहीं',
    webhooks_new: 'वेबहुक जोड़ें',
    webhooks_url: 'एंडपॉइंट URL',
    webhooks_events: 'इवेंट्स',
    webhooks_events_hint: 'कॉमा से अलग करें, या सभी के लिए *',
    webhooks_create_btn: 'वेबहुक रजिस्टर करें',
    webhooks_secret_title: 'अपना सीक्रेट सहेजें',
    webhooks_secret_desc: 'हस्ताक्षर सत्यापित करने के लिए इसका उपयोग करें। केवल एक बार दिखाया जाएगा।',
    webhooks_delete: 'हटाएँ',
    webhooks_delete_confirm: 'यह वेबहुक हटाएँ?',
    webhooks_deliveries: 'हाल की डिलीवरी',
    webhooks_no_deliveries: 'अभी कोई डिलीवरी नहीं',
    webhooks_active: 'सक्रिय',
    webhooks_disabled: 'अक्षम',
  },
};

export default translations;
