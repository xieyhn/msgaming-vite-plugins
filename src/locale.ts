import minimist from 'minimist'

interface LocaleArgs {
  rollback?: string
}

export const LANGUAGES = [
  'zh_CN',
  'en_US',
  'th_TH',
  'id_ID',
  'vi_VN',
  'ja_JP',
  'ko_KR',
  'ru_RU',
  'tr_TR',
  'es_ES',
  'fr_FR',
  'pt_PT',
]

export const SOCIAL_LANGUAGE_MAP = {
  zh_SL: 'zh_CN',
  en_SL: 'en_US',
  th_SL: 'th_TH',
  id_SL: 'id_ID',
  vi_SL: 'vi_VN',
  ja_SL: 'ja_JP',
  ko_SL: 'ko_KR',
  ru_SL: 'ru_RU',
  tr_SL: 'tr_TR',
  es_SL: 'es_ES',
  fr_SL: 'fr_FR',
  pt_SL: 'pt_PT',
}

export const localeReg = /\[locale(.*?)\]/

export function parseLocaleArgs(content: string) {
  return minimist<LocaleArgs>(
    content.match(localeReg)![0]
      .replace(/^\[locale/, '')
      .replace(/\]$/, '')
      .trim()
      .split(' '),
  )
}
