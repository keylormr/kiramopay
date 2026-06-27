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

export type TranslationKeys = {
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
  charge_qr: string;
  charge_amount_optional: string;
  charge_amount_hint: string;
  generate_qr: string;
  generating: string;
  charge_qr_help: string;
  new_qr: string;
  qr_gen_error: string;
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
  mfa_challenge_title: string;
  mfa_challenge_desc: string;
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
  login_rate_limited: string;
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
  error_details: string;

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
  // Assistant Phase 3b (confirmation)
  assistant_confirm: string;
  assistant_confirmed: string;
  assistant_action_failed: string;
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
  payout_menu: string;
  payout_menu_desc: string;
  payout_title: string;
  payout_subtitle: string;
  payout_empty: string;
  payout_empty_desc: string;
  payout_new: string;
  payout_create_title: string;
  payout_rail: string;
  payout_amount: string;
  payout_beneficiary: string;
  payout_account: string;
  payout_account_hint: string;
  payout_create_btn: string;
  payout_status_pending: string;
  payout_status_processing: string;
  payout_status_completed: string;
  payout_status_failed: string;
  payout_refresh: string;
  payout_failure_reason: string;
  payout_destination: string;
  payout_no_rails: string;
  payout_mfa_required: string;
  payout_action_failed: string;
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

import es from './languages/es';

// Spanish ships in the main bundle so first paint never waits; the other
// languages are split into their own chunks and loaded on demand.
export const defaultTranslations: TranslationKeys = es;

const loaders: Record<Exclude<Language, 'es'>, () => Promise<{ default: TranslationKeys }>> = {
  en: () => import('./languages/en'),
  'zh-tw': () => import('./languages/zh-tw'),
  ja: () => import('./languages/ja'),
  hi: () => import('./languages/hi'),
};

// loadLanguage resolves a language's messages: Spanish is already bundled;
// the others are fetched via a dynamic import (their own chunk).
export async function loadLanguage(lang: Language): Promise<TranslationKeys> {
  if (lang === 'es') return es;
  const mod = await loaders[lang]();
  return mod.default;
}
